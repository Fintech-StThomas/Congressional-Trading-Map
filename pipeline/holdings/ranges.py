"""Range arithmetic for the holdings outputs: disclosed bands are summed low with low and high with high, never
averaged (docs/data-dictionary.md, "Holdings and net worth", Ranges). Shared by run, positions, profile and validate."""
from __future__ import annotations

from typing import Any


def band_sum(items: list[tuple[int | None, int | None]]) -> dict[str, Any]:
    """Assets: lows add (unvalued count 0 toward low); high null if any item is unvalued or open-ended."""
    valued = [(lo, hi) for lo, hi in items if lo is not None]
    open_ended = sum(1 for lo, hi in valued if hi is None)
    unvalued = len(items) - len(valued)
    low = sum(lo for lo, _ in valued)
    high_valued = None if open_ended else sum(hi for _, hi in valued)
    return {"n": len(items), "unvalued": unvalued, "open_ended": open_ended, "low": low,
            "high": None if (open_ended or unvalued) else high_valued, "high_valued": high_valued}


def net_worth(a: dict[str, Any], l: dict[str, Any]) -> dict[str, Any]:
    low = None if l["high"] is None else a["low"] - l["high"]
    high = None if a["high"] is None else a["high"] - l["low"]
    high_valued = None if a["high_valued"] is None else a["high_valued"] - l["low"]
    if a["open_ended"]:
        label = "at least" if low is not None else "unbounded"
    elif a["unvalued"]:
        label = "valued items only"
    else:
        label = "range"
    return {"low": low, "high": high, "high_valued": high_valued, "label": label,
            "unvalued_assets": a["unvalued"], "open_ended_assets": a["open_ended"],
            "open_ended_liabilities": l["open_ended"]}
