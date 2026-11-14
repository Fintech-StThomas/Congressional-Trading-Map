"""Org-side derived figures: shard key, party split and the org index (data dictionary: "OrgSummary",
"Party split", "OrgIndex"). Pure functions; reads and writes nothing.

Party split: every tie (full edges and ledger rows, current and former members) counts toward one measure:
pac_money -> given, outside_spending support/oppose -> support/oppose, traded -> traded (members only, no dollars).
Each tie counts under the member's party *at the time*: its by_year amounts are split by the party of the term
covering each year (`year_party`). A year two terms share goes to the term covering more of it (ties: the later
term); a year outside every term (money to a challenger before taking office, a former member's leftover
committee) goes to the nearest term in time and is counted in `SplitStats`. A member is counted once per party
they were tied under, so a party switcher with ties on both sides of the switch counts under both.
"""
from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from datetime import date
from typing import Any

from ..config import ORG_INDEX_TOP
from ..contract import ORG_INDEX_COLS, PARTIES, SPLIT_MEASURES, Edge, SpineMember, Term
from .budget import edge_size, member_end, num
from .wall import served_years


def shard(org_id: str) -> str:
    """orgs/<shard>.json: first two hex digits of sha1(org id), 256 shards."""
    return hashlib.sha1(org_id.encode()).hexdigest()[:2]


def split_measure(e: Edge) -> str | None:
    if e["type"] == "pac_money":
        return "given"
    if e["type"] == "outside_spending":
        return "support" if e["note"] == "support" else "oppose" if e["note"] == "oppose" else None
    if e["type"] == "traded":
        return "traded"
    return None


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def year_party(terms: list[Term], y: int, fallback: str) -> tuple[str, bool]:
    """(party in calendar year y, whether y is inside a term). Inside means the coverage rule of `served_years`
    (a term ending on 3 January does not count that year); among terms covering y the one with more days in y wins,
    ties to the later term. Outside every term: the nearest term in time (ties to the later term). No terms: the
    fallback (the member's latest party)."""
    y0, y1 = date(y, 1, 1), date(y, 12, 31)
    best: tuple[tuple[int, str], Term] | None = None
    for t in terms:
        a, b = served_years(t)
        if a <= y <= b:
            days = (min(_d(t["end"]), y1) - max(_d(t["start"]), y0)).days + 1
            if best is None or (days, t["start"]) > best[0]:
                best = ((days, t["start"]), t)
    inside = best is not None
    if best is None:
        for t in terms:
            gap = max((_d(t["start"]) - y1).days, (y0 - _d(t["end"])).days, 0)
            if best is None or (-gap, t["start"]) > best[0]:
                best = ((-gap, t["start"]), t)
    p = best[1]["party"] if best is not None else fallback
    return (p if p in PARTIES else fallback), inside


class SplitStats:
    """Counts for the run report: tie-years outside every term, and dollars (per member) counted under a party
    other than the member's latest one (what moved compared with the latest-party rule)."""

    def __init__(self) -> None:
        self.out_of_term_years = 0
        self.out_of_term_dollars = 0.0
        self.out_of_term_edges: set[str] = set()
        self.moved: Counter[tuple[str, str, str]] = Counter()   # (member, latest party, counted party) -> dollars
        self._cache: dict[tuple[str, int], tuple[str, bool]] = {}

    def party(self, mid: str, y: int, terms: list[Term], latest: str) -> tuple[str, bool]:
        k = (mid, y)
        if k not in self._cache:
            self._cache[k] = year_party(terms, y, latest)
        return self._cache[k]


def year_sizes(e: Edge) -> list[tuple[int, float]]:
    """(year, dollars) per by_year entry (exact, else high, else low), the remainder against edge_size put on the
    latest year so the parts always sum to the tie's size. No by_year: the whole size in the year of `last`."""
    total = edge_size(e)
    ys = [(int(b["y"]), b["exact"] or b["high"] or b["low"] or 0.0) for b in e["by_year"]]
    if not ys:
        return [(int(str(e["last"])[:4]), total)]
    rest = total - sum(v for _, v in ys)
    if abs(rest) > 1e-9:
        i = max(range(len(ys)), key=lambda j: ys[j][0])
        ys[i] = (ys[i][0], ys[i][1] + rest)
    return ys


