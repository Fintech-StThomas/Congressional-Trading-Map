"""Review flags: five fixed, published rules evaluated on every counted trade (docs/review-flags.md; data dictionary:
"Review flags"). A flag means only that a published rule was met and the trade is worth a reporter's look.

Pure functions plus one loader. Reads (through `load_inputs`) pipeline/build/{companies.json, committees.json} and
pipeline/crosswalk/committee_sectors.csv (SIC prefixes of 2 to 4 digits per committee); writes nothing. Each rule returns a detail dict when met, NOT_MET when evaluated and not met, and None when the trade lacks
what the rule needs (missing date, range, org or source data): "not evaluated", never counted as "not met".
Trades a later filing deletes (TradeFile.not_counted) are never passed in. Exact identifiers only: org ids, CIKs,
bioguide ids and committee thomas ids; nothing is matched by name.
"""
from __future__ import annotations

import csv
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from .. import config as K
from ..edges_trades import eligible
from ..sic import MAJOR_GROUPS
from ..util import BUILD, CROSSWALK, read_json
from .budget import num
from .flags_chance import pile_on_chance

RULE_IDS = ("late", "large_amount", "pile_on", "money_both_ways", "sector_overseen")
NOT_MET: dict[str, Any] = {}          # sentinel: evaluated, rule not met (identity-compared)
COMMITTEE_SECTORS = CROSSWALK / "committee_sectors.csv"
Detail = dict[str, Any] | None


def cycle(year: int) -> int:
    """FEC two-year cycle of a calendar year (2023 and 2024 are the 2024 cycle)."""
    return year + year % 2


def read_committee_sectors(path: Path = COMMITTEE_SECTORS) -> dict[str, tuple[tuple[str, ...], tuple[str, ...]]]:
    """committee thomas id -> (SIC prefixes covered, SIC prefixes carved out). A prefix is 2 to 4 digits of the 4-digit
    SIC code ("28" chemicals, "283" drugs, "6798" REITs); a 2-digit prefix must be a known major group. Rows with no
    prefixes (considered, not mapped) are skipped."""
    out: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inc, exc = (tuple(sorted({p.strip() for p in (row[k] or "").split(";") if p.strip()}))
                        for k in ("sic_prefixes", "sic_excluded"))
            bad = [p for p in inc + exc if not (p.isdigit() and 2 <= len(p) <= 4) or int(p[:2]) not in MAJOR_GROUPS]
            if bad or row["committee_id"] in out or not row["basis"].strip() or (exc and not inc):
                raise ValueError(f"committee_sectors.csv: bad row {row['committee_id']} ({bad})")
            if inc:
                out[row["committee_id"]] = (inc, exc)
    return out


def sic_covered(sic: int, prefixes: tuple[tuple[str, ...], tuple[str, ...]]) -> bool:
    """A 4-digit SIC code starts with a covered prefix and with no carved-out one."""
    code = f"{sic:04d}"
    return code.startswith(prefixes[0]) and not (prefixes[1] and code.startswith(prefixes[1]))


@dataclass
class Inputs:
    members: Mapping[str, Mapping[str, Any]]          # spine: current, committees [{id}], fec_ids
    orgs: Mapping[str, Mapping[str, Any]]             # OrgSummary by id
    companies: Mapping[str, Mapping[str, Any]]        # pipeline/build/companies.json (eligibility, SIC code, pooled_vehicle)
    pac: Mapping[tuple[str, str], list[tuple[str, list[dict[str, Any]]]]]  # (org, member) -> [(edge id, by_year)]
    full_committees: set[str]                         # thomas ids of full committees (not subcommittees)
    committee_sectors: Mapping[str, tuple[tuple[str, ...], tuple[str, ...]]]


def pac_index(edges: Iterable[Mapping[str, Any]], orgs: set[str]) -> dict[tuple[str, str], list[tuple[str, list[dict[str, Any]]]]]:
    """pac_money edges from an org in `orgs` (the traded orgs) to a member, keyed (org, member)."""
    out: dict[tuple[str, str], list[tuple[str, list[dict[str, Any]]]]] = defaultdict(list)
    for e in edges:
        if e["type"] == "pac_money" and e["from"]["id"] in orgs and e["to"]["kind"] == "member":
            out[(e["from"]["id"], e["to"]["id"])].append((e["id"], e["by_year"]))
    return out


