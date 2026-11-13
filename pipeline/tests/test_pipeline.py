"""Unit tests for the rules in docs/data-dictionary.md. Run: python -m pytest -q pipeline/tests"""
from __future__ import annotations

from datetime import date, datetime

from pipeline import assemble, trades, validate
from pipeline.companies import same_issuer_possible
from pipeline.edges import by_year, edge_id, make_edge, node, sum_amounts, top_evidence
from pipeline.edges_trades import eligible
from pipeline.util import normalise_name, normalise_ticker


def test_normalise_name_drops_suffixes_and_punctuation() -> None:
    assert normalise_name("The Walt Disney Co.") == "WALT DISNEY"
    assert normalise_name("AT&T INC.") == "AT T"
    assert normalise_name("Berkshire Hathaway Holdings Group, Inc") == "BERKSHIRE HATHAWAY"
    assert normalise_name("McDonald's Corp") == "MCDONALDS"


def test_normalise_ticker_share_classes() -> None:
    assert normalise_ticker("brk/b") == normalise_ticker("BRK-B") == normalise_ticker("BRK.B") == "BRK.B"


def test_ticker_veto_only_when_names_clearly_differ() -> None:
    assert same_issuer_possible(["APPLE INC (AAPL)"], "Apple Inc.")
    assert same_issuer_possible(["AMERICAN INTL GROUP, INC. CMN"], "AMERICAN INTERNATIONAL GROUP, INC.")
    assert not same_issuer_possible(["SunTrust Banks, Inc. (STI)"], "Solidion Technology Inc.")


def test_sums_keep_missing_as_unknown() -> None:
    s = sum_amounts([{"low": 1001, "high": 15000, "exact": None}, {"low": None, "high": None, "exact": None}])
    assert s == {"low": 1001, "high": None, "exact": None}
    assert sum_amounts([{"low": None, "high": None, "exact": None}]) == {"low": None, "high": None, "exact": None}
    years = by_year([(2020, 1, {"low": 1, "high": 2, "exact": None}), (2020, 1, {"low": 3, "high": 4, "exact": None}),
                     (2021, 1, {"low": 5, "high": None, "exact": None})])
    assert years == [{"y": 2020, "n": 2, "low": 4, "high": 6, "exact": None}, {"y": 2021, "n": 1, "low": 5, "high": None, "exact": None}]
    assert sum_amounts(years) == {"low": 9, "high": None, "exact": None}


def test_owner_and_asset_mappings_never_guess() -> None:
    assert trades.OWNER["not_indicated"] == "unspecified"
    assert "self" not in {v for k, v in trades.OWNER.items() if k != "self"}
    assert trades.asset_class("house", None, None) == "unknown"
    assert trades.asset_class("house", "ZZ", None) == "unknown"
    assert trades.asset_class("senate", None, "Stock") == "stock"
    assert trades.asset_class("house", "GS", None) == "bond"


def test_available_date_is_eastern() -> None:
    assert trades.available_date(datetime(2012, 8, 23, 3, 59, 59)) == date(2012, 8, 22)
    assert trades.available_date(None) is None


def test_undirected_edges_are_ordered_and_ids_stable() -> None:
    ev = [{"label": "x", "date": "2020-01-01", "url": None, "source": "s", "record": None}]
    e = make_edge("traded_together", node("member", "Z000001"), node("member", "A000001"), directed=False, basis="derived",
                  years=[{"y": 2020, "n": 5, "low": None, "high": None, "exact": None}], first="2020-01-01",
                  last="2020-01-01", evidence=ev, evidence_total=1, stat={"observed": 5, "expected": 1, "lift": 5, "p": 0.01, "method": "m"})
    assert e["from"]["id"] == "A000001" and e["count"] == 5
    assert edge_id("traded", node("member", "A"), node("org", "co:1")) == edge_id("traded", node("member", "A"), node("org", "co:1"))


def test_top_evidence_largest_then_latest() -> None:
    items = [{"label": str(i), "date": d, "url": None, "source": "s", "record": str(i), "_size": s}
             for i, (d, s) in enumerate([("2020-01-01", 10), ("2021-01-01", 10), ("2019-01-01", 99), (None, None)])]
    assert [e["label"] for e in top_evidence(items)] == ["2", "1", "0", "3"]
    assert "_size" not in top_evidence(items)[0]


def test_traded_together_eligibility() -> None:
    companies = {"co:1": {"sic": 3571, "pooled_vehicle": False}, "co:2": {"sic": None, "pooled_vehicle": False}}
    base = {"ticker": "X", "date": date(2020, 1, 1), "action": "buy", "asset_class": "stock", "org": "co:1"}
    assert eligible(base, companies)
    assert not eligible({**base, "asset_class": "fund"}, companies)
    assert eligible({**base, "asset_class": "unknown"}, companies)
    assert not eligible({**base, "asset_class": "unknown", "org": "co:2"}, companies)
    assert not eligible({**base, "ticker": None}, companies)
    assert not eligible({**base, "date": None}, companies)


def _edge(type_: str, frm: tuple[str, str], to: tuple[str, str], first: str, last: str, exact: float | None = None) -> dict:
    e = make_edge(type_, node(*frm), node(*to), directed=True, basis="filed",
                  years=[{"y": int(first[:4]), "n": 1, "low": exact, "high": exact, "exact": exact}], first=first, last=last,
                  evidence=[{"label": "x", "date": first, "url": None, "source": "s", "record": None}], evidence_total=1)
    e["id"] = edge_id(e["type"], e["from"], e["to"], e["via"])
    return e


def test_cases_need_three_overlapping_filed_types() -> None:
    m, o = ("member", "A000001"), ("org", "co:1")
    edges = [_edge("traded", m, o, "2018-01-01", "2022-01-01"), _edge("pac_money", o, m, "2020-01-01", "2021-01-01", 5000),
             _edge("employee_money", o, m, "2021-01-01", "2023-01-01", 100)]
    cases = assemble.find_cases(edges)
    assert len(cases) == 1 and cases[0]["years"] == [2021, 2021] and cases[0]["score"] == 3
    edges[2] = _edge("employee_money", o, m, "2023-01-01", "2024-01-01", 100)
    assert assemble.find_cases(edges) == []
    context = [edges[0], edges[1], _edge("oversees", m, o, "2020-01-01", "2021-01-01")]
    assert assemble.find_cases(context) == []


def test_member_budget_keeps_largest_money_edges_and_all_others() -> None:
    m = ("member", "A000001")
    money = [_edge("pac_money", ("org", f"pac:C{i:08d}"), m, "2020-01-01", "2020-01-01", float(i)) for i in range(1, 40)]
    traded = _edge("traded", m, ("org", "co:1"), "2020-01-01", "2020-01-01")
    full, rest = assemble.split_member_edges("A000001", money + [traded], set())
    assert traded in full and len(full) == assemble.MONEY_EDGES_PER_MEMBER + 1
    size = assemble.edge_size
    assert min(size(e) for e in full if e["type"] == "pac_money") > max(size(e) for e in rest)


def test_validator_catches_bad_by_year() -> None:
    c = validate.Checker()
    e = _edge("traded", ("member", "A000001"), ("org", "co:1"), "2020-01-01", "2020-01-01", 10.0)
    validate.check_edge(c, e, "t", {"s"}, {"A000001"}, {"co:1"})
    assert not c.errors
    e["by_year"][0]["n"] = 2
    validate.check_edge(c, e, "t", {"s"}, {"A000001"}, {"co:1"})
    assert "by_year n sums to count" in c.errors
