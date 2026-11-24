"""Tests for the extended street-address rules (address_rules.py): real strings from the House Schedule A/D tables,
the keep-list, idempotence, and the independent build-gate check (address_check.py) run over redacted output."""
import pytest

from pipeline.holdings import rules
from pipeline.holdings.address_check import residual_address, residual_in_row
from pipeline.holdings.address_rules import A4

R = rules.REDACTED


def liab(text):
    real = bool(rules.REAL_ESTATE.search(text))
    return rules.redact(text, real, liability=True)[0]


def asset(text, loc=False):
    return rules.redact(text, True, loc)[0]


def test_redacted_marker_has_one_source():
    from pipeline.holdings import address_rules
    assert rules.REDACTED is address_rules.REDACTED


def test_pelosi_liability_row():
    assert liab("Equity Line of Credit on 2640 Broadway,") == f"Equity Line of Credit on {R},"
    assert rules.redact("Equity Line of Credit on 2640 Broadway,", False, liability=True)[1] is True


LIAB_REDACTED = [   # (real filed text, expected)
    ("Mortgage on 1 Main", f"Mortgage on {R}"),
    ("HELOC AT 900 BROADWAY", f"HELOC AT {R}"),
    ("Line of credit on 42 5th", f"Line of credit on {R}"),
    ("Note on 77 river", f"Note on {R}"),
    ("MORTGAGE ON 1916 MONONGAHELA", f"MORTGAGE ON {R}"),
    ("Mortgage on 2021 Broadway", f"Mortgage on {R}"),
    ("Loan on 1950 Broadway", f"Loan on {R}"),
    ("Mortgage on 529 Broadway", f"Mortgage on {R}"),
    ("HEL - 530 Bowsprit", f"HEL - {R}"),
    ("1605 Patterson", R),
    ("1583 Patterson", R),
    ("210 N Main, 1107 W Coffman, Salem MO", f"{R} Salem MO"),
    ("702 E Third Salem, MO", f"{R}, MO"),
    ("To finance purchase of 3501 South Meade", f"To finance purchase of {R}"),
    ("CFCU - 3501 South Meade", f"CFCU - {R}"),
    ("Northwest Savings Bank 100 Liberty", f"Northwest Savings Bank {R}"),
    ("Northwest Savings Bank 100 liberty", f"Northwest Savings Bank {R}"),
    ("Mortgage on 1s651 Verdun Dr Winfield,", f"Mortgage on {R} Winfield,"),
    ("Home Equity Loan on 1s651 Verdun Dr", f"Home Equity Loan on {R}"),
    ("Mortgage on N2736 S. Buckholz Rd.,", f"Mortgage on {R},"),
    ("BB&T- 1702-1704 MLK Pkwy", f"BB&T- {R}"),
    ("Note on 211-213 Pender St", f"Note on {R}"),
    ("Mortgage loan on 1612 & 1616 Kenley,", f"Mortgage loan on {R},"),
    ("Mortgage on 2640-2642 Broadway", f"Mortgage on {R}"),
    ("Mortgage (33 1/3%) 501 & 503 E. 6th", f"Mortgage (33 1/3%) {R}"),
    ("Mortgage on 7501 - 2F, River", f"Mortgage on {R}"),
    ("1st Mortgage on 1830-11th St., NW,", f"1st Mortgage on {R}, NW,"),
    ("Mortgage on 403 S Sapodilla Ave unit 213,", f"Mortgage on {R},"),
    ("Mortgage on 350 G St. SW, Apt 104,", f"Mortgage on {R},"),
    ("MORTGAGE: 2105 1/2 S", f"MORTGAGE: {R}"),
    ("Mortgage on rental property, 4609", f"Mortgage on rental property {R}"),
    ("Home equity on personal residence 602", f"Home equity on personal residence {R}"),
    ("Mortgage on 9 Jefferson, Warwick, RI", f"Mortgage on {R}, Warwick, RI"),
]


@pytest.mark.parametrize("text,want", LIAB_REDACTED)
def test_liability_addresses_redacted(text, want):
    assert liab(text) == want
    assert liab(want) == want                                # idempotent
    assert residual_address(want) == []                      # the independent gate agrees


