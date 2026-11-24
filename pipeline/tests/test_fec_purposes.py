"""FEC purpose groups (pipeline/fec/purposes_api.py) and their validator (validate_fec_purposes.py): paging, batching,
null versus [], negative totals, cache refresh rules, failure fallback, determinism, and the end-to-end block.
Recorded pages in tests/fixtures/fec_api/ (trimmed real rows); no network."""
from __future__ import annotations

import copy
import json
import time

import pytest

from pipeline.fec import api, download, purposes_api as pa, refs, spending
from pipeline.tests.fec_api_fakes import Resp, Session, fixture, ok, purposes_route
from pipeline.tests.test_fec_spending import GOOD, build_con, oppexp_zip, run_check
from pipeline.validate import Checker
from pipeline.validate_fec_spending import check_campaign_finance

NOW = 2e9
KEY = "SECRETKEY123"
DATA = {2024: {"C00000001": [("OTHER", 500.0, 3), ("CONTRIBUTIONS", 900.0, 2), ("REFUNDS", 900.0, 1)],
               "C00000002": [("TRAVEL", 0.0, 0)]},
        2022: {"C00000001": [("OTHER", 1.0, 1)]}}


def client(route=None, **kw):
    s = Session(route or purposes_route(DATA))
    return api.FecApi(key=KEY, session=s, sleep=lambda x: None, **kw), s


def stamp(age_hours: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - age_hours * 3600))


def test_recorded_pages_are_read_whole_sorted_and_figures_kept_as_given():
    pages = {1: fixture("purposes_page1.json"), 2: fixture("purposes_page2.json")}
    c, s = client(lambda p, q: Resp(200, pages[q["page"]]))
    got = pa.fetch_batch(c, 2024, ["C00344234", "C00235655"])
    assert len(s.calls) == 2 and s.calls[0][1]["committee_id"] == ["C00344234", "C00235655"] and s.calls[0][1]["cycle"] == 2024
    assert [(g["purpose"], g["total"], g["count"]) for g in got["C00344234"]] == [
        ("OTHER", 6007834.74, 412), ("CONTRIBUTIONS", 2154500.0, 238), ("REFUNDS", 96141.0, 243), ("ADVERTISING", 7485.51, 3),
        ("ADMINISTRATIVE", 5307.27, 8), ("TRANSFERS", 247.06, 1), ("TRAVEL", 0.0, 0)]
    assert got["C00235655"][0] == {"purpose": "OTHER", "total": 869279.08, "count": 277}
    assert all(set(g) == {"purpose", "total", "count"} for v in got.values() for g in v)       # memo fields are not read


def test_identical_duplicate_rows_count_once_but_different_ones_fail_the_batch():
    row = {"committee_id": "C00000001", "cycle": 2024, "purpose": "OTHER", "total": 5.0, "count": 1}
    dups = [0]
    c, _ = client(lambda p, q: ok([row, dict(row)]))
    assert pa.fetch_batch(c, 2024, ["C00000001"], dups)["C00000001"] == [{"purpose": "OTHER", "total": 5.0, "count": 1}]
    assert dups == [1]
    c, _ = client(lambda p, q: ok([row, {**row, "total": 6.0}]))
    with pytest.raises(api.ApiError):
        pa.fetch_batch(c, 2024, ["C00000001"])


def test_ties_sort_by_label_and_a_negative_total_is_null_and_reported():
    neg: list = []
    out = pa.publishable([{"purpose": "B", "total": 5.0, "count": 1}, {"purpose": "A", "total": 5.0, "count": 2},
                          {"purpose": "REFUNDS", "total": -7.0, "count": 1}, {"purpose": "Z", "total": 0.0, "count": 0}], "C1 2024", neg)
    assert [g["purpose"] for g in out] == ["A", "B", "Z", "REFUNDS"] and out[-1]["total"] is None
    assert neg == [{"where": "C1 2024", "purpose": "REFUNDS", "value": -7.0}]


