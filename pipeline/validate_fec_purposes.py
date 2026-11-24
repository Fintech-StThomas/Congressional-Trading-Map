"""Checks for the FEC purpose groups of a leadership PAC-year and for the sponsor-link method strings (data dictionary:
"Campaign finance block"). Called from validate_fec_spending.py.

`purposes` is null (not fetched) or a list of {purpose, total, count}: the FEC's own labels (upper-case words, never
free text), total >= 0 or null (null only where the API's figure was negative), count an integer >= 0, unique labels,
sorted by total descending (null last) then label. A non-null list needs the cycle in `coverage.purposes_cycles`, and the
committee must be linked to the member (the caller checks that).
"""
from __future__ import annotations

import re
from itertools import combinations
from typing import Any

ATOMS = ("fec_api_sponsor_id", "fec_candidate_id", "leadership_file_exact_name")
LINK_METHODS = {"+".join(c) for n in (1, 2, 3) for c in combinations(ATOMS, n)}   # atoms are already in sorted order
PURPOSE_LABEL = re.compile(r"^[A-Z][A-Z0-9 &/,.'()_-]{0,59}$")


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_purposes(c: Any, p: Any, where: str, cycle: int, purposes_cycles: list[int]) -> None:
    rule = "campaign_finance: purpose groups"
    if p is None:
        return
    c.check(isinstance(p, list), rule + " are null or a list", where)
    if not isinstance(p, list):
        return
    c.check(cycle in purposes_cycles, rule + ": a list only for a cycle in coverage.purposes_cycles", where)
    ok = True
    for i, g in enumerate(p):
        w = f"{where}[{i}]"
        good = isinstance(g, dict) and set(g) == {"purpose", "total", "count"}
        c.check(good, rule + ": schema", w)
        if not good:
            ok = False
            continue
        c.check(isinstance(g["purpose"], str) and PURPOSE_LABEL.match(g["purpose"]) is not None,
                rule + ": label is an FEC label, not free text", f"{w}={str(g['purpose'])[:40]}")
        c.check(g["total"] is None or (_is_num(g["total"]) and g["total"] >= 0), rule + ": total not negative", w)
        c.check(isinstance(g["count"], int) and not isinstance(g["count"], bool) and g["count"] >= 0,
                rule + ": count is an integer >= 0", w)
    if ok:
        labels = [g["purpose"] for g in p]
        c.check(len(labels) == len(set(labels)), rule + ": one row per label", where)
        key = [(g["total"] is None, -(g["total"] or 0), g["purpose"]) for g in p]
        c.check(key == sorted(key), rule + ": sorted by total descending, then label", where)


def check_coverage(c: Any, cov: dict[str, Any], where: str) -> None:
    cycles = cov.get("purposes_cycles")
    ok = isinstance(cycles, list) and all(isinstance(x, int) and 2004 <= x <= 2100 and x % 2 == 0 for x in cycles) \
        and cycles == sorted(set(cycles))
    c.check(ok, "campaign_finance: purposes_cycles even years from 2004, unique, ordered", where)
    c.check(isinstance(cov.get("purposes_source"), str) and cov["purposes_source"] != "",
            "campaign_finance: purposes_source note present", where)
    if ok and cycles:
        c.check("accessed 20" in cov["purposes_source"], "campaign_finance: purposes_source names the access date", where)
