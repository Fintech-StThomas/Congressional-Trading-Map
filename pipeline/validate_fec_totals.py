"""Checks for the FEC committee totals of a leadership PAC-year and their coverage keys (data dictionary: "Campaign finance
block"; rules in docs/leadership-pac-totals.md). Called from validate_fec_spending.py.

`totals` is null (not fetched, no row, or nothing publishable) or an object with exactly the keys below: seven figures that are
each null or a number >= 0 (exact dollars, never a placeholder zero) and `coverage_end_date`, a real date inside the cycle
(YYYY-MM-DD, in the cycle's two years). A non-null object has at least one figure and needs the cycle in
`coverage.totals_cycles`. Nothing here reads a payee or a row: the figures are the FEC's committee summary.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

FIGURES = ("receipts", "disbursements", "contributions_to_committees", "operating_expenditures", "contribution_refunds",
           "other_disbursements", "cash_on_hand")
KEYS = set(FIGURES) | {"coverage_end_date"}


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _real_date(v: Any) -> date | None:
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def check_totals(c: Any, t: Any, where: str, cycle: int, totals_cycles: list[int]) -> None:
    rule = "campaign_finance: committee totals"
    if t is None:
        return
    good = isinstance(t, dict) and set(t) == KEYS
    c.check(good, rule + ": schema", f"{where}: keys {sorted(set(t) ^ KEYS) if isinstance(t, dict) else 'not an object'}")
    if not good:
        return
    c.check(cycle in totals_cycles, rule + ": an object only for a cycle in coverage.totals_cycles", where)
    for k in FIGURES:
        v = t[k]
        c.check(v is None or (_is_num(v) and v >= 0), rule + ": a figure is null or not negative", f"{where}.{k}={v}")
    c.check(any(t[k] is not None for k in FIGURES), rule + ": at least one figure, else the object is null", where)
    d = _real_date(t["coverage_end_date"])
    c.check(d is not None, rule + ": coverage_end_date is a real date", f"{where}={t['coverage_end_date']}")
    if d is not None:
        c.check(d.year in (cycle - 1, cycle), rule + ": coverage_end_date lies in the cycle", f"{where}={t['coverage_end_date']} cycle {cycle}")


def check_coverage(c: Any, cov: dict[str, Any], where: str) -> None:
    cycles = cov.get("totals_cycles")
    ok = isinstance(cycles, list) and all(isinstance(x, int) and not isinstance(x, bool) and 2004 <= x <= 2100 and x % 2 == 0
                                          for x in cycles) and cycles == sorted(set(cycles))
    c.check(ok, "campaign_finance: totals_cycles even years from 2004, unique, ordered", where)
    c.check(isinstance(cov.get("totals_source"), str) and cov["totals_source"] != "",
            "campaign_finance: totals_source note present", where)
    if ok and cycles:
        c.check("accessed 20" in cov["totals_source"], "campaign_finance: totals_source names the access date", where)
