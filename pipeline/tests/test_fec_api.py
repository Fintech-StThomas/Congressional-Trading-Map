"""OpenFEC client and sponsor linkage (pipeline/fec/api.py, sponsors_api.py, leadership.py): paging, exact-id linkage,
the two-member and API-versus-file rules, failure fallback, cache refresh rules, determinism. Recorded pages in
tests/fixtures/fec_api/ (trimmed real rows); no network."""
from __future__ import annotations

import json
import time

import duckdb
import pytest
import requests

from pipeline.fec import api, build, leadership, load, refs, sponsors_api
from pipeline.tests.fec_api_fakes import Resp, Session, fixture, ok

KEY = "SECRETKEY123"
MCCONNELL, CRUZ, JORDAN = "S2KY00012", "S2TX00312", "H6OH04082"
CAND_TO_BIO = {MCCONNELL: "M000355", CRUZ: "C001098", JORDAN: "J000289", "H6OH04083": "J000289", "S0SC00149": "G000359"}


def committees_route(path, params):
    assert path == "/committees/" and params["designation"] == "D" and params["sort"] == "committee_id"
    return Resp(200, fixture(f"committees_page{params['page']}.json"))


def client(route=committees_route, key=KEY, **kw):
    s = Session(route)
    return api.FecApi(key=key, session=s, sleep=lambda x: None, **kw), s


def test_pages_are_all_read_trimmed_sorted_and_cached_without_key_or_address(tmp_path):
    c, s = client()
    committees, rep = sponsors_api.load_committees(c, now=1e9)
    assert rep["status"] == "fetched" and rep["requests"] == 2 == len(s.calls)
    ids = [x["committee_id"] for x in committees]
    assert ids == sorted(ids) == ["C00083337", "C00235655", "C00348607", "C00366781", "C00388934", "C00536540"]
    assert committees[0]["sponsor_candidate_ids"] == []                       # null in the API -> empty list
    cached = (api.cache_dir() / sponsors_api.CACHE_NAME).read_text()
    for needle in (KEY, "TEST STREET", "TEST, TREASURER", "api_key", "designated_agent"):
        assert needle not in cached
    assert set(committees[1]) == {"committee_id", "name", "sponsor_candidate_ids", "cycles"}


def test_link_by_exact_candidate_id_only_and_two_members_dropped():
    committees, _ = sponsors_api.load_committees(client()[0], now=1e9)
    committees.append({"committee_id": "C00999991", "name": "TWO", "sponsor_candidate_ids": [MCCONNELL, CRUZ], "cycles": []})
    committees.append({"committee_id": "C00999992", "name": "OTHER NAME, SAME TEXT", "sponsor_candidate_ids": ["S9XX00001"], "cycles": []})
    rows, rep = sponsors_api.link_by_ids(committees, CAND_TO_BIO)
    assert [r[0] for r in rows] == ["C00235655", "C00366781", "C00388934", "C00536540"]
    assert {r[2] for r in rows} == {"fec_api_sponsor_id"}
    assert rep["sponsor_ids_name_two_members_dropped"] == [{"committee": "C00999991", "members": ["C001098", "M000355"]}]
    assert "C00999992" not in {r[0] for r in rows} and rep["linked_to_a_member"] == 4
    assert sponsors_api.link_by_ids(list(reversed(committees)), CAND_TO_BIO)[0] == rows          # determinism


def test_merge_rules_api_name_file_and_candidate_id():
    rows = [("C1", "A", "fec_api_sponsor_id"), ("C1", "A", "leadership_file_exact_name"),       # agree
            ("C2", "A", "fec_api_sponsor_id"), ("C2", "B", "leadership_file_exact_name"),       # API wins over a name
            ("C3", "A", "fec_api_sponsor_id"), ("C3", "B", "fec_candidate_id"),                 # two exact ids: dropped
            ("C4", "A", "leadership_file_exact_name"), ("C4", "B", "fec_candidate_id"),         # no API: dropped as before
            ("C5", "A", "fec_api_sponsor_id"), ("C5", "A", "fec_candidate_id"), ("C5", "A", "leadership_file_exact_name"),
            ("C6", "B", "leadership_file_exact_name"), ("C7", "B", "fec_api_sponsor_id")]
    final, rep = leadership.combine(rows)
    assert final == [("C1", "A", "fec_api_sponsor_id+leadership_file_exact_name"), ("C2", "A", "fec_api_sponsor_id"),
                     ("C5", "A", "fec_api_sponsor_id+fec_candidate_id+leadership_file_exact_name"),
                     ("C6", "B", "leadership_file_exact_name"), ("C7", "B", "fec_api_sponsor_id")]
    assert rep["conflicting_sources_dropped"] == [{"committee": "C3", "members": ["A", "B"]}, {"committee": "C4", "members": ["A", "B"]}]
    assert rep["name_file_overridden_by_api"] == [{"committee": "C2", "api_member": "A", "name_file_members": ["B"]}]
    assert rep["newly_linked_by_api"] == 1 and rep["linked_by_api_total"] == 4        # only C7 had no link without the API
    assert leadership.combine(list(reversed(rows)))[0] == final


