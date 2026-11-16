"""Congress.gov pilot (pipeline/congress/): parsing, pagination, exact-id joins, gating and no network.

Fixtures in pipeline/tests/fixtures/congress/ are trimmed real responses recorded on 2026-11-16 (no keys, no headers).
"""
import csv
import json
from pathlib import Path

import pytest
import requests

from pipeline.congress import download as dl
from pipeline.congress import facts, run as crun

FIX = Path(__file__).parent / "fixtures" / "congress"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, text, status=200):
        self.text, self.status_code, self.headers = text, status, {}


class FakeSession:
    """Serves fixture pages by (path, offset) and records every call, so a test can check requests and the key."""

    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, dict(params or {}), headers))
        key = (url.removeprefix(dl.API), (params or {}).get("offset"))
        if key not in self.routes:
            return FakeResponse("{}", 404)
        return FakeResponse(json.dumps(self.routes[key]))


@pytest.fixture(autouse=True)
def no_network(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise AssertionError("network used in a unit test")
    monkeypatch.setattr(requests.Session, "request", boom)
    monkeypatch.setattr(dl, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(crun, "OUT", tmp_path / "out")
    monkeypatch.setattr(crun, "SAMPLE", tmp_path / "out" / "congress-sample.csv")
    monkeypatch.setattr(crun, "REVIEWED_SAMPLE", tmp_path / "docs" / "congress-sample.csv")
    monkeypatch.delenv("PT_ENABLE_CONGRESS", raising=False)
    monkeypatch.delenv("CONGRESS_API_KEY", raising=False)


def test_parse_member_checks_exact_id():
    info = facts.parse_member(load("member_T000250.json"), "T000250")
    assert info["bioguide"] == "T000250" and info["current"] and info["chamber"] == "Senate"
    with pytest.raises(ValueError):
        facts.parse_member(load("member_T000250.json"), "J000299")


def test_bill_row_ids_and_drops():
    items = load("sponsored_T000250_p1.json")["sponsoredLegislation"]
    rows = [facts.bill_row(i, "T000250", "sponsor", 119) for i in items]
    kept = [r for r in rows if r]
    assert len(kept) == 3 and len(rows) == 5          # an amendment and an older-Congress bill are dropped
    r = kept[0]
    assert r["bill_id"] == f"119-{r['bill_type']}-{r['number']}"
    assert r["congress_url"].startswith("https://www.congress.gov/bill/119th-congress/")
    assert "api_key" not in json.dumps(kept)


def test_pagination_follows_next_and_caches_raw(tmp_path):
    base = "/member/T000250/sponsored-legislation"
    s = FakeSession({(base, 0): load("sponsored_T000250_p1.json"), (base, 250): load("sponsored_T000250_p2.json")})
    c = dl.Client(session=s, pause=0, sleep=lambda _: None)
    state = dl.fetch_list(c, "T000250", "sponsor")
    assert state["pages"] == 2 and state["complete"] and c.requests_made == 2
    assert [call[1]["offset"] for call in s.calls] == [0, 250]
    assert dl.page_path("T000250", "sponsor", 2).exists()
    assert dl.fetch_list(c, "T000250", "sponsor") == state and c.requests_made == 2   # cached: no new request
    assert not any("DUMMY" in p.read_text() for p in (tmp_path / "cache").rglob("*") if p.is_file())


def test_truncation_is_recorded_not_hidden():
    base = "/member/T000250/sponsored-legislation"
    s = FakeSession({(base, 0): load("sponsored_T000250_p1.json")})
    state = dl.fetch_list(dl.Client(session=s, pause=0, sleep=lambda _: None), "T000250", "sponsor", max_pages=1)
    assert state["pages"] == 1 and state["complete"] is False


def test_key_comes_from_environment_and_http_errors_raise(monkeypatch):
    monkeypatch.setenv("CONGRESS_API_KEY", "k-test")
    s = FakeSession({})
    with pytest.raises(RuntimeError):
        dl.Client(session=s, pause=0, sleep=lambda _: None).get("/member/X000000")
    assert s.calls[0][1]["api_key"] == "k-test" and len(s.calls) == 1   # 404 is not retried


def facts_for(extra_docs=None):
    pages = {("T000250", "sponsor"): [load("sponsored_T000250_p1.json"), load("sponsored_T000250_p2.json")],
             ("T000250", "cosponsor"): [],
             ("J000299", "sponsor"): [], ("J000299", "cosponsor"): [load("cosponsored_J000299_p1.json")]}
    docs = {"T000250": load("member_T000250.json"), "J000299": load("member_J000299.json")}
    return facts.build_facts(("T000250", "J000299"), pages, docs, {"T000250", "J000299"})


def test_build_facts_exact_ids_and_report():
    rows, rep = facts_for()
    assert {r["member"] for r in rows} <= {"T000250", "J000299"}
    assert rep["dropped"]["amendment_not_a_bill"] == 1 and rep["dropped"]["other_congress"] >= 1
    assert rep["rows"] == len(rows) and rep["duplicates"] == 0
    assert all(set(r) == set(facts.ROW_KEYS) for r in rows)


def test_member_not_in_spine_or_not_current_is_refused():
    pages = {("T000250", "sponsor"): [], ("T000250", "cosponsor"): []}
    docs = {"T000250": load("member_T000250.json")}
    with pytest.raises(ValueError):
        facts.build_facts(("T000250",), pages, docs, {"J000299"})
    docs["T000250"]["member"]["currentMember"] = False
    with pytest.raises(ValueError):
        facts.build_facts(("T000250",), pages, docs, None)


def test_duplicates_collapse_and_shared_bills_counted():
    page = load("cosponsored_J000299_p1.json")
    pages = {("J000299", "sponsor"): [], ("J000299", "cosponsor"): [page, page],
             ("T000250", "sponsor"): [], ("T000250", "cosponsor"): [page]}
    docs = {"T000250": load("member_T000250.json"), "J000299": load("member_J000299.json")}
    rows, rep = facts.build_facts(("T000250", "J000299"), pages, docs, None)
    assert rep["duplicates"] == len(page["cosponsoredLegislation"])
    n119 = len([i for i in page["cosponsoredLegislation"] if i["congress"] == 119])
    assert rep["shared_bills_by_pair"] == {"J000299+T000250": n119}


def test_gate_is_off_by_default_and_writes_nothing(tmp_path, capsys):
    assert crun.main(["--download", "--sample"]) == 0
    assert "skipped" in capsys.readouterr().out
    assert not (tmp_path / "out").exists() and not (tmp_path / "cache").exists() and not (tmp_path / "docs").exists()


def test_pipeline_stage_is_a_noop_when_off(capsys):
    from pipeline import run
    run.congress()
    assert "skipped" in capsys.readouterr().out
    assert "congress" in run.STAGES


def test_enabled_run_from_cache_writes_facts_and_sample_without_reviewer_text(monkeypatch, tmp_path):
    monkeypatch.setenv("PT_ENABLE_CONGRESS", "1")
    monkeypatch.setattr(dl, "PILOT_MEMBERS", ("T000250", "J000299"))
    base = "/member/{}/{}-legislation"
    routes = {(base.format("T000250", "sponsored"), 0): load("sponsored_T000250_p1.json"),
              (base.format("T000250", "sponsored"), 250): load("sponsored_T000250_p2.json"),
              (base.format("T000250", "cosponsored"), 0): {"pagination": {"count": 0}, "cosponsoredLegislation": []},
              (base.format("J000299", "sponsored"), 0): {"pagination": {"count": 0}, "sponsoredLegislation": []},
              (base.format("J000299", "cosponsored"), 0): load("cosponsored_J000299_p1.json"),
              ("/member/T000250", None): load("member_T000250.json"), ("/member/J000299", None): load("member_J000299.json")}
    client = dl.Client(session=FakeSession(routes), pause=0, sleep=lambda _: None)
    monkeypatch.setattr(dl, "Client", lambda: client)
    assert crun.main(["--download", "--sample"]) == 0
    out = tmp_path / "out"
    lines = (out / "member_bills.jsonl").read_text().splitlines()
    assert lines and all(json.loads(x)["member"] in ("T000250", "J000299") for x in lines)
    for path in (out / "congress-sample.csv", tmp_path / "docs" / "congress-sample.csv"):
        rows = list(csv.DictReader(open(path, encoding="utf-8")))
        assert rows and all(r["checked_by"] == r["matches_source"] == r["comment"] == "" for r in rows)
    # nothing is placed where the assembler looks, and the report names the access date source
    assert not list(out.glob("edges*")) and json.loads((out / "report.json").read_text())["requests_made"] > 0
    (tmp_path / "docs" / "congress-sample.csv").write_text("reviewed\n")
    crun.main([])
    crun.write_sample([json.loads(x) for x in lines])
    assert (tmp_path / "docs" / "congress-sample.csv").read_text() == "reviewed\n"   # never overwritten