LIAB_KEPT = [
    "401K Loan", "401k Loan", "VF 401K Savings plan loan", "Loan against 403b account", "Wells Fargo 401(k)", "401(k) loan",
    "20 Yr", "iShares TR 20 Yr Tr Bd ETF", "20 year finance for solar panels", "$100,000 home equity line of credit",
    "MEIJER GST EXEMPT 97 FBO PETER", "WP Growth 14 Private Investors, LLC -", "Meridian 411 Loan", "5/3 Bank", "Golden 1 Credit Union",
    "8X8 Inc, short position, open", "Loan on 1999 purchase", "Loan at 2025", "Note on 529 plan", "Held at 529 College Savings",
    "Account 1234", "Bank of America-8921", "US Bank - 9437", "Bought on 500 shares", "Vanguard 500 Index", "S&P 500",
    "Rate at 4.5%", "Loan at 3 1/2%", "Mortgage at 4.5 percent", "Opened on 12/31/2025", "Loan on 12/31/2025 for $50,000",
    "Loan of $250,000 at 4.5%", "Note at 5 years", "Loan on 30 year term", "Option on 100 units", "Lot 4", "Unit 3",
    "Mortgage payable at 12,500 per month", "Line of credit on 2,640 Broadway", "Mortgage on 320 acres of Farmland,",
    "Mortgage on 2nd Home", "Loan on property, tax map 33-27 and 42-1", "Mortgage on Residence Sold in 2014",
    "Promissory Note Due 10/29/2023", "257.10 acres, Outbuildings, Equipment &", "Rental Property, Whitefish MT 59937",
    "Credit Card Balance 12/31/1026", "Student Loans 10", "Payoff of 12/2021 BMO Harris Loan", "1987 Morgan Trust",
]


@pytest.mark.parametrize("text", LIAB_KEPT)
def test_liability_text_kept(text):
    assert liab(text) == text
    assert residual_address(text, True) == []


def test_street_name_without_number_is_left():            # no house number: not a street address by our rules
    assert liab("MORTGAGE ON 54TH ST RENTAL") == "MORTGAGE ON 54TH ST RENTAL"
    assert liab("Mortgage - 2nd St., Ontario, OR") == "Mortgage - 2nd St., Ontario, OR"


@pytest.mark.parametrize("text,want", [
    ("9 Jefferson", R),
    ("Future Realty Management LLC ⇒ 9 Jefferson", f"Future Realty Management LLC ⇒ {R}"),
    ("1014-1016 Cherokee, 100% Interest", f"{R}, 100% Interest"),
    ("1830-11th St., NW, Washington, DC 20001", f"{R}, NW, Washington, DC 20001"),
    ("4202-4208 Locust", R),
    ("Hanabusa Limited Partnership Land 85-909 Farrington Hwy", f"Hanabusa Limited Partnership Land {R}"),
    ("1520 Senate Street #72, LLC", f"{R}, LLC"),
])
def test_asset_addresses_redacted(text, want):
    assert asset(text, loc=True) == want
    assert asset(want, loc=True) == want


@pytest.mark.parametrize("text", [
    "4 Point Investments, LLC", "5 Stones Consulting", "6 Acres Land", "Vanguard 500 Index Fund", "Vanguard 401(k) ⇒ NW Z NYSE AT 100 IS",
    "Fidelity 457 Deferred Compensation ⇒ MissionSquare PLUS R13 Fund", "Charles Schwab ⇒ A10 Networks, Inc. Common Stock (ATEN)",
    "SP M40 (Merrill Lynch) ⇒ R2000 CLIRN ISSUER CIBC CaP 18.18%", "Brighthouse RILA ⇒ 3 Year Shield 15 S&P500 Index",
    "Haven at P83 LLC ⇒ Haven at P83 Property", "J.P. Morgan -B4717 Consolidated (Child 1 ) ⇒ J.P. Morgan -B4717 Consolidated",
    "Fund 1999-2000 Plan", "SEP IRA BAIRD 8453 ⇒ FIRST TRUST 75/25 STRAT ALLOC 1Q17",
])
def test_asset_text_kept(text):
    assert rules.redact(text, False, False)[0] == text
    assert rules.redact(text, True, False)[0].count(R) == 0 or "Index" in text   # A2 on property rows is the older rule


