"""Campaign receipts per cycle (pipeline/fec/receipts.py, validate_fec_receipts.py): recorded real weball rows for
2024 (tests/fixtures/fec_spending/weball_receipts_sample.txt, no network), exact-id linkage, cents kept, blank is null
never zero, negative figures not published, cash on hand kept as filed, a breakdown larger than its total not published,
the same rows and order as the loans, the privacy of the output and the validator's failure paths."""
from __future__ import annotations

import copy
from pathlib import Path

import duckdb
import pytest

from pipeline.fec import load, receipts, spending
from pipeline.validate import Checker
from pipeline.validate_fec_receipts import check_receipts, real_date

FIX = Path(__file__).parent / "fixtures" / "fec_spending" / "weball_receipts_sample.txt"
IDS = {"H8CA05035": "P000197", "S2TX00312": "C001098", "S2KY00012": "M000355", "H2AR03143": "N1", "H4FL13218": "N2"}


def con_with(extra: list[list[str]] | None = None, cycle: int = 2024) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    load.ensure_tables(con)
    n = len(load.COLUMNS["weball"].split(","))
    rows = [l.split("|") for l in FIX.read_text().splitlines()] + (extra or [])
    for i, p in enumerate(rows):
        assert len(p) == n == 30
        con.execute(f"INSERT INTO weball VALUES ({cycle}, {i + 1}, {', '.join('?' * n)})", p)
    return con


def blank_row(cid: str, **cols: str) -> list[str]:
    names = load.COLUMNS["weball"].split(",")
    row = [""] * len(names)
    row[0], row[1] = cid, "TEST, ROW"
    for k, v in cols.items():
        row[names.index(k)] = v
    return row


def test_real_rows_are_copied_as_filed_to_the_cent():
    out = receipts.receipt_rows(con_with(), [2024], IDS, {})
    assert out["P000197"] == [{
        "cycle": 2024, "candidate_id": "H8CA05035", "office": "house", "total_receipts": 10223363.88,
        "from_individuals": 9554439.66, "from_other_committees": 251518.53, "from_party_committees": 130.94,
        "from_candidate": 0, "transfers_from_authorised": 403887.59, "total_disbursements": 11739026.18,
        "cash_on_hand": 2078066.46, "through": "2024-12-31"}]
    cruz = out["C001098"][0]
    assert cruz["office"] == "senate" and cruz["total_receipts"] == 74050030.94 and cruz["from_party_committees"] == 5500
    assert out["M000355"][0]["cash_on_hand"] == 8093464.4 and out["M000355"][0]["from_candidate"] == 0   # 0 stays 0


def test_same_rows_in_the_same_order_as_the_loans():
    con = con_with()
    loans = spending.loan_rows(con, [2024], IDS, {})
    rec = receipts.receipt_rows(con, [2024], IDS, {})
    assert set(loans) == set(rec)
    for bio in loans:
        assert [(r["cycle"], r["candidate_id"], r["office"], r["through"]) for r in loans[bio]] == \
               [(r["cycle"], r["candidate_id"], r["office"], r["through"]) for r in rec[bio]]


def test_only_exact_candidate_ids_are_linked_and_only_the_first_row_counts():
    con = con_with([blank_row("H8CA05035", TTL_RECEIPTS="1")])      # a second row for the same id and cycle
    rep: dict = {}
    out = receipts.receipt_rows(con, [2024], {"H8CA05035": "P000197", "H8CA05036": "X"}, rep)
    assert set(out) == {"P000197"} and len(out["P000197"]) == 1 and out["P000197"][0]["total_receipts"] == 10223363.88
    assert rep["receipts"]["rows_of_members"] == 1 and rep["receipts"]["members"] == 1


def test_presidential_ids_get_the_president_office():
    con = con_with([blank_row("P60003225", TTL_RECEIPTS="5", CVG_END_DT="12/31/2024")])
    row = receipts.receipt_rows(con, [2024], {"P60003225": "P"}, {})["P"][0]
    assert row["office"] == "president" and row["total_receipts"] == 5


def test_blank_is_null_never_zero():
    con = con_with([blank_row("H8AA00001")])
    row = receipts.receipt_rows(con, [2024], {"H8AA00001": "A"}, {})["A"][0]
    assert all(row[k] is None for k, _ in receipts.MONEY) and row["through"] is None


