"""Read one company's Form 8-K and 8-K/A filings from the SEC EDGAR submissions API (docs/sec-events.md).

`https://data.sec.gov/submissions/CIK##########.json` holds the most recent filings (`filings.recent`, at least a year
or 1,000 filings); older filings are on the pages listed in `filings.files`, each with filingFrom, filingTo and
filingCount. A page is read only when its filingTo is on or after the date this company needs (`need_from`), newest
page first, and the first failure stops the paging so the rows read are always one unbroken span. Every response is
cached under pipeline/.cache/sec/submissions/ through util.fetch; a cached page whose filing count no longer matches its
listing is fetched again. Writes nothing else; `read_company` returns (coverage or None, events, error or None).
"""
from __future__ import annotations

import threading
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from ..config import SEC_EVENTS_FROM, SEC_SUBMISSIONS_FILES_MAX_AGE, SEC_SUBMISSIONS_MAX_AGE
from ..util import CACHE, RateLimiter, fetch, read_json

SUBMISSIONS = "https://data.sec.gov/submissions/"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data/"
FORMS = ("8-K", "8-K/A")
COLS = ("form", "filingDate", "acceptanceDateTime", "accessionNumber", "items", "primaryDocument")
PAGE_MARGIN_DAYS = 7   # a listed filingTo can be a day off the page's own dates: read a page ending this close too
CACHE_DIR: Path = CACHE / "sec" / "submissions"   # tests point this elsewhere

Event = dict[str, Any]
Coverage = dict[str, Any]


class Stats:
    """Responses counted across threads: `requests` were downloaded, `cached` came from pipeline/.cache."""

    def __init__(self) -> None:
        self.requests = 0
        self.cached = 0
        self._lock = threading.Lock()

    def add(self, cached: bool) -> None:
        with self._lock:
            if cached:
                self.cached += 1
            else:
                self.requests += 1


def get_json(name: str, max_age: float, stats: Stats, limiter: RateLimiter | None, force: bool = False) -> dict[str, Any]:
    """One submissions response, through the download cache. force=True ignores a cached copy."""
    dest = CACHE_DIR / name
    before = dest.stat().st_mtime_ns if dest.exists() else None
    fetch(SUBMISSIONS + name, dest, max_age=0.0 if force else max_age, limiter=limiter)
    stats.add(cached=before is not None and dest.stat().st_mtime_ns == before)
    try:
        doc = read_json(dest)
    except ValueError as e:
        dest.unlink()   # never keep an unreadable copy: the next run downloads it again
        raise RuntimeError(f"unreadable JSON in {name}: {e}") from e
    if not isinstance(doc, dict):
        raise RuntimeError(f"{name}: not a JSON object")
    return doc


def block_rows(block: dict[str, Any], name: str) -> list[dict[str, Any]]:
    """Columnar filings block -> one dict per filing. Columns of unequal length are an error, never truncated."""
    n = len(block.get("filingDate") or [])
    for col in COLS:
        if len(block.get(col) or []) != n:
            raise ValueError(f"{name}: column {col} has {len(block.get(col) or [])} values, filingDate {n}")
    return [{col: block[col][i] for col in COLS} for i in range(n)]


def page_matches(rows: list[dict[str, Any]], listing: dict[str, Any]) -> bool:
    """A page has the filing count its entry in filings.files states. (Its dates are not compared: the listed
    filingTo can be a day off the page's own latest filingDate, e.g. NVIDIA's first page on 2026-11-25.)"""
    return bool(rows) and len(rows) == listing.get("filingCount")


def event(cik: int, r: dict[str, Any]) -> Event:
    """A filing row in the contract's event shape. Without a primaryDocument the link is the filing's folder."""
    acc = r["accessionNumber"]
    return {"date": r["filingDate"], "accepted": r["acceptanceDateTime"] or None, "form": r["form"],
            "items": [x.strip() for x in (r["items"] or "").split(",") if x.strip()], "accession": acc,
            "url": f"{ARCHIVES}{cik}/{acc.replace('-', '')}/{r['primaryDocument'] or ''}"}


def sort_key(e: Event) -> tuple[str, str, str]:
    return e["date"], e["accepted"] or "", e["accession"]


def read_company(cik: int, need_from: str, stats: Stats,
                 limiter: RateLimiter | None = None) -> tuple[Coverage | None, list[Event], str | None]:
    """(coverage, events sorted by date, error). coverage is None when the company file itself could not be read;
    with a later page failing it is the unbroken span read so far with complete false, and the error is returned."""
    name = f"CIK{cik:010d}.json"
    try:
        top = get_json(name, SEC_SUBMISSIONS_MAX_AGE, stats, limiter)
        rows = block_rows(top["filings"]["recent"], name)
        listings = sorted(top["filings"].get("files") or [], key=lambda f: f["filingTo"], reverse=True)
    except Exception as e:  # noqa: BLE001 - recorded per company, never fatal for the stage
        return None, [], f"{name}: {type(e).__name__}: {e}"
    error = None
    margin = (date.fromisoformat(need_from) - timedelta(days=PAGE_MARGIN_DAYS)).isoformat()
    for listing in listings:
        if listing["filingTo"] < margin:
            break   # this page and every older one end before the earliest date this company needs
        try:
            page = block_rows(get_json(listing["name"], SEC_SUBMISSIONS_FILES_MAX_AGE, stats, limiter), listing["name"])
            if not page_matches(page, listing):   # a cached page from before SEC regenerated it
                page = block_rows(get_json(listing["name"], 0.0, stats, limiter, force=True), listing["name"])
                if not page_matches(page, listing):
                    raise ValueError(f"{listing['name']} does not match its listing in {name}")
        except Exception as e:  # noqa: BLE001
            error = f"{listing['name']}: {type(e).__name__}: {e}"
            break
        rows += page
    if not rows:
        return None, [], f"{name}: no filings listed"
    dates = [r["filingDate"] for r in rows]
    start = max(min(dates), SEC_EVENTS_FROM)   # earliest filing read, never before the first date kept
    cov = {"from": start, "to": max(max(dates), start), "complete": error is None}
    seen: dict[str, Event] = {}
    for r in rows:
        if r["form"] in FORMS and r["filingDate"] >= cov["from"]:
            seen.setdefault(r["accessionNumber"], event(cik, r))
    return cov, sorted(seen.values(), key=sort_key), error
