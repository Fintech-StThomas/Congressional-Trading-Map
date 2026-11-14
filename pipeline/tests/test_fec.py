"""FEC rules on a tiny in-memory database (pipeline/fec/build.py): every pas2 row gets one rule, re-reports of the
same transaction count once (latest filing kept), memo items and conduit earmarks are dropped, refunds net, money
between a member's own committees is not a tie, by_year follows the transaction date. Cycle 2008 is used so the
leadership-PAC file (2010 onward) is not downloaded."""
from __future__ import annotations

import duckdb

from pipeline.fec import build, load, refs

A, B = "A000001", "B000001"
PAS2 = load.COLUMNS["pas2"].split(",")


def insert(con: duckdb.DuckDBPyConnection, table: str, rows: list[dict]) -> None:
    cols = load.COLUMNS[table].split(",")
    for i, r in enumerate(rows):
        con.execute(f"INSERT INTO {table} VALUES ({', '.join('?' * (len(cols) + 2))})", [2008, i + 1, *[r.get(c) for c in cols]])


def pas2(sub: int, giver: str, to: str | None, amt: str, dt: str, tran: str, file_num: str = "100", memo: str | None = None,
         tp: str = "24K", cand: str | None = None) -> dict:
    return {"CMTE_ID": giver, "OTHER_ID": to, "CAND_ID": cand, "TRANSACTION_TP": tp, "TRANSACTION_AMT": amt,
            "TRANSACTION_DT": dt, "TRAN_ID": tran, "FILE_NUM": file_num, "MEMO_CD": memo, "SUB_ID": str(sub),
            "IMAGE_NUM": f"2008030190000{sub:05d}", "NAME": "RECIPIENT COMMITTEE", "AMNDT_IND": "N"}


def setup() -> tuple[duckdb.DuckDBPyConnection, refs.Members]:
    con = duckdb.connect()
    load.ensure_tables(con)
    insert(con, "cn", [{"CAND_ID": "H8AA00001", "CAND_NAME": "SMITH, ANN"}, {"CAND_ID": "H8BB00002", "CAND_NAME": "JONES, BO"}])
    insert(con, "ccl", [{"CAND_ID": "H8AA00001", "CMTE_ID": "C00000001", "CMTE_DSGN": "P", "CMTE_TP": "H"},
                        {"CAND_ID": "H8BB00002", "CMTE_ID": "C00000002", "CMTE_DSGN": "P", "CMTE_TP": "H"}])
    insert(con, "cm", [{"CMTE_ID": "C00000001", "CMTE_NM": "SMITH FOR CONGRESS", "CMTE_TP": "H", "CMTE_DSGN": "P", "CAND_ID": "H8AA00001"},
                       {"CMTE_ID": "C00000002", "CMTE_NM": "JONES FOR CONGRESS", "CMTE_TP": "H", "CMTE_DSGN": "P", "CAND_ID": "H8BB00002"},
                       {"CMTE_ID": "C00000010", "CMTE_NM": "ACME CORP PAC", "CMTE_TP": "Q", "CMTE_DSGN": "B", "CONNECTED_ORG_NM": "ACME CORP"},
                       {"CMTE_ID": "C00694323", "CMTE_NM": "WINRED", "CMTE_TP": "V", "CMTE_DSGN": "U"}])
    insert(con, "pas2", [
        pas2(1, "C00000010", "C00000001", "1000", "03012008", "T1", file_num="100"),
        pas2(2, "C00000010", "C00000001", "1000", "03012008", "T1", file_num="200"),   # re-report in a later filing
        pas2(3, "C00000010", "C00000001", "-300", "04012008", "T3"),                   # refund: nets
        pas2(4, "C00000010", "C00000001", "500", "04022008", "T4", memo="X"),          # memo item: already reported
        pas2(5, "C00694323", "C00000001", "50", "04032008", "T5"),                     # conduit earmark
        pas2(6, "C00000002", "C00000001", "2000", "05012008", "T6"),                   # member B's campaign -> A: funds
        pas2(7, "C00000001", "C00000001", "900", "05022008", "T7"),                    # own committee
        pas2(8, "C00000010", "C00000001", "700", "01052009", "T8"),                    # dated in 2009: by_year 2009
        pas2(9, "C00000010", None, "100", "06012008", "T9", tp="24C", cand="H8AA00001"),  # coordinated: out of scope
    ])
    members = refs.Members("test", {A: {"name": "Ann Smith", "current": True, "fec_ids": ["H8AA00001"]},
                                    B: {"name": "Bo Jones", "current": True, "fec_ids": ["H8BB00002"]}})
    members.build_index()
    report: dict = {}
    build.prepare_reference_tables(con, members, [2008], report)
    build.classify_rows(con, [2008], "2026-11-14")
    return con, members


