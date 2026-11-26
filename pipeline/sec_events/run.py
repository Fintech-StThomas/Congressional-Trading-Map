"""The sec_events stage: Form 8-K filing events for every company members traded (docs/sec-events.md).

Reads pipeline/build/trades_resolved.parquet (after edges_trades): every `co:<CIK>` org of at least one counted trade
(not deleted by a later filing) is a target, and it needs filings from 30 days before its earliest counted trade
(transaction date, else availability date), never before SEC_EVENTS_FROM. Downloads through submissions.read_company
with SEC_EVENTS_WORKERS threads sharing one SEC_REQUESTS_PER_SECOND limiter and the declared User-Agent. Writes
pipeline/build/sec_events.json (contract: data dictionary, "SEC 8-K events") and sources/sec_events.json (merged into
meta.json). A failed company is listed in report.failed and has no coverage; after SEC_EVENTS_MAX_STREAK failures in a
row (outage, rate limit) the remaining companies are listed as not attempted. Never raises for a download problem.

`python -m pipeline.sec_events.run [--cik N ...]` runs the stage alone; with --cik it fetches only those companies
(from SEC_EVENTS_FROM) and writes pipeline/build/sec_events_sample.json instead, for a live check.
"""
from __future__ import annotations

import argparse
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import pyarrow.parquet as pq

from ..config import (SEC_EVENT_WINDOW_DAYS, SEC_EVENTS_FROM, SEC_EVENTS_MAX_STREAK, SEC_EVENTS_WORKERS,
                      SEC_REQUESTS_PER_SECOND)
from .. import util
from ..util import BUILD, RateLimiter, utc_now, write_json, write_source_meta
from . import submissions, window
from .window import cik_of

SOURCE_ID = "sec_edgar_submissions"
FAILED_IN_META = 25   # meta.json carries the failure count and the first few; sec_events.json lists them all


def targets(rows: list[dict[str, Any]]) -> dict[int, str]:
    """CIK -> earliest filing date needed, from trade rows with org, date, available, deleted."""
    first: dict[int, date | None] = {}
    for r in rows:
        cik = cik_of(r["org"] or "")
        if r["deleted"] or cik is None:
            continue
        d = r["date"] or r["available"]
        prev = first.get(int(cik), date.max)
        first[int(cik)] = None if d is None or prev is None else min(prev, d)
    return {cik: max(SEC_EVENTS_FROM, (d - timedelta(days=SEC_EVENT_WINDOW_DAYS)).isoformat()) if d else SEC_EVENTS_FROM
            for cik, d in sorted(first.items())}


def collect(need: dict[int, str], workers: int = SEC_EVENTS_WORKERS) -> dict[str, Any]:
    """The sec_events.json document for these companies."""
    stats, limiter = submissions.Stats(), RateLimiter(SEC_REQUESTS_PER_SECOND)
    lock, stop = threading.Lock(), threading.Event()
    streak = [0]

    def one(cik: int) -> tuple[int, Any, list[Any], str | None]:
        if stop.is_set():
            return cik, None, [], f"not attempted: stopped after {SEC_EVENTS_MAX_STREAK} failed companies in a row"
        cov, events, err = submissions.read_company(cik, need[cik], stats, limiter)
        with lock:
            streak[0] = streak[0] + 1 if cov is None else 0
            if streak[0] >= SEC_EVENTS_MAX_STREAK:
                stop.set()
        return cik, cov, events, err

    coverage: dict[str, Any] = {}
    events: dict[str, list[Any]] = {}
    failed: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for cik, cov, evs, err in pool.map(one, sorted(need)):
            if cov is not None:
                coverage[str(cik)], events[str(cik)] = cov, evs
            if err is not None:
                failed.append({"cik": str(cik), "error": err})
    return {"source": SOURCE_ID, "fetched": date.today().isoformat(), "coverage": coverage, "events": events,
            "report": {"companies": len(need), "requests": stats.requests, "cached": stats.cached, "failed": failed,
                       "events": sum(len(v) for v in events.values())}}


def clear() -> None:
    """Remove this stage's outputs, so a failed run never leaves an earlier run's coverage in place."""
    for p in (window.PATH, util.SOURCES_DIR / "sec_events.json"):
        p.unlink(missing_ok=True)


def write(doc: dict[str, Any]) -> None:
    write_json(window.PATH, doc)
    r = doc["report"]
    partial = sum(1 for c in doc["coverage"].values() if not c["complete"])
    write_source_meta("sec_events", {SOURCE_ID: {
        "name": "SEC EDGAR submissions API (Form 8-K and 8-K/A filing dates and items)",
        "url": "https://data.sec.gov/submissions/", "revision": None, "retrieved": utc_now(),
        "licence": "U.S. government work (public domain)"}},
        {**r, "failed": len(r["failed"]), "failed_first": r["failed"][:FAILED_IN_META], "covered": len(doc["coverage"]),
         "partial": partial, "window_days": SEC_EVENT_WINDOW_DAYS, "events_from": SEC_EVENTS_FROM})


def run(ciks: list[int] | None = None) -> dict[str, Any]:
    t0 = time.monotonic()
    if ciks:
        need = {c: SEC_EVENTS_FROM for c in sorted(set(ciks))}
    else:
        cols = ["org", "date", "available", "deleted"]
        need = targets(pq.read_table(BUILD / "trades_resolved.parquet", columns=cols).to_pylist())
    doc = collect(need)
    if ciks:
        write_json(BUILD / "sec_events_sample.json", doc, pretty=True)
    else:
        write(doc)
    r = doc["report"]
    print(f"sec_events: {r['companies']} companies, {len(doc['coverage'])} covered "
          f"({sum(not c['complete'] for c in doc['coverage'].values())} partial), {len(r['failed'])} failed; "
          f"{r['events']} 8-K events; {r['requests']} requests, {r['cached']} cached, {time.monotonic() - t0:.0f} s")
    for f in r["failed"][:10]:
        print(f"  failed {f['cik']}: {f['error'][:160]}")
    return doc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cik", type=int, action="append", help="fetch only this company (repeatable)")
    args = parser.parse_args(argv)
    run(args.cik)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