def test_batches_of_100_ids_sorted_and_one_request_per_page():
    ids = [f"C{n:08d}" for n in range(250, 0, -1)]
    c, s = client()
    out, rep = pa.fetch_all({2024: ids}, c, NOW, 2026)
    sizes = [len(q["committee_id"]) for _, q in s.calls]
    assert sizes == [100, 100, 50] and s.calls[0][1]["committee_id"] == sorted(ids)[:100]
    assert rep["requests"] == 3 and rep["committee_cycles_asked"] == 250


def test_null_means_not_fetched_and_empty_list_means_the_fec_answered_with_no_group():
    c, _ = client()
    out, rep = pa.fetch_all({2024: ["C00000001", "C00000002", "C00000003"]}, c, NOW, 2026)
    assert out[(2024, "C00000003")] == [] and out[(2024, "C00000002")] == [{"purpose": "TRAVEL", "total": 0.0, "count": 0}]
    assert rep["cycles"] == [2024]
    out, rep = pa.fetch_all({2020: ["C00000001"]}, client(lambda p, q: Resp(500))[0], NOW, 2026)       # failure: never []
    assert out == {(2020, "C00000001"): None} and rep["cycles"] == [] and rep["batches_failed"][0]["reason"] == "HTTP 500"
    assert pa.coverage(rep, "2026-11-24") == ([], f"{pa.SOURCE}: not available in this build (no answer from the API)")


def test_no_key_means_no_request_no_purposes_and_a_warning(capsys):
    c = api.FecApi(key="", session=Session(lambda p, q: pytest.fail("network")), sleep=lambda x: None)
    out, rep = pa.fetch_all({2024: ["C00000001"]}, c, NOW, 2026)
    assert out == {(2024, "C00000001"): None} and "FEC_API_KEY" in rep["warning"] and "WARNING" in capsys.readouterr().out
    assert "FEC_API_KEY" in pa.coverage(rep, "2026-11-24")[1]


@pytest.mark.parametrize("route", [lambda p, q: Resp(200, text="<html>"), lambda p, q: ok([{"committee_id": "C00000001", "cycle": 2024, "purpose": "OTHER", "total": "x", "count": 1}]),
                                   lambda p, q: ok([{"committee_id": "C00000001", "cycle": 2024, "purpose": "", "total": 1.0, "count": 1}]),
                                   lambda p, q: ok([{"committee_id": "C00000001", "cycle": 2024, "purpose": "OTHER", "total": 1.0, "count": -1}])])
def test_malformed_answers_give_null_not_a_guess(route):
    out, rep = pa.fetch_all({2024: ["C00000001"]}, client(route)[0], NOW, 2026)
    assert out[(2024, "C00000001")] is None and rep["batches_failed"]


def test_rows_of_other_committees_or_cycles_are_ignored():
    rows = [{"committee_id": "C00000009", "cycle": 2024, "purpose": "OTHER", "total": 1.0, "count": 1},
            {"committee_id": "C00000001", "cycle": 2022, "purpose": "OTHER", "total": 1.0, "count": 1}]
    assert pa.fetch_batch(client(lambda p, q: ok(rows))[0], 2024, ["C00000001"]) == {"C00000001": []}


def cache(cycle: int, hours: float, committees: dict) -> None:
    api.cache_write(f"purposes_{cycle}.json", {"retrieved": stamp(hours), "cycle": cycle, "committees": committees})


def test_recent_cycles_refresh_after_twelve_hours_older_after_seven_days():
    old = {"C00000001": [{"purpose": "OLD", "total": 1.0, "count": 1}]}
    cache(2024, 11, old); cache(2022, 6 * 24, old)
    c, s = client()
    out, _ = pa.fetch_all({2024: ["C00000001"], 2022: ["C00000001"]}, c, NOW, 2026)
    assert s.calls == [] and out[(2024, "C00000001")][0]["purpose"] == "OLD"
    cache(2024, 13, old); cache(2022, 8 * 24, old)
    out, rep = pa.fetch_all({2024: ["C00000001"], 2022: ["C00000001"]}, c, NOW, 2026)
    assert [q["cycle"] for _, q in s.calls] == [2022, 2024] and out[(2024, "C00000001")][0]["purpose"] == "CONTRIBUTIONS"
    assert out[(2022, "C00000001")] == [{"purpose": "OTHER", "total": 1.0, "count": 1}]


