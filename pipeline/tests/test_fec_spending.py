"""FEC spending and loans (pipeline/fec/spending*.py, validate_fec_spending.py): parsing the weball and oppexp layouts
from small recorded fixtures (tests/fixtures/fec_spending/, real rows; payee name, city, state, ZIP, purpose and memo
text blanked), the streaming filter, aggregation by category, null-not-zero, linkage by exact ids only, privacy of
the output and the validator's failure paths."""
from __future__ import annotations

import copy
import json
import zipfile
from pathlib import Path

import duckdb
import pytest

from pipeline.fec import download, load, refs, spending, spending_oppexp as oe
from pipeline.validate import Checker
from pipeline.validate_fec_spending import check_campaign_finance

FIX = Path(__file__).parent / "fixtures" / "fec_spending"
LPACS = {"C00409276", "C00706812", "C00692715"}


def oppexp_zip(tmp_path: Path, lines: list[str] | None = None) -> Path:
    text = "\n".join(lines) + "\n" if lines is not None else (FIX / "oppexp_sample.txt").read_text()
    path = tmp_path / "oppexp24.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("oppexp.txt", text)
    return path


def fixture_lines() -> list[str]:
    return (FIX / "oppexp_sample.txt").read_text().splitlines()


# --- oppexp parsing and the streaming filter ---------------------------------------------------
def test_fixture_lines_have_the_documented_layout():
    for line in fixture_lines():
        assert line.count("|") in (len(oe.COLUMNS) - 1, len(oe.COLUMNS))
        parts = line.split("|")
        assert parts[oe.IDX["SCHED_TP_CD"]] == "SB" and parts[oe.IDX["NAME"]] == "PAYEE REDACTED"
        assert parts[oe.IDX["CITY"]] == parts[oe.IDX["ZIP_CODE"]] == ""


def test_iter_rows_filters_by_committee_and_extracts_no_payee_field(tmp_path):
    st: dict = {}
    rows = list(oe.iter_rows(oppexp_zip(tmp_path), LPACS, st))
    assert st["lines"] == len(fixture_lines()) and st["matched"] == len(rows) == st["lines"] - 1   # C00999999 skipped
    assert {r["committee"] for r in rows} == LPACS
    allowed = {"committee", "memo", "amount", "category", "tran_id", "date", "file_num", "sub_id"}
    assert all(set(r) == allowed for r in rows)
    assert "PAYEE" not in json.dumps(rows) and "REDACTED" not in json.dumps(rows)
    first = rows[0]
    assert first["memo"] is True and first["amount"] == 210.0 and first["category"] == "001" and first["file_num"] == 1698327


def test_iter_rows_streams_lazily(tmp_path):
    st: dict = {}
    it = oe.iter_rows(oppexp_zip(tmp_path), LPACS, st)
    next(it)
    assert st["lines"] == 1          # one line read for the first hit; the rest of the file is untouched


def test_iter_rows_stops_on_a_changed_layout(tmp_path):
    with pytest.raises(oe.LayoutChanged):
        list(oe.iter_rows(oppexp_zip(tmp_path, ["C00409276|N|2024|only|four"]), LPACS))
    with pytest.raises(RuntimeError):
        z = tmp_path / "two.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("a.txt", "x")
            f.writestr("b.txt", "y")
        list(oe.iter_rows(z, LPACS))


# --- aggregation -------------------------------------------------------------------------------
def expected_totals(rows: list[dict]) -> dict[tuple[str, str | None], float]:
    """Independent re-computation of the spent sums: non-memo positive rows, the re-reported transaction once,
    unknown code -> None."""
    seen, out = {}, {}
    for r in rows:
        if r["memo"]:
            continue
        seen[(r["committee"], r["tran_id"], r["date"], r["amount"])] = r
    for r in seen.values():
        k = (r["committee"], r["category"] if r["category"] in oe.CATEGORY_LABELS else None)
        if r["amount"] > 0:
            out[k] = round(out.get(k, 0) + r["amount"], 2)
    return out


