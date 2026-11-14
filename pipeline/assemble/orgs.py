"""Org-side derived figures: shard key, party split and the org index (data dictionary: "OrgSummary",
"Party split", "OrgIndex"). Pure functions; reads and writes nothing.

Party split: every tie (full edges and ledger rows, current and former members) counts toward one measure:
pac_money -> given, outside_spending support/oppose -> support/oppose, traded -> traded (members only, no dollars).
A member counts under the party of their most recent term (why: the contract's MemberSummary.party; a party
switcher is counted under the later party for all years, as documented).
"""
from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from typing import Any

from ..config import ORG_INDEX_TOP
from ..contract import ORG_INDEX_COLS, PARTIES, SPLIT_MEASURES, Edge, SpineMember
from .budget import edge_size, member_end, num


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


def party_split(edges: list[Edge], party: dict[str, str]) -> dict[str, Any]:
    """{measure: {party: [distinct members, dollars]}}; dollars are null for traded. Only measures with a tie appear."""
    members: dict[str, dict[str, set[str]]] = defaultdict(lambda: {p: set() for p in PARTIES})
    dollars: dict[str, Counter[str]] = defaultdict(Counter)
    for e in edges:
        m = split_measure(e)
        if m is None:
            continue
        mid = member_end(e)
        members[m][party[mid]].add(mid)
        dollars[m][party[mid]] += edge_size(e)
    return {m: {p: [len(members[m][p]), None if m == "traded" else num(float(dollars[m][p]))] for p in PARTIES}
            for m in SPLIT_MEASURES if m in members}


def org_index(used_orgs: dict[str, dict[str, Any]], org_edges: dict[str, list[Edge]],
              spine: dict[str, SpineMember]) -> dict[str, Any]:
    """Top ORG_INDEX_TOP organisations by distinct current members tied by money (pac_money or outside_spending)
    and by pac_money dollars to current members, with both split by party."""
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
            reached[m["party"]].add(member_end(e))
            if e["type"] == "pac_money":
                given[m["party"]] += edge_size(e)
        n, d = sum(len(v) for v in reached.values()), sum(given.values())
        if n:
            stats[o] = (n, d, [len(reached[p]) for p in PARTIES], [num(float(given[p])) for p in PARTIES])
    by_members = sorted(stats, key=lambda o: (-stats[o][0], -stats[o][1], o))[:ORG_INDEX_TOP]
    by_dollars = sorted((o for o in stats if stats[o][1] > 0), key=lambda o: (-stats[o][1], -stats[o][0], o))[:ORG_INDEX_TOP]
    ids = sorted(set(by_members) | set(by_dollars))
    pos = {o: i for i, o in enumerate(ids)}
    rows = [[o, used_orgs[o]["name"], used_orgs[o]["kind"], used_orgs[o]["ticker"], *stats[o][2], *stats[o][3],
             used_orgs[o]["degree"]] for o in ids]
    return {"cols": ORG_INDEX_COLS, "rows": rows, "by_members": [pos[o] for o in by_members],
            "by_dollars": [pos[o] for o in by_dollars]}
