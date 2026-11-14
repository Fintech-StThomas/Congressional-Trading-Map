"""Cases: member-org pairs tied by several kinds of filed record at the same time (data dictionary: "Case").

Reads the merged edge list; writes nothing (the orchestrator publishes `cases.json` and each member's `cases`).
Rule (config.CASE_RULE): at least CASE_MIN_TYPES distinct filed edge types between one member and one org, at least
one of family `holding` and one of family `money` or `people`, all active in one common calendar year. A type is
active from its earliest `first` year to its latest `last` year. Context edges never count.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Iterable

from ..config import CASE_FAMILIES, CASE_MIN_TYPES
from ..contract import FAMILY, Case, Edge
from .budget import edge_size


def case_ok(types: Iterable[str]) -> bool:
    types = set(types)
    fams = {FAMILY[t] for t in types}
    return len(types) >= CASE_MIN_TYPES and "holding" in fams and bool(fams & {"money", "people"})


def find_cases(edges: list[Edge]) -> list[Case]:
    """Cases sorted by score (number of types), then money, then trades, then id. `years` is the window in which
    every listed type is active; `money` sums every money edge of the listed types (not only the window's)."""
    pairs: dict[tuple[str, str], list[Edge]] = defaultdict(list)
    for e in edges:
        if e["basis"] != "filed" or e["family"] not in CASE_FAMILIES:
            continue
        ends = {e["from"]["kind"]: e["from"]["id"], e["to"]["kind"]: e["to"]["id"]}
        if set(ends) == {"member", "org"}:
            pairs[(ends["member"], ends["org"])].append(e)
    cases: list[Case] = []
    for (member, org), es in sorted(pairs.items()):
        if not case_ok({e["type"] for e in es}):
            continue
        span = {t: (min(int(e["first"][:4]) for e in es if e["type"] == t), max(int(e["last"][:4]) for e in es if e["type"] == t))
                for t in {e["type"] for e in es}}
        best: frozenset[str] | None = None
        for y in range(min(s[0] for s in span.values()), max(s[1] for s in span.values()) + 1):
            active = frozenset(t for t, (lo, hi) in span.items() if lo <= y <= hi)
            if case_ok(active) and (best is None or len(active) > len(best)):
                best = active
        if best is None:
            continue
        types = sorted(best)
        chosen = [e for e in es if e["type"] in best]
        money = sum(edge_size(e) for e in chosen if e["family"] == "money")
        trades_n = sum(e["count"] for e in chosen if e["type"] == "traded")
        cases.append({"id": hashlib.sha1(f"case|{member}|{org}".encode()).hexdigest()[:12], "member": member, "org": org,
                      "types": types, "edges": sorted(e["id"] for e in chosen),
                      "years": [max(span[t][0] for t in types), min(span[t][1] for t in types)],
                      "score": len(types), "money": money, "trades": trades_n})
    cases.sort(key=lambda c: (-c["score"], -c["money"], -c["trades"], c["id"]))
    return cases