def test_negative_figures_are_not_published_but_cash_on_hand_is_as_filed():
    rep: dict = {}
    out = receipts.receipt_rows(con_with(), [2024], IDS, rep)
    h = out["N1"][0]                                   # real row: total receipts -63.80
    assert h["total_receipts"] is None and h["through"] == "2024-03-31"
    assert {(x["candidate_id"], x["field"]) for x in rep["receipts"]["negative_figures_not_published"]} == {("H2AR03143", "TTL_RECEIPTS")}
    neg_cash = receipts.receipt_rows(con_with([blank_row("H8AA00002", TTL_RECEIPTS="100", COH_COP="-4.25")]), [2024],
                                     {"H8AA00002": "B"}, {})["B"][0]
    assert neg_cash["cash_on_hand"] == -4.25


def test_a_breakdown_larger_than_its_total_is_not_published_and_is_listed():
    rep: dict = {}
    row = receipts.receipt_rows(con_with(), [2024], IDS, rep)["N2"][0]       # real row: individuals 4,274 > total 2,993.24
    assert row["total_receipts"] == 2993.24 and row["total_disbursements"] == 4033.53 and row["cash_on_hand"] == 7.81
    assert all(row[k] is None for k in receipts.COMPONENTS)
    (item,) = rep["receipts"]["components_exceed_total_not_published"]
    assert item["candidate_id"] == "H4FL13218" and item["exceeding"] == {"from_individuals": 4274}
    # within the $1 rounding allowance the figures stay
    ok = receipts.receipt_rows(con_with([blank_row("H8AA00003", TTL_RECEIPTS="100", TTL_INDIV_CONTRIB="100.8")]), [2024],
                               {"H8AA00003": "C"}, {})["C"][0]
    assert ok["from_individuals"] == 100.8


def test_only_summary_columns_are_read_and_no_name_leaves_the_pipeline():
    assert {c for _, c in receipts.MONEY} <= set(load.COLUMNS["weball"].split(",")) and "indiv" not in load.FILES
    row = receipts.receipt_rows(con_with(), [2024], IDS, {})["P000197"][0]
    assert "PELOSI" not in str(row) and set(row) == {"cycle", "candidate_id", "office", "through"} | {k for k, _ in receipts.MONEY}


# --- validator -------------------------------------------------------------------------------------
LOAN = {"cycle": 2024, "candidate_id": "S2TX00312", "office": "senate"}
ROW = {**LOAN, "total_receipts": 1000, "from_individuals": 600, "from_other_committees": 200, "from_party_committees": None,
       "from_candidate": 0, "transfers_from_authorised": 50.25, "total_disbursements": 900, "cash_on_hand": -12.5,
       "through": "2024-12-31"}


def errors_for(rows, loans=None, ids=("S2TX00312",)) -> dict:
    c = Checker()
    check_receipts(c, rows, [LOAN] if loans is None else loans, "m", set(ids))
    return c.errors


def test_validator_accepts_a_good_row_nulls_and_negative_cash():
    assert errors_for([ROW]) == {}
    assert errors_for([{**ROW, **{k: None for k, _ in receipts.MONEY}, "through": None}]) == {}
    assert errors_for([{**ROW, "from_individuals": 1000.5}]) == {}          # within the $1 allowance


@pytest.mark.parametrize("mut,rule", [
    ({"total_receipts": -1}, "non-negative"), ({"from_candidate": -0.01}, "non-negative"), ({"total_disbursements": "5"}, "non-negative"),
    ({"from_individuals": 1002}, "never exceeds the total"), ({"transfers_from_authorised": 1001.5}, "never exceeds the total"),
    ({"through": "2024-02-30"}, "calendar date"), ({"through": "12/31/2024"}, "calendar date"), ({"through": 20241231}, "calendar date"),
    ({"candidate_id": "S2TX00999"}, "FEC ids"), ({"office": "house"}, "office agrees"), ({"cycle": 2023}, "schema"),
    ({"extra": 1}, "schema"),
])
def test_validator_failure_paths(mut, rule):
    assert any(rule in k for k in errors_for([{**ROW, **mut}], loans=[{**LOAN, **{k: v for k, v in mut.items() if k in LOAN}}])), mut


def test_validator_rows_must_match_loans_and_be_unique_and_ordered():
    assert any("same (cycle, candidate id)" in k for k in errors_for([ROW], loans=[]))
    assert any("unique and ordered" in k for k in errors_for([ROW, copy.deepcopy(ROW)], loans=[LOAN, LOAN]))
    assert any("schema" in k for k in errors_for("nope"))


def test_real_date():
    assert real_date("2024-12-31") and real_date(None) and not real_date("2023-02-29") and not real_date("2024-1-1")
