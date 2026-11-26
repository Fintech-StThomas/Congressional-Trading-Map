"""validate_sec_events.py: a file built from the recorded EDGAR fixtures passes; each broken rule is reported."""
from __future__ import annotations

import copy
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from pipeline import validate_sec_events as v
from pipeline.sec_events import run as sec_run, window
from pipeline.tests.test_sec_events import sec  # noqa: F401 - the fake EDGAR session fixture
from pipeline.util import write_json
from pipeline.validate import Checker

ROWS = [{"org": "co:320193", "date": date(2026, 8, 20), "available": date(2026, 9, 1), "deleted": False},
        {"org": "co:1045810", "date": date(2020, 8, 1), "available": date(2020, 9, 1), "deleted": False},
        {"org": "co:95227", "date": None, "available": date(2016, 1, 4), "deleted": False},
        {"org": "co:320193", "date": date(2026, 4, 29), "available": date(2026, 5, 2), "deleted": True}]
BASE = {"org": {}, "ties": {}, "ledger_totals": {}, "chambers": {}, "years": [2020, 2026]}


@pytest.fixture
def built(sec, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(v, "BUILD", tmp_path)
    pq.write_table(pa.Table.from_pylist(ROWS), tmp_path / "trades_resolved.parquet")
    doc = sec_run.collect(sec_run.targets(ROWS), workers=1)
    write_json(window.PATH, doc)
    return doc


def org_file(doc, oid: str) -> dict:
    days = v.counted_trade_days(ROWS)
    return {**BASE, **window.org_fields(doc, oid, days.get(oid, []))}


def failures(doc=None, orgs: dict | None = None) -> dict[str, list[str]]:
    if doc is not None:
        write_json(window.PATH, doc)
    c = Checker()
    sec, days = v.check_sec_file(c)
    for oid, of in (orgs or {}).items():
        v.check_org_sec(c, sec, days, oid, of)
    return dict(c.errors)


def test_clean_build_passes(built) -> None:
    orgs = {o: org_file(built, o) for o in ("co:320193", "co:1045810", "co:95227", "pac:C00000001")}
    # Within 30 days of 2026-08-20; Apple's deleted trade of 2026-04-29 opens no window (no 2026-04-30 8-K).
    assert [e["date"] for e in orgs["co:320193"]["sec_events"]] == ["2026-07-30", "2026-09-01"]
    assert orgs["co:95227"]["sec_events"] == [] and "sec_events" not in orgs["pac:C00000001"]
    assert failures(orgs=orgs) == {}


def test_broken_events_are_reported(built) -> None:
    doc = copy.deepcopy(built)
    evs = doc["events"]["1045810"]
    evs[0]["items"] = ["2.2"]
    evs[1]["url"] = "https://example.com/filing.htm"
    evs[2]["date"] = "2020-13-01"
    evs[3], evs[4] = evs[4], evs[3]
    doc["report"]["events"] += 1
    rules = set(failures(doc))
    assert {"sec_events: items match d.dd", "sec_events: url is the filing on sec.gov", "sec_events: event date is ISO",
            "sec_events: events sorted by date", "sec_events: report counts agree with the file"} <= rules


def test_dropped_company_and_unlisted_partial_are_reported(built) -> None:
    doc = copy.deepcopy(built)
    del doc["coverage"]["95227"], doc["events"]["95227"]
    doc["coverage"]["320193"]["complete"] = False
    rules = set(failures(doc))
    assert "sec_events: every traded company is covered or listed as failed" in rules
    assert "sec_events: a partial span is listed in report.failed" in rules


def test_org_fields_must_match_the_file_and_the_window(built) -> None:
    apple = org_file(built, "co:320193")
    invented = {**apple["sec_events"][0], "accession": "0000320193-26-999999"}
    bad = {"co:320193": {**apple, "sec_events": apple["sec_events"] + [invented]},
           "co:1045810": {**BASE, "sec_coverage": built["coverage"]["1045810"], "sec_events": []},
           "co:5": {**BASE, "sec_coverage": {"from": "2020-01-01", "to": "2020-01-02", "complete": True}, "sec_events": []}}
    rules = set(failures(orgs=bad))
    assert {"sec_events: every published org event is in sec_events.json",
            "sec_events: org events are those within the window of a counted trade",
            "sec_events: org SEC fields exactly when the company has coverage"} <= rules


def test_without_the_file_no_org_may_carry_the_fields(sec, tmp_path, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setattr(v, "BUILD", tmp_path)
    of = {**BASE, "sec_coverage": {"from": "2020-01-01", "to": "2020-01-02", "complete": True}, "sec_events": []}
    assert set(failures(orgs={"co:320193": of, "co:1045810": BASE})) == {
        "sec_events: org SEC fields exactly when the company has coverage"}