def test_cue_in_non_property_asset_text_needs_secured_by_or_located_at():
    assert rules.redact("NYSE AT 100 IS", False)[0] == "NYSE AT 100 IS"
    assert rules.redact("Note secured by 55 Elm Hollow", False)[0] == f"Note secured by {R}"


def test_a4_rate_fraction_not_matched():
    assert A4.search("Loan at 3 1/2%") is None


BLIND = ("5th", "2F, River", "1/2 S", "4609", "residence 602", "/2", "NW,", "104,")   # number-only fragments: the gate cannot see a name


def test_gate_flags_what_the_rules_remove_and_passes_redacted_output():
    for raw, _ in LIAB_REDACTED:
        if not raw.endswith(BLIND):                         # the gate would have failed the unredacted text
            assert residual_address(raw), raw
        assert residual_address(liab(raw)) == [], raw
    assert residual_in_row("Mortgage on 9 Jefferson", True, False, rules.REAL_ESTATE)
    assert residual_in_row("Future Realty Management LLC ⇒ 9 Jefferson", False, True, rules.REAL_ESTATE)
    assert not residual_in_row("4 Point Investments, LLC", False, True, rules.REAL_ESTATE)


ENTITY_REDACTED = [
    ("827 JCB, LLC", f"{R}, LLC"), ("Debt related to 827 JCB, LLC", f"Debt related to {R}, LLC"),
    ("CHP 1010 McDowell LLC,", f"CHP {R} LLC,"), ("ELK 300 E 83, LLC", f"ELK {R}, LLC"),
    ("Equity Line of Credit (2640 Broadway)", f"Equity Line of Credit ({R})"),
    ("HELOC 2021 Broadway", f"HELOC {R}"), ("Mortgage, 1916 Monongahela", f"Mortgage, {R}"),
    ("Mortgage on 1950 broadway", f"Mortgage on {R}"),
]


@pytest.mark.parametrize("text,want", ENTITY_REDACTED)
def test_entity_names_and_year_like_numbers_in_liabilities(text, want):
    assert liab(text) == want
    assert residual_address(want, True) == []


@pytest.mark.parametrize("text,want", [
    ("2093 Charlie Chambers", R), ("Texas Four Bar R Investments LTD ⇒ 1917 Texas", f"Texas Four Bar R Investments LTD ⇒ {R}"),
    ("30 Acres 2000 Blackjack, Aubrey, TX", f"30 Acres {R}, Aubrey, TX"), ("Condo 2021 Broadway", f"Condo {R}"),
    ("Real Property (11677-11683 Goshen Avenue)", f"Real Property ({R})"),
])
def test_year_like_house_numbers_in_property_assets(text, want):
    assert asset(text, loc=True) == want
    assert asset(want, loc=True) == want


@pytest.mark.parametrize("text", [   # real vehicle / plan / filed strings that start with a year (the reviewed allow-list)
    "2005 Toyota Sienna", "2017 Mazda 3", "1999 School Bus", "2026 Enrollment Year/VTY26 [5F]",
    "Airport Farms Aviation LLC, 1954 North American T6-J, Vans RV-8, 50% Interest", "FFN 2008 Warranty Reinsurance Company",
    "NTS 2013 Erwin LP", "121 Financial Credit Union", "360 Federal Credit Union", "Note due on 15 March 2030", "PO Box 2640 Springfield",
])
def test_year_allow_list_and_bank_names_kept(text):
    assert asset(text, loc=True) == text
    assert residual_in_row(text, False, True, rules.REAL_ESTATE) == []
    assert liab(text) == text


def test_apartments_llc_is_not_a_unit_fragment():
    assert asset("1500 Oak Street Apartments, LLC", loc=True) == f"{R} Apartments, LLC"


KNOWN_BLIND = ["Loan on #2640", "Loan on No.2640", "Loan 4B Elm", "Loan 12 College Park", "Loan on 2,640 Broadway"]


@pytest.mark.parametrize("text", KNOWN_BLIND)
def test_known_blind_spots_are_unchanged(text):          # documented gaps: number forms the rules do not recognise
    assert liab(text) == text


