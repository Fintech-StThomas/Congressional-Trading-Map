"""Unit tests for the change since the first report and the leverage figures (pipeline/holdings/profile.py)."""
from pipeline.holdings import profile as F

LCOLS = ["row", "creditor", "type", "owner", "low", "high", "incurred", "residence_secured", "doc"]


def nw(low, high, label="range", hv=None):
    return {"low": low, "high": high, "high_valued": hv if hv is not None else high, "label": label}


def test_change_is_a_range_of_possible_changes():
    assert F.range_change(nw(100, 200), nw(500, 900)) == {"low": 300, "high": 800}
    assert F.range_change(nw(100, 200), nw(-50, 100)) == {"low": -250, "high": 0}


def test_change_unknown_unless_both_full_ranges():
    assert F.range_change(nw(100, None, "at least"), nw(500, 900)) == {"low": None, "high": None}
    assert F.range_change(nw(100, None, "valued items only", 300), nw(500, 900)) == {"low": None, "high": None}


def test_tenure_change_flags_comparability():
    def yr(doc, n):
        return {"doc": doc, "net_worth": n}
    tc = F.tenure_change({"2015": yr("a", nw(1, 2)), "2017": yr("b", nw(5, None, "valued items only", 9)), "2020": yr("c", nw(5, 9))})
    assert tc["first_year"] == 2015 and tc["latest_year"] == 2020 and tc["years_between"] == 5
    assert tc["change"] == {"low": 3, "high": 8} and tc["comparable"] and tc["known"]
    tc = F.tenure_change({"2015": yr("a", nw(1, None, "valued items only", 2)), "2020": yr("c", nw(5, 9))})
    assert tc["comparable"] is False and tc["known"] is False
    assert F.tenure_change({"2015": yr("a", nw(1, 2))}) is None


def test_buckets_from_filed_type():
    b = F.liability_bucket
    assert b("Mortgage on personal residence", "Bank", True) == "residence"
    assert b("Margin Account", "Schwab", False) == "margin"
    assert b("Portfolio Loan", "Morgan Stanley", False) == "margin"
    assert b("Loan", "Fidelity securities-backed line", False) == "margin"
    assert b("Mortgage on rental property", "Bank", False) == "property"
    assert b("Mortgage", "Bank", False) == "mortgage_unstated"
    assert b("Revolving charge account", "Amex", False) == "credit"
    assert b("Student loans", "Navient", False) == "student"
    assert b("Personal loan", "Bank", False) == "personal"
    assert b("Auto loan", "Bank", False) == "vehicle"
    assert b("Liability", "Someone", False) == "other"


def test_share_range_bounds():
    assert F.share_range({"low": 10, "high": 20}, {"low": 100, "high": 200}) == {"low": 0.05, "high": 0.2}
    assert F.share_range({"low": 10, "high": 20}, {"low": 0, "high": None}) == {"low": None, "high": None}


def test_leverage_years_recurring_and_margin():
    def yr(rows):
        return {"liabilities": {"cols": LCOLS, "rows": rows},
                "totals": {"liabilities": {"low": 15001, "high": 50000}, "liabilities_residence_secured": {"low": 0, "high": 0},
                           "assets": {"low": 100000, "high": 300000}}}
    lev = F.leverage({"2020": yr([["d1", "Schwab", "Margin loan", "joint", 15001, 50000, "2019", False, "x"]]),
                      "2021": yr([["d1", "SCHWAB", "Margin loan", "joint", 15001, 50000, "2019", False, "y"]])})
    assert lev["recurring_creditors"]["rows"] == [["SCHWAB", [2020, 2021]]]
    assert [r[0] for r in lev["margin_loans"]["rows"]] == [2020, 2021]
    row = lev["by_year"]["rows"][0]
    assert row[:4] == [2020, 1, 15001, 50000] and row[-1] == {"margin": [1, 15001, 50000]}
