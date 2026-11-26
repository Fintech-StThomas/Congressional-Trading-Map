"""Review flags (pipeline/assemble/flags.py, flags_out.py) and their validator (pipeline/validate_flags.py): each rule
on small hand-built trades, with the boundaries, and "not evaluated" kept apart from "not met"."""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

import pytest

from pipeline import config as K
from pipeline.assemble import flags as F
from pipeline.assemble.flags_out import FLAGS_COLS, flags_file, flags_meta, selection
from pipeline.assemble.members import trade_file
from pipeline.validate_flags import check_flags_file, derive_large, derive_late, derive_pile_on
from pipeline.validate_flags_derive import sic_match

D0 = date(2025, 3, 3)


def tr(tid: str, member: str = "A000001", d: date | None = D0, *, lag: int | None = 10, low: float | None = 1001.0,
       high: float | None = 15000.0, action: str = "buy", org: str | None = "co:1", cls: str = "stock",
       available: date | None = None) -> dict[str, Any]:
    return {"id": tid, "member": member, "chamber": "rep", "version": 1, "amended": False, "date": d,
            "available": available or (d + timedelta(days=lag) if d and lag is not None else None), "lag_days": lag,
            "late": None if lag is None else lag > K.LATE_DAYS, "owner": "self", "action": action, "partial": None,
            "ticker": org[3:] if org else None, "ticker_source": "printed" if org else None, "asset": "A Corp",
            "asset_class": cls, "low": low, "high": high, "org": org, "doc_id": f"doc-{tid}", "url": "https://x/1",
            "amendments": [], "lag_withheld": None, "deleted": False}


MEMBERS = {"A000001": {"current": True, "fec_ids": ["H0XX00001"], "committees": [{"id": "cmte:HSBA"}, {"id": "cmte:HSBA01"}]},
           "B000002": {"current": True, "fec_ids": [], "committees": [{"id": "cmte:HSAG"}]},
           "C000003": {"current": False, "fec_ids": ["H0XX00003"], "committees": []},
           "D000004": {"current": True, "fec_ids": ["H0XX00004"], "committees": [{"id": "cmte:HSBA01"}]}}
ORGS = {"co:1": {"id": "co:1", "cik": 1, "sector": "Banking"}, "co:2": {"id": "co:2", "cik": 2, "sector": None},
        "tk:ZZ": {"id": "tk:ZZ", "cik": None, "sector": None}}
COMPANIES = {"co:1": {"sic": 6022, "pooled_vehicle": False}, "co:2": {"sic": None, "pooled_vehicle": False}}


def inputs(pac: dict | None = None, companies: dict | None = None) -> F.Inputs:
    return F.Inputs(MEMBERS, ORGS, COMPANIES if companies is None else companies, pac or {}, {"HSBA", "HSAG"},
                    {"HSBA": (("60", "61"), ()), "HSAG": (("01", "02"), ())})


# ---------------------------------------------------------------- late
def test_late_45_is_not_met_46_is_met_and_null_is_not_evaluated() -> None:
    assert F.rule_late(tr("a", lag=45)) is F.NOT_MET
    assert F.rule_late(tr("a", lag=46)) == {"lag_days": 46}
    assert F.rule_late(tr("a", lag=None)) is None


# ---------------------------------------------------------------- large_amount
def test_large_amount_starts_at_250001_and_null_is_not_evaluated() -> None:
    assert F.rule_large(tr("a", low=250001.0)) == {"low": 250001}
    assert F.rule_large(tr("a", low=1000001.0, high=None)) == {"low": 1000001}   # open-ended "over $1,000,000"
    assert F.rule_large(tr("a", low=250000.0)) is F.NOT_MET
    assert F.rule_large(tr("a", low=100001.0)) is F.NOT_MET
    assert F.rule_large(tr("a", low=None)) is None


# ---------------------------------------------------------------- pile_on
def test_pile_on_window_is_7_days_and_needs_2_other_members() -> None:
    a = tr("a", "A000001", D0)
    b = tr("b", "B000002", D0 + timedelta(days=7))
    c = tr("c", "C000003", D0 - timedelta(days=7))
    p = F.PileOn([a, b, c], {})
    assert p(a) == {"members": ["B000002", "C000003"], "observed": 2, "expected": round(2 * 15 / 365, 3)}
    assert p(b) is F.NOT_MET                                              # C is 14 days from B
    late = tr("c", "C000003", D0 - timedelta(days=8))
    assert F.PileOn([a, b, late], {})(a) is F.NOT_MET                     # 8 days: outside