def test_aggregate_matches_an_independent_computation_and_reports_what_it_dropped(tmp_path):
    rows = list(oe.iter_rows(oppexp_zip(tmp_path), LPACS))
    rep: dict = {}
    agg = oe.aggregate(rows, rep)
    got = {(c, cat): v[0] for c, cats in agg.items() for cat, v in cats.items()}
    assert got == expected_totals(rows)
    assert rep["memo_dropped"] == sum(r["memo"] for r in rows) > 0
    assert rep["rereport_dropped"] == 1                               # the real AXCAPITAL transaction filed twice
    assert any(cat is None for cats in agg.values() for cat in cats)  # rows without a usable category
    assert "21B" not in {cat for cats in agg.values() for cat in cats}  # unrecognised code is not kept as a category


def test_rereport_counts_once_from_the_latest_filing_and_refunds_net():
    def row(amount, file_num, tran="T1", cat="001", memo=False, date="01/02/2024"):
        return {"committee": "C1", "memo": memo, "amount": amount, "category": cat, "tran_id": tran, "date": date,
                "file_num": file_num, "sub_id": f"{file_num}{tran}{amount}"}
    agg = oe.aggregate([row(100.0, 1), row(100.0, 2), row(-30.0, 3, tran="T2"), row(50.0, 4, tran="", date=""),
                        row(50.0, 5, tran="", date=""), row(9.0, 6, tran="T3", memo=True), row(None, 7, tran="T4")])
    assert agg["C1"]["001"] == [200.0, 3, 30.0, 1]       # spent 100 + 50 + 50, refunded 30, never netted


def test_refunds_can_exceed_spending_in_a_category_and_stay_non_negative():
    def row(amount, tran, cat):
        return {"committee": "C1", "memo": False, "amount": amount, "category": cat, "tran_id": tran, "date": "d",
                "file_num": 1, "sub_id": tran}
    agg = oe.aggregate([row(10.0, "A", "002"), row(-75.5, "B", "002"), row(-1.0, "C", "003"), row(0.0, "D", "003")])
    assert agg["C1"]["002"] == [10.0, 1, 75.5, 1] and agg["C1"]["003"] == [0.0, 0, 1.0, 1]
    pac = spending.pac_entry("C00000001", 2024, "T", "fec_candidate_id", agg["C1"])
    assert (pac["total"], pac["count"], pac["refunds"], pac["refund_count"]) == (10, 1, 76.5, 2)
    assert [(c["total"], c["refunds"]) for c in pac["categories"]] == [(10, 75.5), (0, 1)]
    c = Checker()
    check_campaign_finance(c, {"loans": [], "leadership_pac": [pac], "coverage": GOOD["coverage"]},
        "m", "M1", ["S8FL00273"], {"C00000001": {"member": "M1", "method": "fec_candidate_id"}})
    assert c.errors == {}


def test_category_labels_cover_the_official_codes():
    assert set(oe.CATEGORY_LABELS) == {f"{i:03d}" for i in range(1, 13)} | {f"{i}" for i in range(101, 108)}
    assert oe.category_code("") is None and oe.category_code("1") is None and oe.category_code("003") == "003"


# --- weball: loans -----------------------------------------------------------------------------
def weball_con(extra: list[list[str]] | None = None) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    load.ensure_tables(con)
    cols = load.COLUMNS["weball"].split(",")
    lines = [l.split("|") for l in (FIX / "weball_sample.txt").read_text().splitlines()] + (extra or [])
    for i, p in enumerate(lines):
        assert len(p) == len(cols) == 30        # the recorded rows have exactly the layout load.py declares
        con.execute(f"INSERT INTO weball VALUES (2024, {i + 1}, {', '.join('?' * len(cols))})", p)
    return con


def test_loan_rows_use_exact_candidate_ids_only_and_copy_figures_as_filed():
    con = weball_con()
    cand_to_bio = {"H6MD08549": "T000483", "S8FL00273": "S001217", "S2PA00661": "M001243", "S8NY00082": "S000148"}
    rep: dict = {}
    loans = spending.loan_rows(con, [2024], cand_to_bio, rep)
    assert set(loans) == {"T000483", "S001217", "M001243", "S000148"}        # Constant, Schrier: ids not linked -> absent
    trone = loans["T000483"][0]
    assert trone == {"cycle": 2024, "candidate_id": "H6MD08549", "office": "house", "candidate_loans": 62877800,
                     "other_loans": 0, "candidate_loan_repayments": 0, "other_loan_repayments": 0,
                     "debts_owed_by": 73680994, "through": "2024-12-31"}
    mc = loans["M001243"][0]
    assert mc["office"] == "senate" and mc["candidate_loans"] == 7563800 and mc["other_loans"] == 0
    assert mc["candidate_loan_repayments"] == 1800000 and mc["other_loan_repayments"] == 0   # CAND_LOAN_REPAY is column 15
    assert rep["loans"]["rows_of_members"] == 4 and rep["loans"]["weball_rows_read"] == 6