def load_inputs(spine: Mapping[str, Any], orgs: Mapping[str, Any], edges: Iterable[Mapping[str, Any]],
                traded_orgs: set[str]) -> Inputs:
    committees = read_json(BUILD / "committees.json")
    full = {cid for cid, c in committees.items() if c["parent"] is None}
    sectors = read_committee_sectors()
    unknown = set(sectors) - full
    if unknown:
        raise ValueError(f"committee_sectors.csv names committees that are not current full committees: {sorted(unknown)}")
    return Inputs(spine, orgs, read_json(BUILD / "companies.json"), pac_index(edges, traded_orgs), full, sectors)


# ---------------------------------------------------------------- the rules (one function each)
def rule_late(t: Mapping[str, Any]) -> Detail:
    if t["lag_days"] is None:
        return None
    return {"lag_days": t["lag_days"]} if t["lag_days"] > K.LATE_DAYS else NOT_MET


def rule_large(t: Mapping[str, Any]) -> Detail:
    if t["low"] is None:
        return None
    return {"low": num(t["low"])} if t["low"] >= K.FLAGS_LARGE_MIN_LOW else NOT_MET


def pile_on_expected(days_per_member: Iterable[int]) -> float:
    """Baseline: the sum, over the other members who traded the org that way within FLAGS_PILE_ON_BASE_DAYS of the
    trade date (a rolling 365-day window centred on it), of each one's chance of a trade within the window on a random
    day (their distinct trading days in that span x 15/365, capped at 1), floored at 1/365. A member who trades the
    company every few weeks counts as near-certain, an occasional one as 15/365."""
    share = (2 * K.FLAGS_PILE_ON_DAYS + 1) / 365
    return max(sum(min(1.0, n * share) for n in days_per_member), K.FLAGS_PILE_ON_FLOOR)


class PileOn:
    """Eligible trades (the traded_together rule's eligibility) grouped by org and direction, sorted by day; the
    baseline reads each member's distinct trading days in the same group within FLAGS_PILE_ON_BASE_DAYS either side."""

    def __init__(self, trades: Iterable[Mapping[str, Any]], companies: Mapping[str, Any]) -> None:
        self.companies = companies
        rows: dict[tuple[str, str], set[tuple[int, str]]] = defaultdict(set)
        for t in trades:
            if eligible(t, companies):  # type: ignore[arg-type]
                rows[(t["org"], t["action"])].add((t["date"].toordinal(), t["member"]))
        self.rows = {k: sorted(v) for k, v in rows.items()}       # distinct (day, member) pairs
        self.days = {k: [d for d, _ in v] for k, v in self.rows.items()}
        self.chance = self.expected_sum = 0.0          # summed over evaluated trades (flags_chance.py)
        self.observed_sum = 0

    def __call__(self, t: Mapping[str, Any]) -> Detail:
        if not eligible(t, self.companies):  # type: ignore[arg-type]
            return None
        key, day = (t["org"], t["action"]), t["date"].toordinal()
        rows, days = self.rows.get(key, []), self.days.get(key, [])
        span = lambda w: rows[bisect_left(days, day - w):bisect_right(days, day + w)]  # noqa: E731
        nearest: dict[str, int] = {}
        for d, m in span(K.FLAGS_PILE_ON_DAYS):
            if m != t["member"]:
                nearest[m] = min(nearest.get(m, abs(d - day)), abs(d - day))
        others = Counter(m for _, m in span(K.FLAGS_PILE_ON_BASE_DAYS) if m != t["member"])
        expected = pile_on_expected(others.values())
        self.chance += pile_on_chance(expected)
        self.expected_sum += expected
        self.observed_sum += len(nearest)
        if len(nearest) < K.FLAGS_PILE_ON_MIN_OTHERS or len(nearest) < K.FLAGS_PILE_ON_LIFT * expected:
            return NOT_MET
        listed = sorted(nearest, key=lambda m: (nearest[m], m))[:K.FLAGS_PILE_ON_LISTED]
        return {"members": listed, "observed": len(nearest), "expected": round(expected, 3)}