def test_pile_on_same_direction_and_eligibility() -> None:
    a = tr("a", "A000001")
    others = [tr("b", "B000002", action="sell"), tr("c", "C000003")]
    assert F.PileOn([a, *others], {})(a) is F.NOT_MET                     # only one other member bought
    fund = tr("f", "A000001", cls="fund")
    assert F.PileOn([fund], {})(fund) is None                             # ineligible: not evaluated
    assert F.PileOn([], {})(tr("x", d=None)) is None
    unknown = tr("u", cls="unknown")
    assert F.PileOn([], {"co:1": {"sic": 6022, "pooled_vehicle": False}})(unknown) is F.NOT_MET
    assert F.PileOn([], {"co:1": {"sic": 6221, "pooled_vehicle": True}})(unknown) is None


def test_pile_on_lists_nearest_five_and_counts_all() -> None:
    a = tr("a", "M0")
    others = [tr(f"o{i}", f"M{i}", D0 + timedelta(days=i % 7)) for i in range(1, 8)]
    d = F.PileOn([a, *others], {})(a)
    assert d["observed"] == 7 and d["members"] == ["M7", "M1", "M2", "M3", "M4"]   # M7 is 0 days away


def test_pile_on_baseline_needs_3x_expected() -> None:
    a = tr("a", "M0", D0)
    near = [tr(f"n{i}", f"N{i}", D0 + timedelta(days=i)) for i in range(1, 3)]            # 2 others within 7 days
    far = [tr(f"f{i}", f"F{i:02d}", date(2025, 7, 1)) for i in range(28)]                  # 28 more that year, 1 day each
    assert F.pile_on_expected([1] * 30) == pytest.approx(30 * 15 / 365)                   # 1.233; 3x = 3.70
    assert F.PileOn([a, *near, *far], {})(a) is F.NOT_MET                                 # observed 2 < 3.70
    four = [tr(f"m{i}", f"N{i}", D0 + timedelta(days=i)) for i in range(1, 5)]
    d = F.PileOn([a, *four, *far[:26]], {})(a)                                            # 30 others, 4 near
    assert d is not F.NOT_MET and d["observed"] == 4 and d["expected"] == 1.233
    prior_year = [tr(f"p{i}", f"F{i:02d}", date(2024, 7, 1)) for i in range(28)]
    assert F.PileOn([a, *near, *prior_year], {})(a)["expected"] == 0.082                  # 245 days away: outside the base span
    assert F.pile_on_expected([]) == 1 / 365                                              # floor
    assert F.pile_on_expected([30, 1]) == pytest.approx(1 + 15 / 365)                     # a frequent trader counts at most 1
    busy = [tr(f"b{d}", "N1", D0 + timedelta(days=d)) for d in range(0, 300, 10)]         # N1 trades every 10 days
    other = tr("o", "N2", D0 + timedelta(days=1))
    assert F.PileOn([a, other, *busy], {})(a) is F.NOT_MET                                # 2 < 3 x (1 + 0.041): N1 is always near
    assert F.PileOn([a, other, busy[0]], {})(a)["expected"] == round(2 * 15 / 365, 3)     # the same pair, N1 trading once


def test_pile_on_baseline_is_a_rolling_365_days_across_the_year_edge() -> None:
    a = tr("a", "M0", date(2025, 12, 30))
    near = [tr(f"n{i}", f"N{i}", date(2026, 1, 2)) for i in range(2)]                     # next calendar year, 3 days away
    d = F.PileOn([a, *near], {})(a)
    assert d["observed"] == 2 and d["expected"] == round(2 * 15 / 365, 3)                # they count in expected too
    edge = [tr(f"e{i}", "N0", date(2025, 12, 30) + timedelta(days=k)) for i, k in enumerate((-182, 182, 183))]
    p = F.PileOn([a, *near, *edge], {})
    assert p(a)["expected"] == round((3 * 15 + 15) / 365, 3)                              # N0: 3 days in +/-182 (183 is out)
    met, _, _ = derive_pile_on({"M0": file_of([a]), "N0": file_of([near[0], *edge]), "N1": file_of([near[1]])}, {})
    assert met["a"]["expected"] == p(a)["expected"] and met["a"]["members"] == ["N0", "N1"]