def test_a_name_that_matches_but_an_id_that_does_not_is_never_linked():
    con = weball_con()
    # "SCHUMER, CHARLES E." is in the file, but only the id decides
    assert spending.loan_rows(con, [2024], {"S8NY00099": "S000148"}, {}) == {}


def test_blank_is_null_never_zero_and_negative_is_not_published():
    blank = ["H8AA00001", "TEST, ONE", "C", "1", "DEM", "", "", "", "", "", "", "", "", "", "", "", "", "", "AA", "01",
             "", "", "", "", "", "", "", "", "", ""]
    neg = list(blank)
    neg[0], neg[12], neg[16], neg[27] = "H8AA00002", "-5.00", "-283.68", "12/31/2024"
    neg[13] = "0"
    con = weball_con([blank, neg])
    rep: dict = {}
    loans = spending.loan_rows(con, [2024], {"H8AA00001": "A", "H8AA00002": "B"}, rep)
    assert all(loans["A"][0][k] is None for k, _ in spending.LOAN_FIELDS) and loans["A"][0]["through"] is None
    b = loans["B"][0]
    assert b["candidate_loans"] is None and b["debts_owed_by"] is None and b["other_loans"] == 0   # 0 stays 0
    assert b["through"] == "2024-12-31"
    assert {(x["candidate_id"], x["field"]) for x in rep["loans"]["negative_figures_not_published"]} == {
        ("H8AA00002", "CAND_LOANS"), ("H8AA00002", "DEBTS_OWED_BY")}


# --- end to end ----------------------------------------------------------------------------------
def build_con() -> duckdb.DuckDBPyConnection:
    con = weball_con()
    con.execute("CREATE TEMP TABLE lpac (CMTE_ID VARCHAR PRIMARY KEY, bioguide VARCHAR, method VARCHAR)")
    con.execute("INSERT INTO lpac VALUES ('C00409276', 'S001217', 'fec_candidate_id'), "
                "('C00706812', 'M001243', 'leadership_file_exact_name'), ('C00692715', 'M001243', 'leadership_file_exact_name')")
    con.execute("CREATE TEMP TABLE cm_latest (CMTE_ID VARCHAR, CMTE_NM VARCHAR)")
    con.execute("INSERT INTO cm_latest VALUES ('C00409276', 'TEST PAC ONE'), ('C00706812', 'TEST PAC TWO'), "
                "('C00692715', 'TEST PAC THREE'), ('C00999999', 'NOT A LEADERSHIP PAC')")
    return con


@pytest.fixture
def built(tmp_path, monkeypatch):
    zpath = oppexp_zip(tmp_path)
    def fake_bulk_zip(name, cycle):
        if cycle < 2004:
            raise download.NotFound(f"{name}{cycle}")
        assert name == "oppexp"
        return zpath
    monkeypatch.setattr(download, "bulk_zip", fake_bulk_zip)
    members = refs.Members("test", {"S001217": {"fec_ids": ["S8FL00273"]}, "M001243": {"fec_ids": ["S2PA00661"]},
                                    "T000483": {"fec_ids": ["H6MD08549"]}, "X000001": {"fec_ids": []}})
    members.build_index()
    out = tmp_path / "build"
    audit: dict = {}
    sec = spending.run(build_con(), members, [2000, 2024], {}, audit, out)
    return json.loads((out / "campaign_finance.json").read_text()), sec, audit, out


