"""Checks for SEC 8-K events (data dictionary: "SEC 8-K events"; rules in docs/sec-events.md). Called from validate.main.

pipeline/build/sec_events.json: source and fetch date, coverage spans (ISO dates, from <= to, complete a boolean),
events only for covered companies and inside their span, ISO dates, form 8-K or 8-K/A, items `d.dd`, accession
numbers, links into the company's sec.gov Archives folder, events sorted by date, and report counts that agree with
the file and with the companies re-derived from trades_resolved.parquet (covered or failed, nothing dropped).
Org files: `sec_events` / `sec_coverage` appear together, exactly when the company has coverage, and equal the window
rule re-derived from the counted trades, so every published event is one of sec_events.json's. Without the file (the
stage failed or did not run) no org file may carry the fields.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any

import pyarrow.parquet as pq

from .sec_events.run import SOURCE_ID, targets
from .sec_events.window import in_window, load
from .util import BUILD

ORG_SEC_KEYS = {"sec_events", "sec_coverage"}
EVENT_KEYS = {"date", "accepted", "form", "items", "accession", "url"}
ITEM = re.compile(r"\d\.\d\d")
ACCESSION = re.compile(r"\d{10}-\d{2}-\d{6}")
RULE = "sec_events"


def _iso(v: Any) -> bool:
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def _iso_time(v: Any) -> bool:
    try:
        return isinstance(v, str) and bool(datetime.fromisoformat(v.replace("Z", "+00:00")))
    except ValueError:
        return False


def check_event(c: Any, e: Any, cik: str, cov: dict[str, Any], where: str) -> None:
    ok = isinstance(e, dict) and set(e) == EVENT_KEYS
    c.check(ok, f"{RULE}: event schema", where)
    if not ok:
        return
    c.check(_iso(e["date"]), f"{RULE}: event date is ISO", f"{where}={e['date']}")
    c.check(e["accepted"] is None or _iso_time(e["accepted"]), f"{RULE}: accepted is null or an ISO time", where)
    c.check(e["form"] in ("8-K", "8-K/A"), f"{RULE}: form is 8-K or 8-K/A", f"{where}={e['form']}")
    c.check(isinstance(e["items"], list) and all(isinstance(i, str) and ITEM.fullmatch(i) for i in e["items"]),
            f"{RULE}: items match d.dd", f"{where}={e['items']}")
    c.check(isinstance(e["accession"], str) and bool(ACCESSION.fullmatch(e["accession"])), f"{RULE}: accession", where)
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{str(e['accession']).replace('-', '')}/"
    c.check(isinstance(e["url"], str) and e["url"].startswith(folder), f"{RULE}: url is the filing on sec.gov", where)
    c.check(_iso(e["date"]) and cov["from"] <= e["date"] <= cov["to"], f"{RULE}: event inside its coverage span", where)


def counted_trade_days(rows: list[dict[str, Any]]) -> dict[str, list[date]]:
    days: dict[str, list[date]] = defaultdict(list)
    for r in rows:
        if r["org"] and r["date"] and not r["deleted"]:
            days[r["org"]].append(r["date"])
    return days


def check_sec_file(c: Any) -> tuple[dict[str, Any] | None, dict[str, list[date]]]:
    """(sec_events.json or None, counted trade dates by org) for check_org_sec."""
    sec = load()
    if sec is None:
        print("sec_events: no pipeline/build/sec_events.json; org files must carry no SEC fields")
        return None, {}
    rows = pq.read_table(BUILD / "trades_resolved.parquet", columns=["org", "date", "available", "deleted"]).to_pylist()
    c.check(set(sec) == {"source", "fetched", "coverage", "events", "report"} and sec["source"] == SOURCE_ID
            and _iso(sec["fetched"]), f"{RULE}: file schema", "sec_events.json")
    cov, events, rep = sec["coverage"], sec["events"], sec["report"]
    for cik, span in cov.items():
        ok = (isinstance(span, dict) and set(span) == {"from", "to", "complete"} and _iso(span["from"])
              and _iso(span["to"]) and span["from"] <= span["to"] and isinstance(span["complete"], bool))
        c.check(ok and cik.isdigit() and str(int(cik)) == cik, f"{RULE}: coverage span schema", cik)
        evs = events.get(cik)
        c.check(isinstance(evs, list), f"{RULE}: every covered company has an event list", cik)
        if not ok or not isinstance(evs, list):
            continue
        for i, e in enumerate(evs):
            check_event(c, e, cik, span, f"{cik}[{i}]")
        dates = [e.get("date") or "" for e in evs if isinstance(e, dict)]
        c.check(dates == sorted(dates), f"{RULE}: events sorted by date", cik)
        c.check(len({e.get("accession") for e in evs if isinstance(e, dict)}) == len(evs), f"{RULE}: accessions unique", cik)
    c.check(set(events) == set(cov), f"{RULE}: events only for covered companies", str(sorted(set(events) ^ set(cov))[:5]))
    failed = {f.get("cik"): f.get("error") for f in rep.get("failed", [])}
    c.check(all(isinstance(e, str) and e for e in failed.values()) and len(failed) == len(rep.get("failed", [])),
            f"{RULE}: report.failed lists each company once with an error", "")
    c.check(all(not cov[k]["complete"] for k in failed if k in cov), f"{RULE}: a failed company is uncovered or partial", "")
    c.check(all(span["complete"] or k in failed for k, span in cov.items() if isinstance(span, dict)),
            f"{RULE}: a partial span is listed in report.failed", "")
    wanted = {str(k) for k in targets(rows)}
    c.check(set(cov) | set(failed) == wanted, f"{RULE}: every traded company is covered or listed as failed",
            str(sorted(wanted ^ (set(cov) | set(failed)))[:5]))
    nums = all(isinstance(rep.get(k), int) and rep[k] >= 0 for k in ("companies", "requests", "cached", "events"))
    c.check(nums and rep["companies"] == len(wanted) and rep["events"] == sum(len(v) for v in events.values())
            and rep["requests"] + rep["cached"] >= len(cov), f"{RULE}: report counts agree with the file", str(rep)[:200])
    return sec, counted_trade_days(rows)


def check_org_sec(c: Any, sec: dict[str, Any] | None, days: dict[str, list[date]], oid: str, of: dict[str, Any]) -> None:
    present = ORG_SEC_KEYS & set(of)
    c.check(present in (set(), ORG_SEC_KEYS), f"{RULE}: org sec_events and sec_coverage appear together", oid)
    cik = oid[3:] if oid.startswith("co:") else None
    span = (sec or {}).get("coverage", {}).get(cik) if cik else None
    c.check(bool(present) == (span is not None), f"{RULE}: org SEC fields exactly when the company has coverage", oid)
    if span is None or present != ORG_SEC_KEYS:
        return
    c.check(of["sec_coverage"] == span, f"{RULE}: org sec_coverage equals sec_events.json", oid)
    known = {e["accession"]: e for e in sec["events"].get(cik, [])}
    c.check(all(known.get(e.get("accession")) == e for e in of["sec_events"]),
            f"{RULE}: every published org event is in sec_events.json", oid)
    c.check(of["sec_events"] == in_window(sec["events"].get(cik, []), days.get(oid, [])),
            f"{RULE}: org events are those within the window of a counted trade", oid)
