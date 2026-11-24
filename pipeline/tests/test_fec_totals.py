"""FEC committee totals (pipeline/fec/totals_api.py) and their validator (validate_fec_totals.py): the recorded OpenFEC page,
batching, null versus a figure, negative figures, rows of another cycle, cache refresh rules, failure fallback, determinism,
and the end-to-end block. Recorded rows in tests/fixtures/fec_api/totals_page1.json (real rows trimmed to the fields read); no network."""
from __future__ import annotations

import copy
import json
import time

import pytest

from pipeline.fec import api, download, refs, spending, totals_api as ta
from pipeline.tests.fec_api_fakes import Resp, Session, fixture, ok
from pipeline.tests.test_fec_spending import GOOD, build_con, oppexp_zip, run_check
from pipeline.validate import Checker
from pipeline.validate_fec_spending import check_campaign_finance
from pipeline.validate_fec_totals import check_totals

NOW = 2e9
KEY = "SECRETKEY123"


def row(cid: str, cycle: int, **over) -> dict:
    base = {"committee_id": cid, "cycle": cycle, "committee_type": "Q", "receipts": 100.0, "disbursements": 80.5,
            "fed_candidate_committee_contributions": 30.0, "operating_expenditures": 40.25, "contribution_refunds": 2.0,
            "other_disbursements": 8.25, "last_cash_on_hand_end_period": 19.5, "coverage_end_date": f"{cycle}-12-31T00:00:00"}
    return {**base, **over}