@pytest.mark.parametrize("route,reason", [
    (lambda p, q: Resp(500), "HTTP 500"),
    (lambda p, q: Resp(403), "HTTP 403"),
    (lambda p, q: Resp(200, text="<html>not json"), "not JSON"),
    (lambda p, q: Resp(200, {"unexpected": 1}), "lacks results"),
    (lambda p, q: ok([{"committee_id": "bad", "sponsor_candidate_ids": []}]), "valid committee_id"),
    (lambda p, q: ok([{"committee_id": "C00000001"}], 1, 1, 7), "API counts 7"),
])
def test_failures_never_raise_and_leave_no_key_in_the_report(route, reason, capsys):
    c, s = client(route)
    committees, rep = sponsors_api.load_committees(c, now=1e9)
    assert committees is None and rep["status"] == "unavailable" and reason in rep["warning"]
    assert KEY not in json.dumps(rep) and KEY not in capsys.readouterr().out
    assert sponsors_api.rows_for(CAND_TO_BIO, c)[0] == []


def test_server_errors_are_retried_then_the_client_stops_for_the_run():
    c, s = client(lambda p, q: Resp(503))
    with pytest.raises(api.ApiError):
        c.get("/committees/", {})
    assert len(s.calls) == 3 and not c.enabled


def test_connection_error_message_hides_the_url_and_key():
    def boom(p, q):
        raise requests.ConnectionError(f"HTTPSConnectionPool: /v1{p}?api_key={KEY}")
    c, _ = client(boom)
    with pytest.raises(api.ApiError) as e:
        c.get("/committees/", {})
    assert KEY not in str(e.value) and "ConnectionError" in str(e.value)


def test_429_waits_and_retries_then_succeeds():
    seen = []
    def route(p, q):
        seen.append(1)
        return Resp(429, headers={"Retry-After": "5"}) if len(seen) == 1 else ok([])
    waits = []
    c = api.FecApi(key=KEY, session=Session(route), sleep=waits.append)
    assert c.get("/x/", {})["results"] == [] and waits == [5.0]


def test_no_key_makes_no_request_and_falls_back(capsys):
    c, s = client(key="")
    committees, rep = sponsors_api.load_committees(c, now=1e9)
    assert committees is None and s.calls == [] and "FEC_API_KEY is not set" in rep["warning"]
    assert "WARNING" in capsys.readouterr().out


def test_request_budget_is_a_hard_stop():
    c, s = client(max_requests=1)
    committees, rep = sponsors_api.load_committees(c, now=1e9)
    assert committees is None and "budget" in rep["warning"] and len(s.calls) == 1


def seed(age_days: float, now: float = 1e9) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - age_days * 86400))
    api.cache_write(sponsors_api.CACHE_NAME, {"retrieved": stamp, "committees": [
        {"committee_id": "C00000001", "name": "CACHED", "sponsor_candidate_ids": [CRUZ], "cycles": []}]})


def test_cache_is_used_for_seven_days_then_refetched():
    seed(6.9)
    c, s = client()
    got, rep = sponsors_api.load_committees(c, now=1e9)
    assert rep["status"] == "cache" and s.calls == [] and got[0]["name"] == "CACHED"
    seed(7.1)
    got, rep = sponsors_api.load_committees(c, now=1e9)
    assert rep["status"] == "fetched" and len(s.calls) == 2 and got[0]["committee_id"] == "C00083337"


def test_a_stale_cache_survives_an_api_failure_and_says_so():
    seed(30)
    got, rep = sponsors_api.load_committees(client(lambda p, q: Resp(500))[0], now=1e9)
    assert rep["status"] == "stale_cache" and got[0]["name"] == "CACHED" and "HTTP 500" in rep["warning"]


def test_cache_only_never_calls_the_network(monkeypatch):
    monkeypatch.setenv("PT_CACHE_ONLY", "1")
    c, s = client()
    assert sponsors_api.load_committees(c, now=1e9)[1]["status"] == "unavailable"
    seed(400)
    assert sponsors_api.load_committees(c, now=1e9)[1]["status"] == "cache" and s.calls == []


def test_unreadable_cache_is_ignored():
    p = api.cache_dir() / sponsors_api.CACHE_NAME
    p.parent.mkdir(parents=True)
    p.write_text("{not json")
    assert sponsors_api.load_committees(client()[0], now=1e9)[1]["status"] == "fetched"


def test_build_leadership_uses_the_api_and_keeps_the_file_linkage(monkeypatch):
    """Whole _leadership step on empty bulk tables: only the API rows exist, so only they link."""
    committees, _ = sponsors_api.load_committees(client()[0], now=1e9)
    monkeypatch.setattr(api, "_DEFAULT", client()[0])
    members = refs.Members("t", {b: {"fec_ids": [i for i, x in CAND_TO_BIO.items() if x == b]} for b in set(CAND_TO_BIO.values())})
    members.build_index()
    con = duckdb.connect(":memory:")
    load.ensure_tables(con)
    rep: dict = {}
    build._leadership(con, members, [2008], rep)
    lp = rep["leadership_pacs"]
    assert dict((c, b) for c, b, _ in con.execute("SELECT * FROM lpac").fetchall())["C00235655"] == "M000355"
    assert lp["by_method"] == {"fec_api_sponsor_id": 4} and lp["newly_linked_by_api"] == 4
    assert lp["openfec_sponsors"]["status"] == "cache" and lp["conflicting_sources_dropped"] == []