def test_every_row_gets_exactly_one_rule() -> None:
    con, _ = setup()
    rules = dict(con.execute("SELECT SUB_ID, rule FROM p_rules ORDER BY 1").fetchall())
    assert rules == {"1": "drop:duplicate_rereport", "2": "keep:pac_money", "3": "keep:pac_money", "4": "drop:memo_item",
                     "5": "drop:earmarked_via_conduit", "6": "keep:funds", "7": "drop:own_committee_transfer",
                     "8": "keep:pac_money", "9": "drop:type_out_of_scope:24C"}


def test_edges_net_refunds_and_split_by_transaction_year() -> None:
    con, members = setup()
    build.resolve_orgs(con, refs.Companies("t", {"ACME": "co:1"}, {}), refs.Overrides({}, {}, 0, 0), {})
    build.edge_inputs(con)
    names = {b: m["name"] for b, m in members.info.items()}
    (pac,) = list(build.aggregate(con, names, "pac_money", {}))
    assert pac["from"] == {"kind": "org", "id": "co:1"} and pac["via"]["id"] == "pac:C00000010" and pac["to"]["id"] == A
    assert pac["amount"] == {"low": 1400, "high": 1400, "exact": 1400} and pac["count"] == 3
    assert [(y["y"], y["n"], y["exact"]) for y in pac["by_year"]] == [(2008, 2, 700), (2009, 1, 700)]
    assert all(ev["record"] != "T3" for ev in pac["evidence"])          # evidence lists positive rows only
    assert pac["first"] == "2008-03-01" and pac["last"] == "2009-01-05"
    (funds,) = list(build.aggregate(con, names, "funds", {}))
    assert funds["from"] == {"kind": "member", "id": B} and funds["amount"]["exact"] == 2000


def test_nonpositive_net_is_dropped_and_counted() -> None:
    con, members = setup()
    con.execute("UPDATE p_rules SET amt = -5000 WHERE SUB_ID = '3'")
    build.resolve_orgs(con, refs.Companies("t", {}, {}), refs.Overrides({}, {}, 0, 0), {})
    build.edge_inputs(con)
    stats: dict = {}
    assert list(build.aggregate(con, {A: "Ann Smith"}, "pac_money", stats)) == []
    assert stats["edges_dropped_nonpositive_net"]["pac_money"]["count"] == 1


def test_column_guard_counts_delimiters(tmp_path) -> None:
    p = tmp_path / "x.txt"
    p.write_bytes(b"a|b|c\nd|e|f\n")
    assert load._count_lines_and_encoding(p)[:2] == (2, 4)


def test_outside_spending_labels_name_only_organisation_payees() -> None:
    from datetime import date as _date
    from pipeline.util import public_payee
    # FEC entity type for an individual or candidate always drops; otherwise an organisational marker is required
    assert public_payee("ACME MEDIA LLC", "IND") is None and public_payee("SMITH, JOHN", "CAN") is None
    assert public_payee("SMITH, JOHN", "ORG") is None and public_payee("JANE DOE", None) is None
    assert public_payee("Strategic Media Placement, Inc.", "ORG") == "Strategic Media Placement, Inc."
    for org in ("MAIL.COM", "USPS", "BLUE STATE DIGITAL", "L.L.C. HOLDINGS", "MAJORITY STRATEGIES", "SMITH & CO"):
        assert public_payee(org, None) == org, org
    assert public_payee("", "ORG") is None and public_payee(None, None) is None
    r = {"type": "outside_spending", "to_id": "A000001", "direction": "oppose", "tp": "24A", "amt": 1000, "dt": _date(2020, 1, 2),
         "giver_name": "X PAC", "counterparty": "JOHN Q CONSULTANT", "counterparty_tp": "IND"}
    assert "paid to" not in build._evidence_label(r, {"A000001": "Ann Member"})
    r |= {"counterparty": "ADS GROUP LLC", "counterparty_tp": "ORG"}
    assert build._evidence_label(r, {"A000001": "Ann Member"}).endswith("(paid to ADS GROUP LLC)")
