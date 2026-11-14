"""Strict member-name rules of the LDA module (pipeline/lda/match.py)."""
from pipeline.lda.match import Matcher, Member, fec_person_name, honoree_key, name_keys, serving_years
from pipeline.util import normalise_name


def mk(bio, names, years):
    return Member(bio, names[0], name_keys(names), set(years))


MEMBERS = [
    mk("OLD", ["John Smith"], range(2001, 2005)),
    mk("NEW", ["John Smith"], range(2019, 2027)),
    mk("MJ1", ["Mike Johnson"], range(2017, 2027)),
    mk("MJ2", ["Mike Johnson"], range(2015, 2021)),       # a second Mike Johnson overlapping 2017-2020
    mk("PSR", ["Donald M. Payne", "Donald Payne"], range(1989, 2013)),
    mk("PJR", ["Donald M. Payne Jr.", "Donald Payne Jr."], range(2012, 2025)),
    mk("DWS", ["Debbie Wasserman Schultz"], range(2005, 2027)),
    mk("NV", ["Nydia M. Velázquez", "Nydia Velázquez"], range(1993, 2027)),
    mk("JT", ["John Thune", "JOHN R THUNE"], range(2005, 2027)),
    mk("MM", ["Mitch McConnell"], range(1985, 2027)),
]
M = Matcher({m.bio: m for m in MEMBERS},
            {normalise_name("Friends of John Thune"): {"JT"}, normalise_name("Thune for Senate"): {"JT"}},
            {normalise_name("NRSC")})


def test_same_name_different_years():
    assert M.contribution("", "Sen. John Smith", 2020) == ("NEW", "honoree_name")
    assert M.contribution("", "Senator John Smith", 2003) == ("OLD", "honoree_name")
    assert M.contribution("", "John Smith", 2010)[0] is None          # neither served in 2010


def test_two_mike_johnsons():
    assert M.contribution("", "Rep. Mike Johnson", 2019) == (None, "honoree_ambiguous_name")
    assert M.contribution("", "Speaker Mike Johnson", 2024) == ("MJ1", "honoree_name")


def test_suffixes():
    assert M.contribution("", "Rep. Donald Payne Jr.", 2012)[0] == "PJR"
    assert M.contribution("", "Rep. Donald Payne", 2012)[0] is None   # father and son both served in 2012
    assert M.contribution("", "Congressman Donald M. Payne, Jr.", 2016)[0] == "PJR"
    assert M.contribution("", "Donald Payne III", 2016)[0] is None


def test_hyphen_and_accents():
    assert M.contribution("", "Rep. Debbie Wasserman-Schultz", 2020)[0] == "DWS"
    assert M.contribution("", "Rep. Nydia Velazquez", 2020)[0] == "NV"
    assert M.contribution("", "Hon. Nydia M. Velázquez", 2020)[0] == "NV"


def test_committee_names_and_surname_only():
    assert M.contribution("Friends of John Thune", "", 2020) == ("JT", "payee_committee")
    assert M.contribution("FRIENDS OF JOHN THUNE INC.", "", 2020) == ("JT", "payee_committee")
    assert M.contribution("Friends of Thune", "", 2020)[0] is None
    assert M.contribution("Thune for Senate", "Senator Thune", 2020) == ("JT", "payee_committee")
    assert M.contribution("", "Senator Thune", 2020) == (None, "honoree_surname_only")
    assert M.contribution("NRSC", "Senator John Thune", 2020) == (None, "payee_other_committee")
    assert M.contribution("Friends of John Thune", "Rep. Mike Johnson", 2024) == (None, "conflict")
    assert M.contribution("", "Thune, John", 2020) == ("JT", "honoree_name")
    assert M.contribution("", "The Honorable John R. Thune (R-SD)", 2020) == ("JT", "honoree_name")


def test_covered_positions():
    found, out = M.positions("Legislative Assistant, Sen. Mitch McConnell", set(range(1900, 2021)))
    assert out == "matched" and [(b, w) for b, w, _ in found] == [("MM", False)]
    found, _ = M.positions("Chief of Staff, Mitch McConnell", set(range(1900, 2021)))
    assert [(b, w) for b, w, _ in found] == [("MM", True)]
    found, _ = M.positions("Office of Mitch McConnell (2009-2014)", set(range(1900, 2021)))
    assert [(b, w) for b, w, _ in found] == [("MM", False)]
    found, _ = M.positions("Senator McConnell's office", set(range(1900, 2021)))
    assert found == []                                              # surname only
    assert M.positions("Professional Staff, Senate Finance Committee", set(range(1900, 2021))) == ([], "committee_staff")
    assert M.positions("LA, Rep. Mike Johnson", set(range(1900, 2021)))[1] == "ambiguous_name"
    found, _ = M.positions("Scheduler, Rep. John Thune; LD, Sen. Mitch McConnell", set(range(1900, 2021)))
    assert sorted(b for b, _, _ in found) == ["JT", "MM"]


def test_helpers():
    assert honoree_key("Sen. John Thune") == "JOHN THUNE"
    assert fec_person_name("THUNE, JOHN R MR.") == "JOHN R THUNE"
    assert fec_person_name("PAYNE, DONALD M JR") == "DONALD M PAYNE JR"
    assert serving_years([{"start": "2019-01-03", "end": "2021-01-03"}]) == {2019, 2020}