def file_of(ts: list[dict[str, Any]]) -> dict[str, Any]:
    return {**trade_file(ts), "flags": {}}


# ---------------------------------------------------------------- money_both_ways
def pac(*years: tuple[int, float]) -> dict:
    return {("co:1", "A000001"): [("abcdef123456", [{"y": y, "n": 1, "low": v, "high": v, "exact": v} for y, v in years])]}


def test_money_same_cycle_boundary() -> None:
    t24 = tr("a", d=date(2024, 5, 1))
    assert F.rule_money(t24, inputs(pac((2023, 500.0)))) == {"edge": "abcdef123456"}   # 2023 is in the 2024 cycle
    assert F.rule_money(t24, inputs(pac((2022, 500.0)))) is F.NOT_MET
    assert F.rule_money(tr("b", d=date(2025, 1, 2)), inputs(pac((2024, 500.0)))) is F.NOT_MET   # 2025 -> 2026 cycle
    assert F.rule_money(tr("b", d=date(2025, 1, 2)), inputs(pac((2026, 500.0)))) == {"edge": "abcdef123456"}
    assert F.rule_money(t24, inputs(pac((2024, -500.0)))) is F.NOT_MET                 # a refund is not money received


def test_money_not_evaluated_without_a_company_date_or_fec_id() -> None:
    i = inputs(pac((2024, 1.0)))
    assert F.rule_money(tr("a", org="tk:ZZ"), i) is None
    assert F.rule_money(tr("a", d=None), i) is None
    assert F.rule_money(tr("a", "B000002"), i) is None
    assert F.rule_money(tr("a", org="co:2"), i) is F.NOT_MET


# ---------------------------------------------------------------- sector_overseen
def test_sector_full_committee_current_congress_only() -> None:
    i = inputs()
    assert F.rule_sector(tr("a", d=date(2025, 1, 3)), i) == {"committee": "cmte:HSBA"}
    assert F.rule_sector(tr("a", d=date(2025, 1, 2)), i) is None
    assert F.rule_sector(tr("a", "B000002"), i) is F.NOT_MET           # Agriculture does not cover banking
    assert F.rule_sector(tr("a", "C000003"), i) is None                # former member
    assert F.rule_sector(tr("a", "D000004"), i) is None                # subcommittee only: no full assignment
    assert F.rule_sector(tr("a", org="co:2"), i) is None               # no SIC sector
    assert F.rule_sector(tr("a", org="tk:ZZ"), i) is None
    assert F.rule_sector(tr("a", cls="fund"), i) is None                # a fund's SIC code is not its industry
    pooled = F.Inputs(MEMBERS, ORGS, {"co:1": {"sic": 6022, "pooled_vehicle": True}}, {}, {"HSBA"}, {"HSBA": (("60",), ())})
    assert F.rule_sector(tr("a"), pooled) is None


def test_sic_prefixes_of_2_to_4_digits_with_carve_outs() -> None:
    assert F.sic_covered(2834, (("283",), ())) and not F.sic_covered(2800, (("283",), ()))
    assert F.sic_covered(6798, (("60", "6798"), ())) and not F.sic_covered(6799, (("60", "6798"), ()))
    assert F.sic_covered(4700, (("47",), ("4724",))) and not F.sic_covered(4724, (("47",), ("4724",)))
    assert F.sic_covered(100, (("01",), ())) and not F.sic_covered(2080, (("20",), ("208",)))   # 0100 crops; 2080 beverages
    assert sic_match(2086, ("20",), ("208",)) is False and sic_match(2011, ("20",), ("208",)) is True
    i = inputs(companies={"co:1": {"sic": 6798, "pooled_vehicle": False}})
    assert F.rule_sector(tr("a"), i) is F.NOT_MET                          # the test table maps 60 and 61 only


def test_committee_table_parses_and_rejects_bad_rows(tmp_path: Any) -> None:
    table = F.read_committee_sectors()
    assert "HSAS" not in table and table["HSBA"][0] == ("60", "61", "62", "63", "64")
    assert table["SSHR"] == (("283", "384", "80"), ()) and table["HSAG"][1] == ("208",)
    assert "28" not in table["HSIF"][0] and "65" not in table["SSBK"][0] and table["HSPW"][1] == ("4724",)
    head = "committee_id,committee_name,sic_prefixes,sic_excluded,basis\n"
    for row in ("HSBA,x,66,,rule", "HSBA,x,6,,rule", "HSBA,x,60123,,rule", "HSBA,x,60,,", "HSBA,x,,60,rule"):
        bad = tmp_path / "t.csv"
        bad.write_text(head + row + "\n")
        with pytest.raises(ValueError):
            F.read_committee_sectors(bad)


