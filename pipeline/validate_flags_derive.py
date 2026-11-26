"""Re-derivation of every review-flag rule from the published files, for validate_flags.py (docs/review-flags.md).

Independent of pipeline/assemble/flags.py where practical, by different code paths over different inputs:
- late, large_amount: from the published trade rows, one comprehension each.
- pile_on: one sweep per org and direction with two moving pointers and integer arithmetic for the baseline
  (the assembler slices sorted lists with bisect and sums floats); inputs are the published trade files.
- money_both_ways: from the published member files (full pac_money edges with `by_year`, and ledger rows with their
  first and last dates, whose edge ids are recomputed from type, ends and via); the assembler reads the merged build
  edges. A ledger row whose dates straddle the cycle cannot be split by year, and a former member's ledger keeps only
  its largest rows: such trades are "undetermined" (either outcome accepted, counted in the report).
- sector_overseen: from the member file's roster, pipeline/build/committees.json and companies.json, with its own
  prefix test.
Not independent (shared on purpose, each checked by its own tests): the `traded_together` eligibility
(edges_trades.eligible), the Poisson chance (flags_chance.pile_on_chance), the committee table loader
(flags.read_committee_sectors), edge_id, and the thresholds in config.py.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Any

from .assemble.flags_chance import pile_on_chance
from .config import (FLAGS_COMMITTEE_FROM, FLAGS_LARGE_MIN_LOW, FLAGS_PILE_ON_BASE_DAYS, FLAGS_PILE_ON_DAYS,
                     FLAGS_PILE_ON_LIFT, FLAGS_PILE_ON_LISTED, FLAGS_PILE_ON_MIN_OTHERS, LATE_DAYS)
from .contract import TRADE_COLUMNS
from .edges import edge_id
from .edges_trades import eligible

Files = dict[str, dict[str, Any]]
UNDETERMINED = "undetermined"


def counted(tf: dict[str, Any]) -> list[dict[str, Any]]:
    skip = tf.get("not_counted") or {}
    return [dict(zip(TRADE_COLUMNS, r)) for r in tf.get("rows", []) if r[0] not in skip]


def derive_late(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], int]:
    met = {r["id"]: {"lag_days": r["lag_days"]} for r in rows if r["lag_days"] is not None and r["lag_days"] > LATE_DAYS}
    return met, sum(r["lag_days"] is None for r in rows)


def derive_large(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], int]:
    met = {r["id"]: {"low": r["low"]} for r in rows if r["low"] is not None and r["low"] >= FLAGS_LARGE_MIN_LOW}
    return met, sum(r["low"] is None for r in rows)


def derive_pile_on(files: Files, companies: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], Counter[str], dict[str, float]]:
    """trade id -> detail for every met trade; member -> not evaluated (ineligible) count; chance sums."""
    groups: dict[tuple[str, str], list[tuple[int, str, str]]] = defaultdict(list)
    ne: Counter[str] = Counter()
    for mid, tf in files.items():
        for r in counted(tf):
            if eligible(r, companies):
                groups[(r["org"], r["action"])].append((date.fromisoformat(r["date"]).toordinal(), mid, r["id"]))
            else:
                ne[mid] += 1
    width = 2 * FLAGS_PILE_ON_DAYS + 1                  # chance per trading day, in 365ths
    weight = lambda n: min(365, n * width)              # noqa: E731  one member's chance x 365, an integer
    met: dict[str, dict[str, Any]] = {}
    sums = {"expected_met": 0.0, "expected_sum": 0.0, "observed_sum": 0}
    for trades in groups.values():
        trades.sort()
        pairs = sorted({(d, m) for d, m, _ in trades})  # distinct trading days per member
        days_in: Counter[str] = Counter()
        total = lo = hi = 0                            # total = sum of weight(days_in[m]) over members in the base span
        for day, mid, tid in trades:
            while hi < len(pairs) and pairs[hi][0] <= day + FLAGS_PILE_ON_BASE_DAYS:
                m = pairs[hi][1]
                total += weight(days_in[m] + 1) - weight(days_in[m])
                days_in[m] += 1
                hi += 1
            while pairs[lo][0] < day - FLAGS_PILE_ON_BASE_DAYS:
                m = pairs[lo][1]
                total += weight(days_in[m] - 1) - weight(days_in[m])
                days_in[m] -= 1
                lo += 1
            others = total - weight(days_in[mid])
            expected = max(others, 1) / 365
            near: dict[str, int] = {}
            for d, m in pairs[lo:hi]:
                if m != mid and abs(d - day) <= FLAGS_PILE_ON_DAYS:
                    near[m] = min(near.get(m, 10 ** 9), abs(d - day))
            sums["expected_met"] += pile_on_chance(expected)
            sums["expected_sum"] += expected
            sums["observed_sum"] += len(near)
            if len(near) >= FLAGS_PILE_ON_MIN_OTHERS and len(near) * 365 >= FLAGS_PILE_ON_LIFT * max(others, 1):
                met[tid] = {"members": sorted(near, key=lambda m: (near[m], m))[:FLAGS_PILE_ON_LISTED], "observed": len(near),
                            "expected": round(expected, 3)}
    return met, ne, sums


def pac_ties(mid: str, mf: dict[str, Any]) -> tuple[dict[str, list[dict[str, Any]]], bool]:
    """org -> the member's pac_money ties from it ({id, years | None, first, last, amount}); and whether the ledger is
    trimmed (a former member's: ledger_totals counts more pac_money ties than the file lists)."""
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in mf["edges"]:
        if e["type"] == "pac_money" and e["to"]["id"] == mid:
            out[e["from"]["id"]].append({"id": e["id"], "years": {y["y"]: y for y in e["by_year"]}})
    cols = mf["ledger"]["cols"]
    n_rows = 0
    for raw in mf["ledger"]["rows"]:
        r = dict(zip(cols, raw))
        if r["type"] == "pac_money" and r["kind"] == "org" and r["dir"] == "in":
            n_rows += 1
            via = {"id": r["via"]} if r["via"] else None
            amount = r["exact"] if r["exact"] is not None else (r["high"] or r["low"] or 0)
            out[r["other"]].append({"id": edge_id("pac_money", {"id": r["other"]}, {"id": mid}, via), "years": None,  # type: ignore[arg-type]
                                    "first": int(r["first"][:4]), "last": int(r["last"][:4]), "amount": amount})
    listed = n_rows + sum(1 for e in mf["edges"] if e["type"] == "pac_money" and e["to"]["id"] == mid)
    total = (mf.get("ledger_totals", {}).get("pac_money") or {}).get("edges", 0) + listed - n_rows
    return out, total > listed


def in_cycle(tie: dict[str, Any], c: int) -> float | str | None:
    """The tie's net amount in cycle c (years c-1 and c); None when it has no record there; UNDETERMINED for a ledger
    row whose dates straddle the cycle."""
    if tie["years"] is not None:
        ys = [tie["years"][y] for y in (c - 1, c) if y in tie["years"]]
        return sum(y["exact"] if y["exact"] is not None else (y["high"] or y["low"] or 0) for y in ys) if ys else None
    if tie["last"] < c - 1 or tie["first"] > c:
        return None
    return tie["amount"] if c - 1 <= tie["first"] and tie["last"] <= c else UNDETERMINED


def derive_money(mid: str, rows: list[dict[str, Any]], mf: dict[str, Any]) -> tuple[dict[str, Any], int, int]:
    """trade id -> the edge id the rule must name, or a set of acceptable ids (undetermined, may also be not met);
    not evaluated count; undetermined count."""
    ties, trimmed = pac_ties(mid, mf)
    met: dict[str, Any] = {}
    ne = undetermined = 0
    for r in rows:
        if not r["date"] or not str(r["org"] or "").startswith("co:") or not mf["member"].get("fec_ids"):
            ne += 1
            continue
        y = int(r["date"][:4])
        c = y if y % 2 == 0 else y + 1
        known = [(tie["id"], in_cycle(tie, c)) for tie in ties.get(r["org"], [])]
        positive = sorted(((-v, i) for i, v in known if isinstance(v, (int, float)) and v > 0))
        unsure = {i for i, v in known if v == UNDETERMINED}
        if unsure or trimmed:
            met[r["id"]] = {i for _, i in positive} | unsure | ({None} if not positive else set()) | ({"*"} if trimmed else set())
            undetermined += 1
        elif positive:
            met[r["id"]] = positive[0][1]
    return met, ne, undetermined


def sic_match(sic: int, inc: tuple[str, ...], exc: tuple[str, ...]) -> bool:
    code = str(sic).rjust(4, "0")
    return any(code[:len(p)] == p for p in inc) and not any(code[:len(p)] == p for p in exc)


def derive_sector(rows: list[dict[str, Any]], mf: dict[str, Any], companies: dict[str, Any], full: set[str],
                  table: dict[str, tuple[tuple[str, ...], tuple[str, ...]]]) -> tuple[dict[str, str], int]:
    """trade id -> committee id the rule must name; not evaluated count."""
    seats = sorted(x["id"] for x in mf["member"].get("committees", []) if x["id"].removeprefix("cmte:") in full)
    met: dict[str, str] = {}
    ne = 0
    for r in rows:
        co = companies.get(r["org"] or "") or {}
        if (not mf["member"].get("current") or not seats or r["date"] is None or r["date"] < FLAGS_COMMITTEE_FROM
                or not (r["org"] or "").startswith("co:") or not co.get("sic") or r["asset_class"] == "fund"
                or co.get("pooled_vehicle") is True):
            ne += 1
            continue
        hit = [s for s in seats if s[5:] in table and sic_match(int(co["sic"]), *table[s[5:]])]
        if hit:
            met[r["id"]] = hit[0]
    return met, ne