def rule_money(t: Mapping[str, Any], inp: Inputs) -> Detail:
    """pac_money from the trade's own org to the member, net positive in the trade's FEC cycle."""
    org = t["org"]
    if t["date"] is None or not org or not org.startswith("co:") or not inp.members[t["member"]].get("fec_ids"):
        return None
    c = cycle(t["date"].year)
    best: tuple[float, str] | None = None
    for eid, years in inp.pac.get((org, t["member"]), []):
        got = sum((y["exact"] if y["exact"] is not None else y["high"] or y["low"] or 0) for y in years if cycle(y["y"]) == c)
        if got > 0 and (best is None or (-got, eid) < (-best[0], best[1])):
            best = (got, eid)
    return {"edge": best[1]} if best else NOT_MET


def rule_sector(t: Mapping[str, Any], inp: Inputs) -> Detail:
    """A fund or pooled vehicle (an ETF trust's SIC code is not an industry it works in) is not evaluated. The company's
    4-digit SIC code (companies.json) is matched against each committee's prefixes."""
    m, co = inp.members[t["member"]], inp.companies.get(t["org"] or "") or {}
    if (not m.get("current") or t["date"] is None or t["date"] < date.fromisoformat(K.FLAGS_COMMITTEE_FROM)
            or not str(t["org"]).startswith("co:") or not co.get("sic") or t["asset_class"] == "fund"
            or co.get("pooled_vehicle")):
        return None
    full = sorted(c["id"][5:] for c in m.get("committees", []) if c["id"][5:] in inp.full_committees)
    if not full:
        return None          # no current full-committee assignment in the roster: nothing to compare against
    hits = [cid for cid in full if cid in inp.committee_sectors and sic_covered(int(co["sic"]), inp.committee_sectors[cid])]
    return {"committee": f"cmte:{hits[0]}"} if hits else NOT_MET


# ---------------------------------------------------------------- all rules over all counted trades
@dataclass
class Review:
    flags: dict[str, dict[str, dict[str, Any]]] = field(default_factory=lambda: defaultdict(dict))  # member -> trade -> rule -> detail
    not_evaluated: dict[str, Counter[str]] = field(default_factory=lambda: defaultdict(Counter))    # member -> rule -> n
    counted: Counter[str] = field(default_factory=Counter)                                          # member -> counted trades
    trades: dict[str, Mapping[str, Any]] = field(default_factory=dict)                              # flagged trade id -> trade
    chance: dict[str, dict[str, float]] = field(default_factory=dict)                            # rule -> chance sums

    def met(self, member: str) -> dict[str, int]:
        n = Counter(r for d in self.flags.get(member, {}).values() for r in d)
        return {r: n[r] for r in RULE_IDS}

    def trade_fields(self, member: str) -> dict[str, Any]:
        """TradeFile.flags and TradeFile.flags_not_evaluated for one member."""
        ne = self.not_evaluated.get(member, Counter())
        return {"flags": {tid: dict(sorted(d.items())) for tid, d in sorted(self.flags.get(member, {}).items())},
                "flags_not_evaluated": {r: ne[r] for r in RULE_IDS}}

    def totals(self) -> dict[str, dict[str, int]]:
        total = sum(self.counted.values())
        out = {}
        for r in RULE_IDS:
            ne = sum(c[r] for c in self.not_evaluated.values())
            out[r] = {"met": sum(self.met(m)[r] for m in self.flags), "evaluated": total - ne, "not_evaluated": ne}
        return out


def compute(trades: list[Mapping[str, Any]], inp: Inputs) -> Review:
    """Evaluate every rule on every trade passed in (the counted trades only)."""
    pile_on = PileOn(trades, inp.companies)
    rules: dict[str, Callable[[Mapping[str, Any]], Detail]] = {
        "late": rule_late, "large_amount": rule_large, "pile_on": pile_on,
        "money_both_ways": lambda t: rule_money(t, inp), "sector_overseen": lambda t: rule_sector(t, inp)}
    rv = Review()
    for t in trades:
        if t.get("deleted"):
            raise AssertionError(f"review flags: not-counted trade {t['id']} passed in")
        rv.counted[t["member"]] += 1
        for rid, rule in rules.items():
            d = rule(t)
            if d is None:
                rv.not_evaluated[t["member"]][rid] += 1
            elif d is not NOT_MET:
                rv.flags[t["member"]].setdefault(t["id"], {})[rid] = d
                rv.trades[t["id"]] = t
    rv.chance = {"pile_on": {"expected_met": pile_on.chance, "expected_sum": pile_on.expected_sum,
                             "observed_sum": pile_on.observed_sum}}
    return rv