def test_run_writes_blocks_links_coverage_and_audit(built):
    doc, sec, audit, out = built
    assert set(doc["members"]) == {"S001217", "M001243", "T000483"}          # X000001 and others: no entry -> null
    s = doc["members"]["S001217"]
    assert [p["committee_id"] for p in s["leadership_pac"]] == ["C00409276"]
    pac = s["leadership_pac"][0]
    assert pac["cycle"] == 2024 and pac["sponsor_link"] == "fec_candidate_id" and pac["committee_name"] == "TEST PAC ONE"
    assert pac["total"] == round(sum(c["total"] for c in pac["categories"]), 2) and pac["count"] == sum(c["count"] for c in pac["categories"])
    assert [c["category"] for c in pac["categories"]] == sorted(c["category"] for c in pac["categories"] if c["category"]) + (
        [None] if any(c["category"] is None for c in pac["categories"]) else [])
    assert doc["members"]["T000483"]["leadership_pac"] == []
    cov = doc["members"]["T000483"]["coverage"]
    assert cov.pop("purposes_source").startswith("OpenFEC")
    assert cov == {"loans_cycles": [2000, 2024], "leadership_pac_cycles": [2024], "purposes_cycles": [], "leadership_pac_note": spending.NOTE_NO_PAC}
    assert s["coverage"]["leadership_pac_note"] is None
    assert doc["links"]["C00409276"] == {"member": "S001217", "method": "fec_candidate_id"}
    assert sec["oppexp_coverage"]["2000"].startswith("not published") and sec["oppexp_coverage"]["2024"] == "loaded"
    assert audit["oppexp24"]["file"] == "oppexp" and audit["oppexp24"]["lines"] == len(fixture_lines())
    src = json.loads((out / "sources" / "fec_spending.json").read_text())
    assert "fec_spending" in src["sources"] and src["report"]["oppexp_by_cycle"]["2024"]["lines_read"] == len(fixture_lines())


def test_published_output_has_no_payee_or_address(built):
    doc, _, _, out = built
    text = (out / "campaign_finance.json").read_text() + json.dumps(json.loads((out / "sources" / "fec_spending.json").read_text())["report"])
    for needle in ("PAYEE", "REDACTED", "AXCAPITAL", "payee", "address", "zip", "street"):
        assert needle not in text
    c = Checker()
    for bio, block in doc["members"].items():
        check_campaign_finance(c, block, bio, bio, {"S001217": ["S8FL00273"], "M001243": ["S2PA00661"],
                                                    "T000483": ["H6MD08549"]}[bio], doc["links"])
    assert c.errors == {} and c.checks > 50


def test_a_layout_change_skips_the_cycle_and_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(download, "bulk_zip", lambda name, cycle: oppexp_zip(tmp_path, ["C00409276|N|2024|bad"]))
    rep, audit = {}, {}
    assert spending.spending_by_cycle({"C00409276": ("S001217", "fec_candidate_id")}, [2024], rep, audit) == {}
    assert rep["oppexp_coverage"]["2024"].startswith("skipped, layout changed") and audit == {}


def test_assembler_gives_null_when_there_is_no_entry_or_no_file(tmp_path, monkeypatch):
    from pipeline.assemble import finance
    monkeypatch.setattr(finance, "CAMPAIGN_FINANCE_FILE", tmp_path / "none.json")
    assert finance.load_campaign_finance({"A"}) == {}
    p = tmp_path / "cf.json"
    p.write_text(json.dumps({"members": {"A": {"loans": [1]}, "Z": {"loans": [2]}}}))
    monkeypatch.setattr(finance, "CAMPAIGN_FINANCE_FILE", p)
    assert finance.load_campaign_finance({"A", "B"}) == {"A": {"loans": [1]}}      # B: null; Z not in the spine


# --- validator failure paths ---------------------------------------------------------------------
GOOD = {
    "loans": [{"cycle": 2024, "candidate_id": "S8FL00273", "office": "senate", "candidate_loans": 100, "other_loans": None,
               "candidate_loan_repayments": 0, "other_loan_repayments": 0, "debts_owed_by": 5.5, "through": "2024-12-31"}],
    "leadership_pac": [{"committee_id": "C00409276", "committee_name": "TEST PAC", "cycle": 2024,
                        "sponsor_link": "fec_candidate_id", "total": 30.5, "count": 3, "refunds": 4, "refund_count": 2,
                        "categories": [{"category": "001", "label": "Administrative/salary/overhead expenses", "total": 20.5,
                                        "count": 2, "refunds": 4, "refund_count": 2},
                                       {"category": None, "label": spending.NO_CATEGORY, "total": 10, "count": 1,
                                        "refunds": 0, "refund_count": 0}], "purposes": None}],
    "coverage": {"loans_cycles": [2024], "leadership_pac_cycles": [2024], "purposes_cycles": [],
                 "purposes_source": "OpenFEC (not available in this build)", "leadership_pac_note": None},
}
LINKS = {"C00409276": {"member": "M1", "method": "fec_candidate_id"}}


