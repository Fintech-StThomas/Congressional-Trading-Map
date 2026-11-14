"""The validator catches what it claims to (pipeline/validate.py)."""
from __future__ import annotations

from pipeline import validate
from pipeline.edges import edge_id, make_edge, node


def _edge(exact: float) -> dict:
    e = make_edge("traded", node("member", "A000001"), node("org", "co:1"), directed=True, basis="filed",
                  years=[{"y": 2020, "n": 1, "low": exact, "high": exact, "exact": exact}], first="2020-01-01",
                  last="2020-01-01", evidence=[{"label": "x", "date": "2020-01-01", "url": None, "source": "s", "record": None}],
                  evidence_total=1)
    e["id"] = edge_id(e["type"], e["from"], e["to"], e["via"])
    return e


def test_validator_catches_bad_by_year() -> None:
    c = validate.Checker()
    e = _edge(10.0)
    validate.check_edge(c, e, "t", {"s"}, {"A000001"}, {"co:1"})
    assert not c.errors
    e["by_year"][0]["n"] = 2
    validate.check_edge(c, e, "t", {"s"}, {"A000001"}, {"co:1"})
    assert "by_year n sums to count" in c.errors
    e = _edge(10.0)
    e["by_year"] = e["by_year"] * 2
    e["count"], e["amount"] = 2, {"low": 20.0, "high": 20.0, "exact": 20.0}
    validate.check_edge(c, e, "t", {"s"}, {"A000001"}, {"co:1"})
    assert "by_year years unique and ascending" in c.errors


def test_validator_catches_unknown_source_and_endpoint() -> None:
    c = validate.Checker()
    validate.check_edge(c, _edge(1.0), "t", {"other"}, set(), {"co:1"})
    assert "evidence source listed in meta.json" in c.errors and "edge endpoint exists" in c.errors


def test_case_check_rederives_the_rule() -> None:
    traded = _edge(1.0)
    pac = make_edge("pac_money", node("org", "co:1"), node("member", "A000001"), directed=True, basis="filed",
                    years=[{"y": 2020, "n": 1, "low": 5, "high": 5, "exact": 5}], first="2020-01-01", last="2020-01-01",
                    evidence=traded["evidence"], evidence_total=1)
    pac["id"] = edge_id(pac["type"], pac["from"], pac["to"], pac["via"])
    good = {"id": "c", "member": "A000001", "org": "co:1", "types": ["pac_money", "traded"], "edges": [pac["id"], traded["id"]],
            "years": [2020, 2020], "score": 2, "money": 5, "trades": 1}
    c = validate.Checker()
    validate.check_cases(c, [good], {e["id"]: e for e in (traded, pac)}, {"A000001": 1})
    assert not c.errors
    validate.check_cases(c, [{**good, "years": [2019, 2020]}], {e["id"]: e for e in (traded, pac)}, {"A000001": 1})
    assert "case window inside every type's span" in c.errors


def test_validator_split_bounds_follow_the_party_at_the_time() -> None:
    terms = {"S000001": [{"start": "2017-01-03", "end": "2021-01-03", "party": "D", "chamber": "rep", "state": "NJ", "district": 2},
                         {"start": "2021-01-03", "end": "2025-01-03", "party": "R", "chamber": "rep", "state": "NJ", "district": 2}]}
    tie = {"type": "pac_money", "member": "S000001", "exact": 30, "low": 30, "high": 30, "first": "2019-05-01", "last": "2019-06-01"}
    of = {"org": {"split": {"given": {"D": [1, 30], "I": [0, 0], "R": [0, 0]}}}, "ledger_totals": {}}
    c = validate.Checker()
    validate.check_split(c, of, [tie], {"S000001": "R"}, terms, "o")
    assert not c.errors
    of["org"]["split"]["given"] = {"D": [0, 0], "I": [0, 0], "R": [1, 30]}     # the old latest-party rule
    validate.check_split(c, of, [tie], {"S000001": "R"}, terms, "o")
    assert "split member counts within the party at the time of listed ties" in c.errors
