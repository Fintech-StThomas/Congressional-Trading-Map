"""The reviewed single rows (pipeline/fec/reviewed_rows.py) and the reviewed allow-list
(pipeline/validate_fec_conduits.py), on the recorded rows of test_fec_conduits.py: no network."""
from __future__ import annotations

from pipeline import validate_fec_conduits as vc
from pipeline.fec import build, conduits, reviewed_rows
from pipeline.tests.test_fec_conduits import VALERO, by_giver, meta_for, run_check, setup

VALERO_ROW = "4121920171489126717"      # Valero Energy Corporation PAC to Ted Cruz for Senate, 2017-11-20, in pas2_18.txt


def test_lists_are_exact_row_ids_with_known_reasons_and_do_not_overlap() -> None:
    assert all(s.isdigit() and len(s) == 19 for s in reviewed_rows.ROWS) and all(s.isdigit() and len(s) == 19 for s in vc.ALLOWED_ROWS)
    assert not set(reviewed_rows.ROWS) & vc.ALLOWED_ROWS
    assert len(reviewed_rows.ROWS) == 38 and len(vc.ALLOWED_ROWS) == 13 and vc.ENFORCE_HARD
    for reason, giver, member, amount, date, payee in reviewed_rows.ROWS.values():
        assert reason in reviewed_rows.REASONS and len(giver) == 9 and giver[0] == "C" and len(member) == 7
        assert amount > conduits.HARD and len(date) == 10 and payee
    assert "C00341396" not in conduits.LISTED and "C00332296" not in conduits.LISTED     # rows, not whole cycles


def test_a_reviewed_row_is_dropped_under_its_own_rule_and_counted(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    kept = by_giver(con, "keep:pac_money")[VALERO]
    monkeypatch.setattr(reviewed_rows, "ROWS", {VALERO_ROW: ("other_committee", VALERO, "C001098", 10001, "2017-11-20", "X"),
                                                "1" * 19: ("voided", VALERO, "C001098", 10001, "2017-11-20", "X")})
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    (amt,) = con.execute("SELECT amt FROM p_rules WHERE rule = ?", [reviewed_rows.RULE]).fetchone()
    assert by_giver(con, reviewed_rows.RULE) == {VALERO: (1, float(amt))}
    assert by_giver(con, "keep:pac_money")[VALERO] == (kept[0] - 1, kept[1] - float(amt))
    ex = reviewed_rows.exclusions(con)[reviewed_rows.KEY]
    assert ex["rows"] == 1 and ex["dollars"] == float(amt) and ex["listed"] == 2 and ex["not_taken"] == ["1" * 19]
    assert ex["by_reason"]["other_committee"] == {"rows": 1, "dollars": float(amt)} and ex["by_reason"]["voided"]["rows"] == 0
    meta, rev = meta_for(con)
    assert not run_check(meta, rev).errors


def test_validator_checks_the_reviewed_count(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    meta, rev = meta_for(con)
    assert meta["exclusions"][reviewed_rows.KEY]["rows"] == 0 and not run_check(meta, rev).errors
    rule = "fec reviewed rows: exclusion is counted in meta.json"
    del meta["exclusions"][reviewed_rows.KEY]
    assert rule in run_check(meta, rev).errors
    meta, rev = meta_for(con)
    meta["exclusions"][reviewed_rows.KEY]["by_reason"]["voided"]["rows"] += 1
    meta["reports"]["fec"]["exclusions"] = meta["exclusions"]
    assert rule in run_check(meta, rev).errors
