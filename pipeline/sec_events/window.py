"""The window rule for OrgFile.sec_events (docs/sec-events.md): the company's 8-K events filed within
SEC_EVENT_WINDOW_DAYS days either side of the transaction date of any counted trade in it. Trades without a
transaction date open no window. Pure functions plus `load`; used by the assembler and by validate_sec_events.py.

A company gets `sec_events` and `sec_coverage` only when sec_events.json has coverage for its CIK; without it (stage
not run, fetch failed, or an older release) both fields are absent, which the site reads as "not available".
"""
from __future__ import annotations

import bisect
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

from ..config import SEC_EVENT_WINDOW_DAYS
from ..util import BUILD, read_json

PATH = BUILD / "sec_events.json"


def load(path: Path | None = None) -> dict[str, Any] | None:
    """sec_events.json, or None when the stage did not write it."""
    p = path or PATH
    return read_json(p) if p.exists() else None


def cik_of(org_id: str) -> str | None:
    """The decimal CIK of a `co:<CIK>` org id (data dictionary: "Identifiers"), else None."""
    rest = org_id[3:] if org_id.startswith("co:") else ""
    return str(int(rest)) if rest.isdigit() else None


def in_window(events: list[dict[str, Any]], trade_dates: Iterable[date],
              days: int = SEC_EVENT_WINDOW_DAYS) -> list[dict[str, Any]]:
    """The events (order kept) whose filing date is at most `days` days before or after some trade date."""
    ds = sorted(set(trade_dates))
    out = []
    for e in events:
        d = date.fromisoformat(e["date"])
        i = bisect.bisect_left(ds, d - timedelta(days=days))
        if i < len(ds) and ds[i] <= d + timedelta(days=days):
            out.append(e)
    return out


def org_fields(sec: dict[str, Any] | None, org_id: str, trade_dates: Iterable[date]) -> dict[str, Any]:
    """{"sec_events", "sec_coverage"} for one org file, or {} when there is no coverage for it."""
    cik = cik_of(org_id)
    cov = (sec or {}).get("coverage", {}).get(cik) if cik else None
    if cov is None:
        return {}
    return {"sec_coverage": cov, "sec_events": in_window(sec["events"].get(cik, []), trade_dates)}
