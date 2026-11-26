"""SEC 8-K events stage (pipeline/sec_events/; docs/sec-events.md) against recorded EDGAR responses.

Fixtures in fixtures/sec/ are real submissions responses fetched 2026-11-25: Apple (320193) and NVIDIA (1045810)
trimmed to a few rows (each page listing's filingCount and filingFrom set to the trimmed page), and Sumitomo Electric's
ADR (95227) whole, a foreign issuer that files no 8-K and has no older pages (NVIDIA's listed filingTo stays a day off its page's newest row, as SEC serves it). No network: a fake
session serves the files by name and counts the calls, and util.fetch writes the real download cache in tmp_path.
"""
from __future__ import annotations

import contextlib
from datetime import date
from pathlib import Path

import pytest
import requests

from pipeline import util
from pipeline.sec_events import run as sec_run, submissions, window

FIX = Path(__file__).parent / "fixtures" / "sec"
APPLE, NVIDIA, FOREIGN = 320193, 1045810, 95227


class FakeResponse:
    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status_code, self.body, self.headers = status, body, {"Content-Length": str(len(body))}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}", response=self)  # type: ignore[arg-type]

    def iter_content(self, n: int):
        yield self.body


class FakeSession:
    """Serves fixtures/sec/<name>; `fail` maps a name to an HTTP status to answer instead."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.fail: dict[str, int] = {}

    def get(self, url: str, headers=None, stream=False, timeout=None):
        name = url.rsplit("/", 1)[-1]
        self.calls.append(name)
        if name in self.fail:
            return contextlib.nullcontext(FakeResponse(self.fail[name]))
        path = FIX / name
        return contextlib.nullcontext(FakeResponse(200, path.read_bytes()) if path.exists() else FakeResponse(404))


@pytest.fixture
def sec(tmp_path, monkeypatch) -> FakeSession:
    session = FakeSession()
    monkeypatch.setattr(util, "_session", session)
    monkeypatch.setattr(util.time, "sleep", lambda s: None)     # retries without waiting
    monkeypatch.setattr(submissions, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(window, "PATH", tmp_path / "build" / "sec_events.json")
    monkeypatch.setattr(util, "SOURCES_DIR", tmp_path / "build" / "sources")
    return session


def read(cik: int, need_from: str):
    return submissions.read_company(cik, need_from, submissions.Stats())


def test_recent_block_only_when_the_older_page_is_not_needed(sec) -> None:
    cov, events, err = read(APPLE, "2020-01-01")
    assert err is None and sec.calls == ["CIK0000320193.json"]
    assert cov == {"from": "2015-10-07", "to": "2026-11-19", "complete": True}
    assert [e["date"] for e in events] == ["2026-04-30", "2026-07-30", "2026-09-01", "2026-11-02", "2026-11-09"]


def test_older_page_is_read_when_trades_reach_back(sec) -> None:
    cov, events, err = read(APPLE, "2014-01-01")
    assert err is None and sec.calls == ["CIK0000320193.json", "CIK0000320193-submissions-001.json"]
    # The page goes back to 1996, but nothing before SEC_EVENTS_FROM is kept (the 1996 8-K has item "7").
    assert cov == {"from": "2011-12-02", "to": "2026-11-19", "complete": True}
    assert [e["date"] for e in events][:3] == ["2015-07-31", "2015-09-17", "2015-10-02"]
    assert all(e["form"] in ("8-K", "8-K/A") for e in events) and len(events) == 8   # the 10-K and Form 4s are not events


def test_listed_page_end_a_day_off_is_still_read(sec) -> None:
    """NVIDIA's page is listed as ending 2020-09-16 but holds a filing of 2020-09-17: a company needing 2020-09-20
    still reads it (PAGE_MARGIN_DAYS), so the span stays unbroken."""
    cov, events, _ = read(NVIDIA, "2020-09-20")
    assert "CIK0001045810-submissions-001.json" in sec.calls and cov["from"] == "2020-07-01"


def test_event_shape_link_items_and_amendment(sec) -> None:
    _, events, _ = read(NVIDIA, "2011-12-02")
    amended = [e for e in events if e["form"] == "8-K/A"]
    assert amended == [{"date": "2020-07-01", "accepted": "2020-07-01T00:18:09.000Z", "form": "8-K/A",
                        "items": ["2.01", "9.01"], "accession": amended[0]["accession"],
                        "url": "https://www.sec.gov/Archives/edgar/data/1045810/"
                               f"{amended[0]['accession'].replace('-', '')}/nvda-20200427.htm"}]
    assert events == sorted(events, key=submissions.sort_key)
    assert next(e for e in events if e["date"] == "2020-09-14")["items"] == ["1.01", "7.01", "9.01"]


def test_complete_coverage_without_8k_is_an_empty_list(sec) -> None:
    doc = sec_run.collect({FOREIGN: "2014-01-01"}, workers=1)
    assert doc["coverage"] == {"95227": {"from": "2011-12-02", "to": "2026-11-10", "complete": True}}
    assert doc["events"] == {"95227": []} and doc["report"]["failed"] == [] and doc["report"]["events"] == 0


def test_missing_company_has_no_coverage_and_is_listed_failed(sec) -> None:
    doc = sec_run.collect({APPLE: "2020-01-01", 999999: "2020-01-01"}, workers=1)
    assert set(doc["coverage"]) == set(doc["events"]) == {"320193"}
    assert [f["cik"] for f in doc["report"]["failed"]] == ["999999"] and "404" in doc["report"]["failed"][0]["error"]
    assert doc["report"]["companies"] == 2 and doc["report"]["events"] == len(doc["events"]["320193"]) == 5


def test_failed_older_page_gives_partial_coverage(sec) -> None:
    sec.fail["CIK0000320193-submissions-001.json"] = 503
    doc = sec_run.collect({APPLE: "2014-01-01"}, workers=1)
    assert doc["coverage"]["320193"] == {"from": "2015-10-07", "to": "2026-11-19", "complete": False}
    assert doc["report"]["failed"][0]["cik"] == "320193" and all(e["date"] >= "2015-10-07" for e in doc["events"]["320193"])


def test_outage_stops_asking_after_a_streak(sec, monkeypatch) -> None:
    monkeypatch.setattr(sec_run, "SEC_EVENTS_MAX_STREAK", 2)
    doc = sec_run.collect({c: "2020-01-01" for c in (1, 2, 3, 4, 5)}, workers=1)
    assert doc["coverage"] == {} and len(doc["report"]["failed"]) == 5 and len(sec.calls) == 2
    assert all(f["error"].startswith("not attempted") for f in doc["report"]["failed"][2:])


def test_rerun_uses_the_cache(sec) -> None:
    need = {APPLE: "2014-01-01", NVIDIA: "2014-01-01", FOREIGN: "2014-01-01"}
    first = sec_run.collect(need, workers=1)
    assert (first["report"]["requests"], first["report"]["cached"]) == (5, 0)
    again = sec_run.collect(need, workers=1)
    assert (again["report"]["requests"], again["report"]["cached"]) == (0, 5) and len(sec.calls) == 5
    assert again["events"] == first["events"]


def test_cached_page_that_no_longer_matches_its_listing_is_fetched_again(sec) -> None:
    read(APPLE, "2014-01-01")
    page = submissions.CACHE_DIR / "CIK0000320193-submissions-001.json"
    page.write_text('{"filingDate": [], "form": [], "acceptanceDateTime": [], "accessionNumber": [], "items": [], '
                    '"primaryDocument": []}')
    cov, _, err = read(APPLE, "2014-01-01")
    assert err is None and cov["from"] == "2011-12-02" and sec.calls.count("CIK0000320193-submissions-001.json") == 2


def test_targets_counted_trades_of_sec_companies_only() -> None:
    rows = [{"org": "co:5", "date": date(2015, 3, 1), "available": None, "deleted": False},
            {"org": "co:5", "date": None, "available": date(2016, 1, 1), "deleted": False},
            {"org": "co:6", "date": date(2010, 1, 1), "available": None, "deleted": True},    # deleted: no target
            {"org": "co:7", "date": date(2012, 7, 9), "available": None, "deleted": False},
            {"org": "co:8", "date": None, "available": None, "deleted": False},
            {"org": "tk:XYZ", "date": date(2020, 1, 1), "available": None, "deleted": False},
            {"org": None, "date": date(2020, 1, 1), "available": None, "deleted": False}]
    assert sec_run.targets(rows) == {5: "2015-01-30", 7: "2012-06-09", 8: "2011-12-02"}


def test_window_rule_for_org_files() -> None:
    events = [{"date": d, "accession": d} for d in ("2020-01-01", "2020-01-31", "2020-02-01", "2020-06-01")]
    assert [e["date"] for e in window.in_window(events, [date(2020, 1, 1)])] == ["2020-01-01", "2020-01-31"]
    assert [e["date"] for e in window.in_window(events, [date(2020, 3, 2)])] == ["2020-02-01"]   # 30 days before
    assert window.in_window(events, []) == []
    sec = {"coverage": {"5": {"from": "2019-01-01", "to": "2020-12-31", "complete": True}}, "events": {"5": events}}
    assert window.org_fields(sec, "co:5", [date(2020, 6, 15)]) == {"sec_coverage": sec["coverage"]["5"],
                                                                    "sec_events": [events[3]]}
    assert window.org_fields(sec, "co:6", [date(2020, 6, 15)]) == {}     # no coverage: fields absent
    assert window.org_fields(sec, "tk:AB", []) == {} and window.org_fields(None, "co:5", []) == {}


def test_stage_failure_removes_its_outputs(sec, monkeypatch) -> None:
    from pipeline import run as pipeline_run
    sec_run.write(sec_run.collect({APPLE: "2020-01-01"}, workers=1))
    assert window.PATH.exists() and (util.SOURCES_DIR / "sec_events.json").exists()
    monkeypatch.setattr(sec_run, "run", lambda: (_ for _ in ()).throw(OSError("disk")))
    pipeline_run.sec_events()
    assert not window.PATH.exists() and not (util.SOURCES_DIR / "sec_events.json").exists()
