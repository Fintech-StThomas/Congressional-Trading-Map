"""How often a review-flag rule would be met by chance, where that can be computed (docs/review-flags.md, "Expected by
chance"). Pure functions; reads and writes nothing. Used by flags.py (summed while the rules run), flags_out.py (the
`baseline` block) and validate_flags.py (recomputed from the published files).

- pile_on: for each evaluated trade, the chance that a Poisson count with mean `expected` (the trade's expected number
  of other members, as in the rule) reaches the rule's bar: at least 2 and at least 3 x expected.
- Summed over evaluated trades, this gives the number of trades expected to meet the rule by chance.
- late, large_amount, money_both_ways, sector_overseen are descriptive: they describe the trade, not a coincidence of
  timing, so no chance figure is given.
"""
from __future__ import annotations

from math import ceil, exp
from typing import Any

from .. import config as K

DESCRIPTIVE = ("late", "large_amount", "money_both_ways", "sector_overseen")
METHODS = {
    "late": "Descriptive: the rule describes the filing's timing, not a coincidence, so no chance figure is given.",
    "large_amount": "Descriptive: the rule describes the trade's size, so no chance figure is given.",
    "money_both_ways": "Descriptive: the rule joins two filed records about the same company, so no chance figure is given.",
    "sector_overseen": "Descriptive: the rule joins the member's committee seat and the company's industry, so no chance figure is given.",
    "pile_on": ("For each evaluated trade, the chance that a Poisson count with mean equal to its expected number of other "
                "members reaches the bar (at least 2 and at least 3 times expected), summed over evaluated trades."),
}


def poisson_at_least(lam: float, k: int) -> float:
    """P(X >= k) for X ~ Poisson(lam)."""
    if k <= 0:
        return 1.0
    term = total = exp(-lam)
    for i in range(1, k):
        term *= lam / i
        total += term
    return max(0.0, 1.0 - total)


def pile_on_chance(expected: float) -> float:
    """Chance that a trade with this `expected` meets pile_on by chance (Poisson approximation)."""
    bar = max(K.FLAGS_PILE_ON_MIN_OTHERS, ceil(K.FLAGS_PILE_ON_LIFT * expected - 1e-9))
    return poisson_at_least(expected, bar)


def baseline(rule: str, evaluated: int, expected_met: float | None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """The `baseline` block of one rule (flags.json rules[], meta.json.flags.baselines)."""
    if rule in DESCRIPTIVE:
        return {"kind": "descriptive", "expected_met": None, "expected_share": None, "method": METHODS[rule]}
    return {"kind": "chance", "expected_met": None if expected_met is None else round(expected_met, 1),
            "expected_share": None if expected_met is None or not evaluated else round(expected_met / evaluated, 4),
            "method": METHODS[rule], **(extra or {})}