def tie_parties(e: Edge, spine: dict[str, SpineMember], stats: SplitStats | None = None) -> Counter[str]:
    """party -> dollars of this member-org tie (for traded ties the dollars are only used for which parties)."""
    mid = member_end(e)
    m = spine[mid]
    out: Counter[str] = Counter()
    for y, v in year_sizes(e):
        if stats is not None:
            p, inside = stats.party(mid, y, m["terms"], m["party"])
        else:
            p, inside = year_party(m["terms"], y, m["party"])
        out[p] += v
        if stats is not None and not inside:
            stats.out_of_term_years += 1
            stats.out_of_term_edges.add(e.get("id", ""))
            if e["type"] != "traded":
                stats.out_of_term_dollars += v
    shares = _net(out, e, spine)
    if stats is not None and e["type"] != "traded":
        for p, v in shares.items():
            if p != m["party"]:
                stats.moved[(mid, m["party"], p)] += v
    return shares


def _net(out: Counter[str], e: Edge, spine: dict[str, SpineMember]) -> Counter[str]:
    """A party's share can be negative when refunds in its years exceed gifts (by_year is net per year). Such a
    deficit is netted against the tie's other parties, largest first, so every share is >= 0 and the shares still
    sum to the tie's size. Only parties left with a positive share are returned (a traded tie keeps every party of
    its years); a tie with nothing positive counts under the party of its latest year."""
    if e["type"] == "traded":
        return out
    deficit = -sum(v for v in out.values() if v < 0)
    pos = Counter({p: v for p, v in out.items() if v > 0})
    for p, v in sorted(pos.items(), key=lambda kv: (-kv[1], kv[0])):
        take = min(v, deficit)
        pos[p] -= take
        deficit -= take
    pos = Counter({p: v for p, v in pos.items() if v > 1e-9})
    if not pos:
        m = spine[member_end(e)]
        last = max(year_sizes(e))[0]
        pos[year_party(m["terms"], last, m["party"])[0]] = 0.0
    return pos


def party_split(edges: list[Edge], spine: dict[str, SpineMember], stats: SplitStats | None = None) -> dict[str, Any]:
    """{measure: {party: [distinct members, dollars]}}; dollars are null for traded. Only measures with a tie appear.
    Each tie's years go to the party of the member's term in that year (see the module docstring)."""
    members: dict[str, dict[str, set[str]]] = defaultdict(lambda: {p: set() for p in PARTIES})
    dollars: dict[str, Counter[str]] = defaultdict(Counter)
    for e in edges:
        m = split_measure(e)
        if m is None:
            continue
        mid = member_end(e)
        for p, v in tie_parties(e, spine, stats).items():
            members[m][p].add(mid)
            dollars[m][p] += v
    return {m: {p: [len(members[m][p]), None if m == "traded" else num(round(float(dollars[m][p]), 2))] for p in PARTIES}
            for m in SPLIT_MEASURES if m in members}


def org_index(used_orgs: dict[str, dict[str, Any]], org_edges: dict[str, list[Edge]],
              spine: dict[str, SpineMember]) -> dict[str, Any]:
    """Top ORG_INDEX_TOP organisations by distinct current members tied by money (pac_money or outside_spending)
    and by pac_money dollars to current members, with both split by the party at the time of each tie (as
    party_split; a current member tied under two parties counts under both)."""
    stats = {}
    for o, es in org_edges.items():
        reached: dict[str, set[str]] = {p: set() for p in PARTIES}
        given: Counter[str] = Counter()
        for e in es:
            if e["type"] not in ("pac_money", "outside_spending"):
                continue
            m = spine[member_end(e)]
            if not m["current"]:
                continue
            for p, v in tie_parties(e, spine).items():
                reached[p].add(member_end(e))
                if e["type"] == "pac_money":
                    given[p] += v
        n, d = sum(len(v) for v in reached.values()), sum(given.values())
        if n:
            stats[o] = (n, d, [len(reached[p]) for p in PARTIES], [num(round(float(given[p]), 2)) for p in PARTIES])
    by_members = sorted(stats, key=lambda o: (-stats[o][0], -stats[o][1], o))[:ORG_INDEX_TOP]
    by_dollars = sorted((o for o in stats if stats[o][1] > 0), key=lambda o: (-stats[o][1], -stats[o][0], o))[:ORG_INDEX_TOP]
    ids = sorted(set(by_members) | set(by_dollars))
    pos = {o: i for i, o in enumerate(ids)}
    rows = [[o, used_orgs[o]["name"], used_orgs[o]["kind"], used_orgs[o]["ticker"], *stats[o][2], *stats[o][3],
             used_orgs[o]["degree"]] for o in ids]
    return {"cols": ORG_INDEX_COLS, "rows": rows, "by_members": [pos[o] for o in by_members],
            "by_dollars": [pos[o] for o in by_dollars]}
