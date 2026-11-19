"""Unit tests for the rules in docs/data-dictionary.md. Run: python -m pytest -q pipeline/tests"""
from __future__ import annotations

from datetime import date, datetime, timedelta

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


def test_cases_need_holding_plus_money_or_people_overlapping() -> None:
    m, o = ("member", "A000001"), ("org", "co:1")
    traded = _edge("traded", m, o, "2018-01-01", "2022-01-01")
    pac = _edge("pac_money", o, m, "2020-01-01", "2021-01-01", 5000)
    cases = assemble.find_cases([traded, pac])
    assert len(cases) == 1 and cases[0]["years"] == [2020, 2021] and cases[0]["types"] == ["pac_money", "traded"]
    assert assemble.find_cases([traded, _edge("pac_money", o, m, "2023-01-01", "2024-01-01", 1)]) == []
    assert assemble.find_cases([pac, _edge("employee_money", o, m, "2020-01-01", "2021-01-01", 1)]) == []
    assert assemble.find_cases([traded, _edge("oversees", m, o, "2020-01-01", "2021-01-01")]) == []


def test_member_budget_keeps_largest_money_edges_and_all_others() -> None:
    m = ("member", "A000001")
    money = [_edge("pac_money", ("org", f"pac:C{i:08d}"), m, "2020-01-01", "2020-01-01", float(i)) for i in range(1, 40)]
    traded = _edge("traded", m, ("org", "co:1"), "2020-01-01", "2020-01-01")
    full, rest, context = assemble.split_member_edges("A000001", money + [traded], set())
    assert context == []
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


# ---------------------------------------------------------------- traded_before_contract

def _contract_trade(i: int, member: str, org: str, d: date, action: str = "buy") -> dict:
    return {"id": f"t{i}", "member": member, "org": org, "date": d, "available": d, "action": action,
            "ticker": "XYZ", "asset": "XYZ Corp", "asset_class": "stock", "owner": "self", "low": 1001,
            "high": 15000, "url": "https://example.org/ptr"}


def test_next_award_window_is_inclusive_and_forward_only() -> None:
    from pipeline.contracts import WINDOW_DAYS, next_award
    awards = [date(2020, 3, 1), date(2020, 6, 1)]
    assert next_award(date(2020, 3, 1), awards) == date(2020, 3, 1)  # same day counts
    assert next_award(date(2020, 3, 1) - timedelta(days=WINDOW_DAYS), awards) == date(2020, 3, 1)
    assert next_award(date(2020, 3, 1) - timedelta(days=WINDOW_DAYS + 1), awards) is None
    assert next_award(date(2020, 3, 2), awards) is None  # a buy after the award does not count


def test_permutation_flags_buys_timed_to_awards_but_not_routine_trading() -> None:
    from pipeline.contracts import passes, permutation_test
    year = [date(2021, 1, 1) + timedelta(days=7 * k) for k in range(52)]  # a member trading weekly all year
    pool = {2021: year}
    awards = [date(2021, 2, 12), date(2021, 5, 14), date(2021, 8, 13), date(2021, 11, 12)]
    timed = [d for d in year if any(0 <= (a - d).days <= 6 for a in awards)]  # one buy in the week before each award
    obs, exp, p = permutation_test(timed, pool, awards, shuffles=500)
    assert obs == 4 and passes(obs, exp, p)
    # A burst of buys before one award counts once.
    burst = [d for d in year if 0 <= (awards[0] - d).days <= 27]
    assert len(burst) == 4 and permutation_test(burst, pool, awards, shuffles=50)[0] == 1
    # Buying the week after each award is not flagged.
    after = [d for d in year if any(1 <= (d - a).days <= 7 for a in awards)]
    obs, exp, p = permutation_test(after, pool, awards, shuffles=500)
    assert obs == 0 and not passes(obs, exp, p)
    # A company that wins contracts every week: buying it at any time lands before an award, so nothing is flagged.
    busy = [d + timedelta(days=3) for d in year]
    obs, exp, p = permutation_test(year[:10], pool, busy, shuffles=500)
    assert obs == 10 and not passes(obs, exp, p)


def test_build_edges_writes_a_derived_edge_with_evidence() -> None:
    from pipeline.contracts import build_edges
    companies = {"co:1": {"name": "XYZ Corp", "sic": 3720, "pooled_vehicle": False}}
    other = [_contract_trade(100 + k, "A000001", "co:2", date(2021, 1, 1) + timedelta(days=7 * k), "sell") for k in range(104)]
    award_days = [date(2021, 1, 29) + timedelta(days=119 * k) for k in range(6)]  # one award every 17 weeks
    buy_days = [d - timedelta(days=4) for d in award_days] + [award_days[-1] - timedelta(days=11)]
    hits = [_contract_trade(k, "A000001", "co:1", d) for k, d in enumerate(buy_days)]
    awards = [{"id": f"CONT_AWD_{k}", "piid": f"P{k}", "date": d, "amount": 2.5e7, "agency": "Department of Defense",
               "subagency": "Department of the Army", "description": "WIDGETS", "recipient": "XYZ CORP"}
              for k, d in enumerate(award_days)]
    edges, report = build_edges(other + hits, companies, {"co:1": awards})
    assert report["pairs_tested"] == 1 and len(edges) == 1
    e = edges[0]
    assert e["type"] == "traded_before_contract" and e["basis"] == "derived" and e["stat"]["observed"] == 6
    assert e["family"] == "holding" and not e["weak"] and e["evidence_total"] == 6 and e["count"] == 7
    assert e["evidence"][0]["url"].startswith("https://www.usaspending.gov/award/CONT_AWD_")
    assert "4 days later" in e["evidence"][0]["label"] and "$25.0M" in e["evidence"][0]["label"]
    assert e["amount"] == {"low": 7007, "high": 105000, "exact": None}  # all seven pre-award buys
    assert any("and 1 earlier buy day in the 30 days before" in ev["label"] for ev in e["evidence"])


def test_contract_recipient_matches_by_exact_name_or_listed_parent_only() -> None:
    from pipeline.contracts import match_via
    profiles = {"r1-C": {"GENERAL DYNAMICS"}, "r2-C": {"GENERAL DYNAMICS LAND SYSTEMS"}}
    assert match_via("General Dynamics Corporation", None, "GENERAL DYNAMICS", profiles) == "name"
    assert match_via("BATH IRON WORKS CORPORATION", "r1-C", "GENERAL DYNAMICS", profiles) == "parent"
    assert match_via("GENERAL DYNAMICS LAND SYSTEMS INC.", "r2-C", "GENERAL DYNAMICS", profiles) is None  # no fuzzy match
    assert match_via("SOMEONE ELSE LLC", None, "GENERAL DYNAMICS", profiles) is None
