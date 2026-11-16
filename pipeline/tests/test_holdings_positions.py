"""Unit tests for the position timeline rules (pipeline/holdings/positions.py): keys, snapshot sums, band
comparison, every transition class, status over gaps, owner changes and trade placement."""
from pipeline.holdings import positions as P

COLS = ["row", "asset", "ticker", "ticker_source", "org", "category", "owner", "low", "high", "income_type",
        "income_low", "income_high", "location", "doc"]
TCOLS = ["id", "date", "owner", "action", "asset", "asset_class", "low", "high", "org", "doc"]


def arow(row, asset, org=None, owner="joint", low=1001, high=15000, cat="stock", doc="d", loc=None):
    return [row, asset, org[3:] if org else None, "printed" if org else None, org, cat, owner, low, high, None, None,
            None, loc, doc]


def year(doc, rows):
    return {"doc": doc, "assets": {"cols": COLS, "rows": rows}}


def trades(*ts):
    return {"cols": TCOLS, "rows": [list(t) for t in ts], "filings": {t[-1]: f"https://x/{t[-1]}.pdf" for t in ts}}


def by_class(out):
    c = out["transitions"]["cols"]
    return [(r[c.index("from")], r[c.index("to")], r[c.index("class")]) for r in out["transitions"]["rows"]]


def test_classify_every_class():
    assert P.classify(False, True, None, 1, 0, 0) == "consistent"
    assert P.classify(False, True, None, 0, 1, 0) == "unexplained_appearance"
    assert P.classify(True, False, None, 0, 1, 0) == "consistent"
    assert P.classify(True, False, None, 0, 0, 0) == "unexplained_disappearance"
    assert P.classify(True, False, None, 0, 0, 0, sold_last_listed_year=1) == "consistent"
    assert P.classify(True, True, "up", 1, 0, 0) == "consistent"
    assert P.classify(True, True, "down", 0, 2, 0) == "consistent"
    assert P.classify(True, True, "up", 0, 0, 0) == "band_change_no_trade"
    assert P.classify(True, True, "down", 0, 0, 0) == "band_change_no_trade"
    assert P.classify(True, True, "up", 0, 1, 0) == "contrary"
    assert P.classify(True, True, "same", 1, 0, 0) == "traded_same_band"
    assert P.classify(True, True, "same", 0, 0, 0) == "unchanged"
    assert P.classify(True, True, "unclear", 1, 0, 0) == "not_comparable"
    assert P.classify(False, False, None, 1, 0, 0) == "traded_while_unlisted"
    assert P.classify(False, False, None, 0, 0, 0) is None
    assert P.classify(False, True, None, 0, 0, 1) == "consistent"  # an exchange's direction is not filed


def test_compare_bands():
    s = lambda lo, hi, unval=0: {"low": lo, "high": hi, "unvalued": unval}
    assert P.compare(s(1001, 15000), s(15001, 50000)) == "up"
    assert P.compare(s(15001, 50000), s(1001, 15000)) == "down"
    assert P.compare(s(1001, 15000), s(1001, 15000)) == "same"
    assert P.compare(s(1000001, None), s(1000001, None)) == "same"      # open-ended both years
    assert P.compare(s(50001, 100000), s(1000001, None)) == "up"
    assert P.compare(s(1001, 15000), s(0, None, 1)) == "unclear"         # a line with no value
    assert P.compare(s(2002, 30000), s(15001, 25000)) == "unclear"          # summed bands that cross


def test_status_gaps_are_not_sales():
    used = [2015, 2016, 2018, 2019]          # 2017: no report available
    assert P.status([2015, 2016, 2018, 2019], used) == [["throughout", 2015, 2019]]
    assert P.status([2016, 2018], used) == [["from", 2016], ["until", 2018]]
    assert P.status([2015, 2019], used) == [["again", 2019]]


def test_multi_line_sum_and_unknown_high():
    years = {"2020": year("d20", [arow("a1", "IRA ⇒ Apple Inc. (AAPL)", "co:1"), arow("a2", "Brokerage ⇒ Apple Inc. (AAPL)", "co:1", low=15001, high=50000)]),
             "2021": year("d21", [arow("a1", "IRA ⇒ Apple Inc. (AAPL)", "co:1"), arow("a2", "Brokerage ⇒ Apple Inc. (AAPL)", "co:1", low=None, high=None)])}
    out = P.build(years, None, {})
    snaps = out["snapshots"]["rows"]
    assert [s[1:7] for s in snaps] == [[2020, 16002, 65000, 2, 0, 0], [2021, 1001, None, 2, 1, 0]]
    assert by_class(out) == [(2020, 2021, "not_comparable")]