def test_a_committee_missing_from_a_fresh_cache_is_fetched_alone():
    cache(2024, 1, {"C00000001": [{"purpose": "OLD", "total": 1.0, "count": 1}]})
    c, s = client()
    out, _ = pa.fetch_all({2024: ["C00000001", "C00000002"]}, c, NOW, 2026)
    assert [q["committee_id"] for _, q in s.calls] == [["C00000002"]]
    assert out[(2024, "C00000001")][0]["purpose"] == "OLD" and out[(2024, "C00000002")][0]["purpose"] == "TRAVEL"


def test_failed_refresh_keeps_the_cached_groups_and_reports_them_stale():
    cache(2024, 40, {"C00000001": [{"purpose": "OLD", "total": 1.0, "count": 1}]})
    out, rep = pa.fetch_all({2024: ["C00000001"]}, client(lambda p, q: Resp(500))[0], NOW, 2026)
    assert out[(2024, "C00000001")][0]["purpose"] == "OLD" and rep["stale_cycles"] == [2024]
    assert api.cache_read("purposes_2024.json")["retrieved"] == stamp(40)          # a failed refresh does not re-stamp


def test_cache_only_uses_the_cache_and_nothing_else(monkeypatch):
    monkeypatch.setenv("PT_CACHE_ONLY", "1")
    cache(2024, 999, {"C00000001": [{"purpose": "OLD", "total": 1.0, "count": 1}]})
    c, s = client()
    out, rep = pa.fetch_all({2024: ["C00000001", "C00000002"]}, c, NOW, 2026)
    assert s.calls == [] and out[(2024, "C00000001")][0]["purpose"] == "OLD" and out[(2024, "C00000002")] is None


def test_same_input_gives_same_output_and_identical_cache_bytes():
    ids = ["C00000002", "C00000001"]
    a, _ = pa.fetch_all({2024: ids}, client()[0], NOW, 2026)
    first = (api.cache_dir() / "purposes_2024.json").read_bytes()
    (api.cache_dir() / "purposes_2024.json").unlink()
    b, _ = pa.fetch_all({2024: list(reversed(ids))}, client()[0], NOW, 2026)
    assert a == b and first == (api.cache_dir() / "purposes_2024.json").read_bytes() and KEY.encode() not in first


def test_coverage_note_names_endpoint_scope_and_access_date():
    cycles, note = pa.coverage({"cycles": [2024], "retrieved_by_cycle": {"2024": "2026-11-23T05:00:00Z"}}, "2026-11-24")
    assert cycles == [2024] and "by_purpose" in note and "all disbursements" in note and note.endswith("accessed 2026-11-23")


# --- end to end and validator ----------------------------------------------------------------------
@pytest.fixture
def built(tmp_path, monkeypatch):
    zpath = oppexp_zip(tmp_path)
    monkeypatch.setattr(download, "bulk_zip", lambda name, cycle: zpath if cycle >= 2004 else (_ for _ in ()).throw(download.NotFound(name)))
    data = {2024: {"C00409276": [("OTHER", 10.0, 2), ("CONTRIBUTIONS", 20.0, 1)], "C00999999": [("OTHER", 1.0, 1)]}}
    c, s = client(purposes_route(data))
    monkeypatch.setattr(api, "_DEFAULT", c)
    members = refs.Members("t", {"S001217": {"fec_ids": ["S8FL00273"]}, "M001243": {"fec_ids": ["S2PA00661"]}})
    members.build_index()
    out = tmp_path / "build"
    sec = spending.run(build_con(), members, [2000, 2024], {}, {}, out)
    return json.loads((out / "campaign_finance.json").read_text()), sec, s


