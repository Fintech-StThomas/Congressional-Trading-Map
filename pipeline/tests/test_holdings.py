"""Unit tests for the holdings rules (redaction, residences, owner mapping, range sums)."""
from pipeline.holdings import rules
from pipeline.holdings.run import band_sum, net_worth, printed_ticker


def test_owner_never_defaults_to_self():
    assert rules.OWNER["self"] == "unspecified"
    assert rules.OWNER["child"] == "dependent"
    assert set(rules.OWNER.values()) == {"unspecified", "spouse", "joint", "dependent"}


def test_street_addresses_are_redacted():
    out, hit = rules.redact("2221 St. Paul St., Baltimore, MD 21218", True)
    assert hit and "2221" not in out and "Baltimore" in out
    out, hit = rules.redact("REAL ESTATE ⇒ RENTAL HOUSE - 54TH STREET", True)
    assert hit and "54TH" not in out
    out, hit = rules.redact("Rental House 5214 29th", True, True)
    assert hit and "5214" not in out


def test_funds_and_years_are_not_redacted():
    for text in ("D3 Irrevocable Trust ⇒ John Hancock 529 Fixed Income Portfolio C2 [5P]",
                 "Vanguard 500 Index Fund Admiral", "Apple Inc. (AAPL)", "Smith 2012 Irrevocable Trust"):
        assert rules.redact(text, True, True) == (text, False)


def test_city_state_only():
    assert rules.city_state("Houston, TX, US") == ("Houston, TX", False)


def test_residences():
    assert rules.is_personal_residence("Washington residence", None)
    assert not rules.is_personal_residence("Residential Rental Property", "Rent")
    assert not rules.is_personal_residence("ARMOUR Residential REIT, Inc. (ARR)", "Dividends")
    assert rules.is_residence_debt("Wells Fargo", "Mortgage on Personal Residence")
    assert not rules.is_residence_debt("Amegy Bank", "Mortgage on Rental Property")


def test_printed_ticker_case_insensitive():
    assert printed_ticker("Investment account ⇒ american Express Company (aXP)", "AXP")
    assert not printed_ticker("American Express Company", "AXP")


def test_ranges_never_midpoint_and_open_ended():
    a = band_sum([(1001, 15000), (1000001, None), (None, None)])
    assert a == {"n": 3, "unvalued": 1, "open_ended": 1, "low": 1001002, "high": None, "high_valued": None}
    l = band_sum([(10001, 15000)])
    nw = net_worth(a, l)
    assert nw["low"] == 1001002 - 15000 and nw["high"] is None and nw["label"] == "at least"
    closed = net_worth(band_sum([(15001, 50000)]), band_sum([]))
    assert (closed["low"], closed["high"], closed["label"]) == (15001, 50000, "range")