def test_owner_change_is_one_asset_and_flagged():
    years = {"2020": year("d20", [arow("a1", "Microsoft Corp (MSFT)", "co:2", owner="spouse")]),
             "2021": year("d21", [arow("a1", "Microsoft Corp (MSFT)", "co:2", owner="joint")])}
    out = P.build(years, None, {})
    assert len(out["assets"]["rows"]) == 1
    x = out["transitions"]["rows"][0]
    assert x[out["transitions"]["cols"].index("owner_change")] is True
    assert x[out["transitions"]["cols"].index("class")] == "unchanged"


def test_trades_between_snapshots_and_before_first():
    years = {"2019": year("d19", [arow("a1", "Acme Corp (ACME)", "co:3")]),
             "2020": year("d20", [arow("a1", "Acme Corp (ACME)", "co:3", low=15001, high=50000), arow("a2", "Vanguard 500 Index Fund")]),
             "2021": year("d21", [arow("a2", "Vanguard 500 Index Fund")])}
    ts = trades(("t0", "2018-05-01", "joint", "buy", "Acme Corp (ACME)", "stock", 1001, 15000, "co:3", "p0"),
                ("t1", "2020-03-01", "joint", "buy", "Acme Corp (ACME)", "stock", 1001, 15000, "co:3", "p1"),
                ("t2", "2020-09-01", "joint", "sell", "Acme Corp (ACME)", "stock", 1001, 15000, "co:3", "p2"),
                ("t3", "2020-10-01", "joint", "buy", "Other Co (OTH)", "stock", 1001, 15000, "co:9", "p3"))
    out = P.build(years, ts, {})
    # assets are ordered by the latest year listed: the fund (2021) first, then Acme (2020)
    assert by_class(out) == [(2019, 2020, "unexplained_appearance"), (2020, 2021, "unchanged"),
                             (2019, 2020, "consistent"), (2020, 2021, "consistent")]
    s = out["summary"]
    assert s["trades_matched"] == 3 and s["trades_before_first_report"] == 1 and s["trades_in_unlisted_assets"] == 1
    assert s["transitions"]["consistent"] == 2 and s["assets_with_trades"] == 1
    # the disappearance 2020 -> 2021 is explained by the sale dated in 2020, the last year that listed it
    x = [r for r in out["transitions"]["rows"] if r[0] == 1 and r[1] == 2020][0]
    assert x[out["transitions"]["cols"].index("sold_last_listed_year")] == 1
    assert set(out["filings"]) == {"p0", "p1", "p2"}


def test_keys_join_by_exact_name_only():
    rows = [arow("a1", "Apple Inc. (AAPL)", "co:1"), arow("a2", "IRA ⇒ Apple Inc.", None),
            arow("a3", "Apple Hospitality REIT", None), arow("a4", "Old Name Inc (OLD)", "tk:OLD"),
            arow("a5", "MSFT call option", "co:2", cat="option"), arow("a6", "Microsoft Corp (MSFT)", "co:2")]
    keys, _ = P.keys_for_rows(rows)
    assert keys == ["co:1", "co:1", "name:APPLE HOSPITALITY REIT", "tk:OLD", "co:2|option", "co:2"]


def test_redacted_property_keys_keep_location():
    rows = [arow("a1", "[street address redacted]", None, loc="Austin, TX", cat="other"),
            arow("a2", "[street address redacted]", None, loc="Reno, NV", cat="other")]
    keys, _ = P.keys_for_rows(rows)
    assert keys[0] != keys[1]


def test_resolved_trade_identity_cannot_fall_back_to_another_issuer():
    keys, aliases = P.keys_for_rows([arow("a1", "Acme Corp (ACME)", "co:1")])
    trade = {"org": "co:2", "asset": "Acme Corp (ACME)", "asset_class": "stock"}
    assert P.trade_key(trade, set(keys), aliases) is None
    # An unresolved ticker can still bridge the unique exact issuer name.
    assert P.trade_key({**trade, "org": "tk:OLD"}, set(keys), aliases) == "co:1"