def test_purposes_ride_on_pac_years_that_have_oppexp_rows_and_validate(built):
    doc, sec, s = built
    pac = doc["members"]["S001217"]["leadership_pac"][0]
    assert pac["purposes"] == [{"purpose": "CONTRIBUTIONS", "total": 20.0, "count": 1}, {"purpose": "OTHER", "total": 10.0, "count": 2}]
    other = [p for m in doc["members"].values() for p in m["leadership_pac"] if p["committee_id"] != "C00409276"]
    assert all(p["purposes"] == [] for p in other)                      # asked, completed, no group returned
    asked = {i for _, q in s.calls for i in q["committee_id"]}
    assert "C00999999" not in asked                                      # a committee with no oppexp rows is never asked for
    assert sec["purposes"]["cycles"] == [2024] and sec["purposes"]["requests"] == len([1 for p, _ in s.calls if p.endswith("by_purpose/")])
    cov = doc["members"]["S001217"]["coverage"]
    assert cov["purposes_cycles"] == [2024] and "accessed 20" in cov["purposes_source"]
    c = Checker()
    for bio, block in doc["members"].items():
        check_campaign_finance(c, block, bio, bio, {"S001217": ["S8FL00273"], "M001243": ["S2PA00661"]}.get(bio, ["H6MD08549"]), doc["links"])
    assert c.errors == {}


GOODP = copy.deepcopy(GOOD)
GOODP["coverage"].update(purposes_cycles=[2024], purposes_source="OpenFEC by_purpose, accessed 2026-11-24")
GOODP["leadership_pac"][0]["purposes"] = [{"purpose": "OTHER", "total": 9.0, "count": 2}, {"purpose": "TRAVEL", "total": 9.0, "count": 0},
                                          {"purpose": "REFUNDS", "total": None, "count": 1}]


def test_validator_accepts_purposes_null_empty_and_a_list():
    assert run_check(GOODP) == {} and run_check(GOOD) == {}
    b = copy.deepcopy(GOODP); b["leadership_pac"][0]["purposes"] = []
    assert run_check(b) == {}


@pytest.mark.parametrize("fn,rule", [
    (lambda p: p.__setitem__(0, {**p[0], "total": -1.0}), "total not negative"),
    (lambda p: p.__setitem__(0, {**p[0], "count": 1.5}), "count is an integer"),
    (lambda p: p.__setitem__(0, {**p[0], "count": -1}), "count is an integer"),
    (lambda p: p.__setitem__(1, {**p[1], "purpose": "OTHER"}), "one row per label"),
    (lambda p: p.reverse(), "sorted by total"),
    (lambda p: p.__setitem__(0, {**p[0], "purpose": "Payment to John Smith at 12 Main Street"}), "FEC label"),
    (lambda p: p.__setitem__(0, {**p[0], "extra": 1}), "schema"),
    (lambda p: p.append({"purpose": "X", "total": 1.0, "count": True}), "count is an integer"),
])
def test_validator_rejects_bad_purpose_groups(fn, rule):
    b = copy.deepcopy(GOODP)
    fn(b["leadership_pac"][0]["purposes"])
    assert any(rule in k for k in run_check(b)), rule


def test_validator_cycle_coverage_and_unlinked_committee_rules():
    b = copy.deepcopy(GOODP); b["coverage"]["purposes_cycles"] = []
    assert any("only for a cycle in coverage.purposes_cycles" in k for k in run_check(b))
    b = copy.deepcopy(GOODP); b["coverage"]["purposes_cycles"] = [2023]
    assert any("purposes_cycles" in k for k in run_check(b))
    b = copy.deepcopy(GOODP); b["coverage"]["purposes_source"] = ""
    assert any("purposes_source" in k for k in run_check(b))
    assert any("linked to this member" in k for k in run_check(GOODP, links={}))           # purposes on an unlinked committee
    b = copy.deepcopy(GOODP); b["leadership_pac"][0]["purposes"] = "OTHER"
    assert run_check(b)
    b = copy.deepcopy(GOODP); b["leadership_pac"][0]["sponsor_link"] = "fec_api_sponsor_id+fec_candidate_id"
    links = {"C00409276": {"member": "M1", "method": "fec_api_sponsor_id+fec_candidate_id"}}
    assert run_check(b, links=links) == {}
    b["leadership_pac"][0]["sponsor_link"] = "fec_candidate_id+fec_api_sponsor_id"       # not the sorted form
    assert run_check(b, links=links)