def run_check(block, fec_ids=("S8FL00273",), links=LINKS, mid="M1") -> dict:
    c = Checker()
    check_campaign_finance(c, block, "members/M1", mid, list(fec_ids), links)
    return c.errors


def mutated(fn):
    b = copy.deepcopy(GOOD)
    fn(b)
    return b


@pytest.mark.parametrize("cid,ok", [("H8VA01233", True), ("S8FL00273", True), ("H6MD08549", True), ("P60003225", True),
                                    ("P20002978", True), ("P6000322", False), ("P6000322X", False), ("X8VA01233", False),
                                    ("H8VA0123", False), ("", False)])
def test_candidate_id_formats(cid, ok):
    block = mutated(lambda b: b["loans"][0].update(candidate_id=cid))
    errors = run_check(block, fec_ids=(cid,))
    assert (not any("schema" in k for k in errors)) is ok


def test_presidential_loan_rows_get_the_president_office():
    con = weball_con([["P60003225", "TEST, PRES", "C", "1", "REP", "0", "0", "0", "0", "0", "0", "0", "5", "0", "0", "0", "0", "0",
                       "US", "00", "", "", "", "", "", "0", "0", "12/31/2024", "0", "0"]])
    row = spending.loan_rows(con, [2024], {"P60003225": "P"}, {})["P"][0]
    assert row["office"] == "president" and row["candidate_loans"] == 5


def test_validator_accepts_a_good_block_and_null():
    assert run_check(GOOD) == {} and run_check(None) == {}
    assert run_check(None, fec_ids=()) == {}


@pytest.mark.parametrize("fn,rule", [
    (lambda b: b["loans"][0].update(candidate_loans=-1), "schema"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(total=21), "category sums equal"),
    (lambda b: b["leadership_pac"][0].update(count=4), "category sums equal"),
    (lambda b: b["leadership_pac"][0].update(refunds=3), "category sums equal"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(refund_count=1), "category sums equal"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(refunds=-1), "schema"),
    (lambda b: b["leadership_pac"][0].update(total=-30.5), "schema"),
    (lambda b: b["loans"][0].update(candidate_id="S8FL00999"), "candidate id is one of"),
    (lambda b: b["leadership_pac"][0].update(committee_id="C00000001"), "linked to this member"),
    (lambda b: b["leadership_pac"][0].update(sponsor_link="fec_candidate_id+leadership_file_exact_name"), "linked to this member"),
    (lambda b: b["loans"][0].update(cycle=2023), "schema"),
    (lambda b: b["loans"][0].update(office="governor"), "schema"),
    (lambda b: b["loans"][0].update(extra=1), "schema"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(category="999"), "schema"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(payee_name="X"), "no payee or address field"),
    (lambda b: b["leadership_pac"][0]["categories"][0].update(zip_code="20001"), "no payee or address field"),
    (lambda b: b["leadership_pac"][0].update(committee_name="PAC AT 1600 PENNSYLVANIA AVENUE"), "no street address text"),
    (lambda b: b["leadership_pac"][0].update(committee_name="PAC, P.O. BOX 12"), "no street address text"),
    (lambda b: b.update(leadership_pac=[]), "note when and only when"),
    (lambda b: b["coverage"].update(leadership_pac_note="x"), "note when and only when"),
    (lambda b: b.update(loans=[], leadership_pac=[]), "empty block"),
    (lambda b: b["loans"].append(copy.deepcopy(b["loans"][0])), "unique and ordered"),
    (lambda b: b["leadership_pac"][0]["categories"].append(copy.deepcopy(b["leadership_pac"][0]["categories"][0])), "one row per category"),
])
def test_validator_failure_paths(fn, rule):
    errors = run_check(mutated(fn))
    assert any(rule in k for k in errors), (rule, list(errors))


def test_validator_rejects_a_block_for_a_member_without_an_fec_id():
    assert any("only members with an FEC id" in k for k in run_check(GOOD, fec_ids=()))