# ---------------------------------------------------------------- all rules, outputs and the validator
def build() -> tuple[list[dict[str, Any]], F.Review]:
    ts = [tr("a", "A000001", lag=60), tr("b", "B000002", D0 + timedelta(days=1)), tr("c", "C000003", lag=None),
          tr("d", "D000004", D0, available=date(2026, 11, 20))]
    return ts, F.compute(ts, inputs(pac((2024, 9.0), (2025, 1.0))))


def test_compute_counts_and_trade_fields() -> None:
    ts, rv = build()
    assert set(rv.flags["A000001"]["a"]) == {"late", "pile_on", "money_both_ways", "sector_overseen"}
    assert F.RULE_IDS == ("late", "large_amount", "pile_on", "money_both_ways", "sector_overseen")
    tf = rv.trade_fields("C000003")
    assert list(tf["flags_not_evaluated"]) == list(F.RULE_IDS) and tf["flags_not_evaluated"]["late"] == 1
    assert rv.trade_fields("Z") == {"flags": {}, "flags_not_evaluated": {r: 0 for r in F.RULE_IDS}}
    tot = rv.totals()
    assert all(v["evaluated"] + v["not_evaluated"] == 4 for v in tot.values())
    assert tot["large_amount"] == {"met": 0, "evaluated": 4, "not_evaluated": 0}
    assert flags_meta(rv)["rules"] == tot and flags_meta(rv)["trades_flagged"] == len(rv.trades)
    with pytest.raises(AssertionError):
        F.compute([{**ts[0], "deleted": True}], inputs())


def test_flags_file_selection_cap_and_validator(monkeypatch: Any) -> None:
    ts, rv = build()
    doc = flags_file(rv, date(2026, 11, 25), 2)
    assert doc["cols"] == FLAGS_COLS and [r["id"] for r in doc["rules"]] == list(F.RULE_IDS)
    ids = [r[1] for r in doc["rows"]]
    assert "a" in ids and doc["selection"]["truncated"] is False
    assert selection(1, date(2026, 10, 27), date(2026, 11, 25)) and not selection(1, date(2026, 10, 26), date(2026, 11, 25))
    files = {m: {**trade_file([t for t in ts if t["member"] == m]), **rv.trade_fields(m)} for m in MEMBERS}
    flagged = {(m, tid): sorted(d, key=F.RULE_IDS.index) for m in rv.flags for tid, d in rv.flags[m].items()}
    met = Counter(r for m in rv.flags for d in rv.flags[m].values() for r in d)
    ne = Counter({r: sum(rv.not_evaluated[m][r] for m in rv.not_evaluated) for r in F.RULE_IDS})
    errs: list[str] = []
    checker = type("C", (), {"check": lambda self, ok, rule, d: errs.append(rule) if not ok else None})()
    meta = {"flags": flags_meta(rv), "counts": {"trades": 4}}
    check_flags_file(checker, doc, meta, flagged, files, met, ne, 4)
    assert errs == []
    monkeypatch.setattr(K, "FLAGS_MAX_ROWS", 1)
    capped = flags_file(rv, date(2026, 11, 25), 2)
    assert capped["selection"]["truncated"] is True and len(capped["rows"]) == 1 and capped["rows"][0][1] == "a"
    check_flags_file(checker, {**doc, "rows": doc["rows"][1:]}, meta, flagged, files, met, ne, 4)
    assert "flags: flags.json selection counts" in errs


def test_validator_re_derives_late_large_and_pile_on() -> None:
    ts, rv = build()
    files = {m: {**trade_file([t for t in ts if t["member"] == m]), **rv.trade_fields(m)} for m in MEMBERS}
    rows = [dict(zip(trade_file(ts)["cols"], r)) for r in trade_file(ts)["rows"]]
    assert derive_late(rows) == ({"a": {"lag_days": 60}}, 1)
    assert derive_large(rows) == ({}, 0)
    met, ne, _ = derive_pile_on(files, {})
    assert met == {t: rv.flags[m][t]["pile_on"] for m in rv.flags for t in rv.flags[m] if "pile_on" in rv.flags[m][t]}
    assert sum(ne.values()) == 0