def route_for(rows: list[dict]):
    """A /totals/pac/ server honouring committee_id and cycle and paging 100 rows."""
    def route(path: str, params: dict) -> Resp:
        assert path == "/totals/pac/", path
        ids, cycle = set(params["committee_id"]), params["cycle"]
        hit = [r for r in rows if r["committee_id"] in ids and r["cycle"] == cycle]
        p = int(params.get("page", 1))
        return ok(hit[(p - 1) * 100:p * 100], p, max(1, -(-len(hit) // 100)), len(hit))
    return route


ROWS = [row("C00000001", 2024), row("C00000002", 2024, receipts=None), row("C00000001", 2022)]


def client(route=None, **kw):
    s = Session(route or route_for(ROWS))
    return api.FecApi(key=KEY, session=s, sleep=lambda x: None, **kw), s


def stamp(age_hours: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - age_hours * 3600))


def test_recorded_rows_are_read_to_the_cent_and_a_row_of_another_cycle_is_ignored():
    page = fixture("totals_page1.json")                       # two cycles in one answer (2024 and 2026), as a cycle filter would not
    c, s = client(lambda p, q: Resp(200, page))
    got = ta.fetch_batch(c, 2026, ["C00344234", "C00235655"])
    assert len(s.calls) == 1 and s.calls[0][0] == "/totals/pac/" and s.calls[0][1]["cycle"] == 2026
    assert got["C00344234"] == {"receipts": 3811921.29, "disbursements": 8067055.36, "contributions_to_committees": 1196000.0,
                                "operating_expenditures": 5833520.61, "contribution_refunds": 65986.75, "other_disbursements": 971548.0,
                                "cash_on_hand": 5673948.0, "coverage_end_date": "2026-10-14"}
    got24 = ta.fetch_batch(c, 2024, ["C00344234"])
    assert got24["C00344234"]["coverage_end_date"] == "2024-12-31" and got24["C00344234"]["receipts"] == 7955839.73


def test_a_blank_figure_is_null_never_zero_and_a_real_zero_stays_zero():
    c, _ = client(lambda p, q: ok([row("C00000001", 2024, receipts=None, other_disbursements=0.0, operating_expenditures="x")]))
    t = ta.fetch_batch(c, 2024, ["C00000001"])["C00000001"]
    assert t["receipts"] is None and t["operating_expenditures"] is None and t["other_disbursements"] == 0.0


def test_a_negative_figure_is_not_published_and_is_reported():
    neg: list = []
    c, _ = client(lambda p, q: ok([row("C00000001", 2024, last_cash_on_hand_end_period=-5.5)]))
    t = ta.fetch_batch(c, 2024, ["C00000001"], neg)["C00000001"]
    assert t["cash_on_hand"] is None and t["receipts"] == 100.0
    assert neg == [{"where": "C00000001 2024", "field": "last_cash_on_hand_end_period", "value": -5.5}]


@pytest.mark.parametrize("over", [{"coverage_end_date": None}, {"coverage_end_date": "2024-13-45T00:00:00"}, {"coverage_end_date": "soon"},
                                  {f: None for f in ("receipts", "disbursements", "fed_candidate_committee_contributions", "operating_expenditures",
                                                     "contribution_refunds", "other_disbursements", "last_cash_on_hand_end_period")}])
def test_no_date_or_no_figure_at_all_gives_null_not_a_guess(over):
    c, _ = client(lambda p, q: ok([row("C00000001", 2024, **over)]))
    assert ta.fetch_batch(c, 2024, ["C00000001"]) == {"C00000001": None}


def test_a_coverage_date_outside_the_cycle_gives_null_and_is_reported():
    c, _ = client(lambda p, q: ok([row("C00000001", 2024, coverage_end_date="2025-06-30T00:00:00"), row("C00000002", 2024)]))
    out, rep = ta.fetch_all({2024: ["C00000001", "C00000002"]}, c, NOW, 2026)
    assert out[(2024, "C00000001")] is None and out[(2024, "C00000002")]["coverage_end_date"] == "2024-12-31"
    assert rep["coverage_date_outside_cycle"] == [{"where": "C00000001 2024", "coverage_end_date": "2025-06-30"}]


def test_a_coverage_date_after_the_build_day_is_kept_and_reported():
    c, _ = client(lambda p, q: ok([row("C00000001", 2100)]))
    out, rep = ta.fetch_all({2100: ["C00000001"]}, c, NOW, 2100)
    assert out[(2100, "C00000001")]["coverage_end_date"] == "2100-12-31"
    assert rep["coverage_date_after_build_day"] == [{"where": "C00000001 2100", "coverage_end_date": "2100-12-31"}]


def test_a_committee_without_a_row_is_null_and_a_repeat_with_different_figures_fails_the_batch():
    c, _ = client()
    assert ta.fetch_batch(c, 2024, ["C00000001", "C00000003"])["C00000003"] is None
    same = row("C00000001", 2024)
    c, _ = client(lambda p, q: ok([same, dict(same)]))
    assert ta.fetch_batch(c, 2024, ["C00000001"])["C00000001"]["receipts"] == 100.0
    c, _ = client(lambda p, q: ok([same, {**same, "receipts": 101.0}]))
    with pytest.raises(api.ApiError):
        ta.fetch_batch(c, 2024, ["C00000001"])


def test_batches_of_100_ids_sorted_one_request_per_batch_and_the_report_counts_them():
    ids = [f"C{n:08d}" for n in range(250, 0, -1)]
    c, s = client(route_for([row(i, 2024) for i in ids]))
    out, rep = ta.fetch_all({2024: ids}, c, NOW, 2026)
    assert [len(q["committee_id"]) for _, q in s.calls] == [100, 100, 50] and s.calls[0][1]["committee_id"] == sorted(ids)[:100]
    assert all(q["per_page"] == 100 and q["cycle"] == 2024 for _, q in s.calls)
    assert rep["requests"] == 3 and rep["committee_cycles_asked"] == 250 and rep["committee_cycles_without_totals"] == 0


def test_failure_gives_null_for_every_committee_and_the_run_goes_on():
    out, rep = ta.fetch_all({2020: ["C00000001"]}, client(lambda p, q: Resp(500))[0], NOW, 2026)
    assert out == {(2020, "C00000001"): None} and rep["cycles"] == [] and rep["batches_failed"][0]["reason"] == "HTTP 500"
    assert ta.coverage(rep, "2026-11-24") == ([], f"{ta.SOURCE}: not available in this build (no answer from the API)")


def test_no_key_means_no_request_and_a_warning(capsys):
    c = api.FecApi(key="", session=Session(lambda p, q: pytest.fail("network")), sleep=lambda x: None)
    out, rep = ta.fetch_all({2024: ["C00000001"]}, c, NOW, 2026)
    assert out == {(2024, "C00000001"): None} and "FEC_API_KEY" in rep["warning"] and "WARNING" in capsys.readouterr().out


def cache(cycle: int, hours: float, committees: dict) -> None:
    api.cache_write(f"totals_{cycle}.json", {"retrieved": stamp(hours), "cycle": cycle, "committees": committees})


OLD = {"receipts": 1.0, "disbursements": None, "contributions_to_committees": None, "operating_expenditures": None,
       "contribution_refunds": None, "other_disbursements": None, "cash_on_hand": None, "coverage_end_date": "2024-06-30"}


def test_recent_cycles_refresh_after_twelve_hours_older_after_seven_days():
    cache(2024, 11, {"C00000001": OLD}); cache(2022, 6 * 24, {"C00000001": OLD})
    c, s = client()
    out, _ = ta.fetch_all({2024: ["C00000001"], 2022: ["C00000001"]}, c, NOW, 2026)
    assert s.calls == [] and out[(2024, "C00000001")]["receipts"] == 1.0                 # fresh: no request
    cache(2024, 13, {"C00000001": OLD}); cache(2022, 8 * 24, {"C00000001": OLD})
    out, rep = ta.fetch_all({2024: ["C00000001"], 2022: ["C00000001"]}, c, NOW, 2026)
    assert [q["cycle"] for _, q in s.calls] == [2022, 2024] and out[(2024, "C00000001")]["receipts"] == 100.0


def test_a_committee_missing_from_a_fresh_cache_is_fetched_alone_and_a_cached_null_is_not_refetched():
    cache(2024, 1, {"C00000001": OLD, "C00000003": None})
    c, s = client()
    out, _ = ta.fetch_all({2024: ["C00000001", "C00000002", "C00000003"]}, c, NOW, 2026)
    assert [q["committee_id"] for _, q in s.calls] == [["C00000002"]]
    assert out[(2024, "C00000003")] is None and out[(2024, "C00000001")]["receipts"] == 1.0


def test_failed_refresh_keeps_cached_figures_and_reports_them_stale():
    cache(2024, 40, {"C00000001": OLD})
    out, rep = ta.fetch_all({2024: ["C00000001"]}, client(lambda p, q: Resp(500))[0], NOW, 2026)
    assert out[(2024, "C00000001")]["receipts"] == 1.0 and rep["stale_cycles"] == [2024]
    assert api.cache_read("totals_2024.json")["retrieved"] == stamp(40)


def test_a_cache_entry_with_the_wrong_keys_is_not_used():
    cache(2024, 1, {"C00000001": {"receipts": 5.0}})
    out, _ = ta.fetch_all({2024: ["C00000001"]}, client(lambda p, q: Resp(500))[0], NOW, 2026)
    assert out[(2024, "C00000001")] is None


def test_cache_only_uses_the_cache_and_nothing_else(monkeypatch):
    monkeypatch.setenv("PT_CACHE_ONLY", "1")
    cache(2024, 999, {"C00000001": OLD})
    c, s = client()
    out, _ = ta.fetch_all({2024: ["C00000001", "C00000002"]}, c, NOW, 2026)
    assert s.calls == [] and out[(2024, "C00000001")]["receipts"] == 1.0 and out[(2024, "C00000002")] is None


def test_same_input_gives_same_output_and_identical_cache_bytes_without_the_key():
    ids = ["C00000002", "C00000001"]
    a, _ = ta.fetch_all({2024: ids}, client()[0], NOW, 2026)
    first = (api.cache_dir() / "totals_2024.json").read_bytes()
    (api.cache_dir() / "totals_2024.json").unlink()
    b, _ = ta.fetch_all({2024: list(reversed(ids))}, client()[0], NOW, 2026)
    assert a == b and first == (api.cache_dir() / "totals_2024.json").read_bytes() and KEY.encode() not in first


def test_request_budget_for_a_normal_day_and_a_full_refresh():
    """~1,100 committee-cycles over the busiest cycles: a normal day refetches the two recent cycles, a cold run all twelve."""
    ids = [f"C{n:08d}" for n in range(1, 701)]
    rows = [row(i, cy) for i in ids for cy in range(2004, 2028, 2)]
    c, s = client(route_for(rows))
    wanted = {cy: ids for cy in range(2004, 2028, 2)}
    _, rep = ta.fetch_all(wanted, c, NOW, 2026)
    assert rep["requests"] == 12 * 7                                    # cold: 12 cycles x ceil(700 / 100)
    for cy in range(2004, 2024, 2):
        cache(cy, 1, json.loads((api.cache_dir() / f"totals_{cy}.json").read_text())["committees"])
    c2, s2 = client(route_for(rows))
    _, rep = ta.fetch_all(wanted, c2, NOW + 13 * 3600, 2026)            # 13 h later: only the three recent cycles are stale
    assert {q["cycle"] for _, q in s2.calls} <= {2024, 2026} and rep["requests"] == 2 * 7


def test_coverage_note_names_endpoint_and_access_date():
    cycles, note = ta.coverage({"cycles": [2024], "retrieved_by_cycle": {"2024": "2026-11-23T05:00:00Z"}}, "2026-11-24")
    assert cycles == [2024] and "/v1/totals/pac/" in note and note.endswith("accessed 2026-11-23")


# --- end to end and validator ----------------------------------------------------------------------
@pytest.fixture
def built(tmp_path, monkeypatch):
    zpath = oppexp_zip(tmp_path)
    monkeypatch.setattr(download, "bulk_zip", lambda name, cycle: zpath if cycle >= 2004 else (_ for _ in ()).throw(download.NotFound(name)))

    def route(path: str, params: dict) -> Resp:
        if path != "/totals/pac/":
            return Resp(404)                                            # purpose groups unavailable here
        return route_for([row("C00409276", 2024), row("C00999999", 2024)])(path, params)
    c, s = client(route)
    monkeypatch.setattr(api, "_DEFAULT", c)
    members = refs.Members("t", {"S001217": {"fec_ids": ["S8FL00273"]}, "M001243": {"fec_ids": ["S2PA00661"]}})
    members.build_index()
    out = tmp_path / "build"
    sec = spending.run(build_con(), members, [2000, 2024], {}, {}, out)
    return json.loads((out / "campaign_finance.json").read_text()), sec, s


def test_totals_ride_on_pac_years_that_have_oppexp_rows_and_validate(built):
    doc, sec, s = built
    pac = doc["members"]["S001217"]["leadership_pac"][0]
    assert pac["totals"]["receipts"] == 100.0 and pac["totals"]["coverage_end_date"] == "2024-12-31" and pac["purposes"] is None
    other = [p for m in doc["members"].values() for p in m["leadership_pac"] if p["committee_id"] != "C00409276"]
    assert all(p["totals"] is None for p in other)                      # asked, the API had no row: null, not zeros
    asked = {i for p, q in s.calls if p == "/totals/pac/" for i in q["committee_id"]}
    assert "C00999999" not in asked                                      # a committee with no oppexp rows is never asked for
    assert sec["totals"]["cycles"] == [2024]
    cov = doc["members"]["S001217"]["coverage"]
    assert cov["totals_cycles"] == [2024] and "accessed 20" in cov["totals_source"]
    c = Checker()
    for bio, block in doc["members"].items():
        check_campaign_finance(c, block, bio, bio, {"S001217": ["S8FL00273"], "M001243": ["S2PA00661"]}.get(bio, ["H6MD08549"]), doc["links"])
    assert c.errors == {}


def test_a_build_without_the_key_publishes_null_totals_and_still_validates(tmp_path, monkeypatch):
    zpath = oppexp_zip(tmp_path)
    monkeypatch.setattr(download, "bulk_zip", lambda name, cycle: zpath if cycle >= 2004 else (_ for _ in ()).throw(download.NotFound(name)))
    members = refs.Members("t", {"S001217": {"fec_ids": ["S8FL00273"]}, "M001243": {"fec_ids": ["S2PA00661"]}})
    members.build_index()
    out = tmp_path / "build"
    spending.run(build_con(), members, [2000, 2024], {}, {}, out)       # no FEC_API_KEY (conftest), empty cache
    doc = json.loads((out / "campaign_finance.json").read_text())
    pacs = [p for m in doc["members"].values() for p in m["leadership_pac"]]
    assert pacs and all(p["totals"] is None for p in pacs)
    assert all(m["coverage"]["totals_cycles"] == [] and "not available" in m["coverage"]["totals_source"] for m in doc["members"].values())


GOODT = copy.deepcopy(GOOD)
GOODT["coverage"].update(totals_cycles=[2024], totals_source="OpenFEC /v1/totals/pac/, accessed 2026-11-24")
GOODT["leadership_pac"][0]["totals"] = {"receipts": 10.5, "disbursements": 9.0, "contributions_to_committees": 0.0, "operating_expenditures": 5.0,
                                        "contribution_refunds": None, "other_disbursements": None, "cash_on_hand": 1.25, "coverage_end_date": "2024-10-16"}


def mut(fn):
    b = copy.deepcopy(GOODT)
    fn(b["leadership_pac"][0]["totals"])
    return b


def test_validator_accepts_null_and_a_good_object():
    assert run_check(GOODT) == {} and run_check(GOOD) == {}


@pytest.mark.parametrize("fn", [lambda t: t.update(receipts=-1.0), lambda t: t.update(cash_on_hand=-0.01), lambda t: t.update(disbursements="9"),
                                lambda t: t.update(coverage_end_date="2024-02-30"), lambda t: t.update(coverage_end_date="2020-10-16"),
                                lambda t: t.update(coverage_end_date=None), lambda t: t.pop("cash_on_hand"), lambda t: t.update(extra=1),
                                lambda t: t.update({k: None for k in ("receipts", "disbursements", "contributions_to_committees",
                                                                      "operating_expenditures", "cash_on_hand")})])
def test_validator_rejects_bad_totals(fn):
    assert run_check(mut(fn)) != {}


def test_validator_needs_the_cycle_in_coverage_and_a_dated_source():
    b = copy.deepcopy(GOODT); b["coverage"]["totals_cycles"] = []
    assert run_check(b) != {}
    b = copy.deepcopy(GOODT); b["coverage"]["totals_source"] = "OpenFEC"
    assert run_check(b) != {}
    c = Checker(); check_totals(c, None, "w", 2024, []); assert c.errors == {}