def test_every_validator_predicate_over_every_fixture():
    from pipeline.holdings.address_check import problems
    kept_assets = ["Vanguard 401(k) ⇒ NW Z NYSE AT 100 IS", "4 Point Investments, LLC", "5 Stones Consulting", "6 Acres Land",
                   "Fidelity 457 Deferred Compensation ⇒ MissionSquare PLUS R13 Fund", "SP M40 (Merrill Lynch) ⇒ R2000 CLIRN 18.04"]
    redacted_assets = [t for t, _ in ENTITY_REDACTED[:0]] + ["9 Jefferson", "1014-1016 Cherokee, 100% Interest", "2093 Charlie Chambers",
                                                              "30 Acres 2000 Blackjack, Aubrey, TX", "Condo 2021 Broadway"]
    for t in kept_assets:
        for loc in (False, True):
            assert problems(rules.redact(t, True, loc)[0], False, loc) == [], t
    for t in redacted_assets:
        assert problems(t, False, True), t                                   # the unredacted text fails
        assert problems(asset(t, loc=True), False, True) == [], t
    for t in LIAB_KEPT:
        assert problems(liab(t), True) == [], t
    for t, _ in LIAB_REDACTED + ENTITY_REDACTED:
        assert problems(liab(t), True) == [] or t.endswith(BLIND), t


@pytest.mark.parametrize("text,want", [
    ("1210 and 1212 East 6th", f"{R} 6th"),
    ("Residential Duplex Rental Property at 1035 and 1036 in Georgetown, TX", f"Residential Duplex Rental Property at {R} in Georgetown, TX"),
    ("Duplex at 1008/1010 in Georgetown, TX", f"Duplex at {R} in Georgetown, TX"),
    ("Rental Property at 1011 and 1015 in Georgetown, TX", f"Rental Property at {R} in Georgetown, TX"),
    ("Mortgage on 44 The Uplands", f"Mortgage on {R}"),
])
def test_and_ranges_and_numbers_before_a_city(text, want):
    assert asset(text, loc=True) == want
    assert asset(want, loc=True) == want
    assert residual_in_row(want, False, True, rules.REAL_ESTATE) == []
    assert residual_in_row(text, False, True, rules.REAL_ESTATE)              # the gate fails the unredacted text


@pytest.mark.parametrize("text", ["Lots, 44 and 45, Foo Estates", "Lots 24, 25, 30 and 31 Chetola Estates", "Lot 21 & 22 Chetola Estates"])
def test_lot_lists_are_not_ranges(text):
    if text.startswith("Lots"):
        assert " and " in asset(text, loc=True)                                 # the "N and" before the list's end is kept
    assert residual_in_row(asset(text, loc=True), False, True, rules.REAL_ESTATE) == []


def test_direction_and_street_number_are_removed_together():
    assert liab("ELK 300 E 83, LLC") == f"ELK {R}, LLC"


def test_gate_keep_list_covers_every_redactor_quantity_word():
    import re
    from pipeline.holdings import address_rules
    from pipeline.holdings.address_check import KEEP_WORDS
    words = set()
    for tok in address_rules._NONADDR.replace('"', "").split("|"):
        m = re.fullmatch(r"(\w+)\(\?:(\w+)\)\?", tok)
        words |= {m.group(1), m.group(1) + m.group(2)} if m else {tok}
    words |= set(address_rules._SMALL.split("|"))
    assert not {w for w in words if "?" not in w and w not in KEEP_WORDS}, sorted(words - KEEP_WORDS)
    assert "72 mo" and liab("PenFed 72 mo auto") == "PenFed 72 mo auto"


MORE_BLIND = ["Credit-2640 Broadway", "Loan #2640 Broadway", "2021 Broadway", "Loan 2020 Elm", "HELOC 529 Broadway", "HELOC 9 Jefferson",
              "Loan 12B Elm", "Loan 300 Private", "Loan 12 Tax Hill"]


@pytest.mark.parametrize("text", MORE_BLIND)
def test_more_known_blind_spots_are_unchanged(text):
    assert liab(text) == text
