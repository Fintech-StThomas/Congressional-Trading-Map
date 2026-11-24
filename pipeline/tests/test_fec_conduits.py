"""The conduit rule (pipeline/fec/conduits.py), its cross-check (crosscheck.py) and its validator
(pipeline/validate_fec_conduits.py) on recorded pas2 rows: no network.

Fixtures (pipeline/tests/fixtures/fec_conduits/, rows exactly as filed in the FEC bulk files pas218 and pas220):
- pas2_18.txt: every row to Ted Cruz for Senate (C00492785) from Senate Conservatives Fund and NORPAC, six of the 103
  rows from RJC PAC (the two of $5,000, the two largest and the two smallest of the rest), and two rows from an ordinary PAC;
- pas2_20.txt: House Freedom Fund rows to Jim Jordan for Congress (C00416594): six non-memo rows, three of its memo
  rows, and one row from an ordinary PAC.
Committee master, linkage and weball rows are written here by hand with the real ids.
"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from pipeline import validate_fec_conduits as vc
from pipeline.fec import build, conduits, crosscheck, download, load, refs
from pipeline.validate import Checker

FIX = Path(__file__).parent / "fixtures" / "fec_conduits"
CRUZ, JORDAN = "C001098", "J000289"
SCF, HFF, NORPAC, RJC, VALERO = "C00448696", "C00552851", "C00247403", "C00345132", "C00109546"


def insert(con: duckdb.DuckDBPyConnection, table: str, cycle: int, rows: list[dict]) -> None:
    cols = load.COLUMNS[table].split(",")
    for i, r in enumerate(rows):
        con.execute(f"INSERT INTO {table} VALUES ({', '.join('?' * (len(cols) + 2))})", [cycle, i + 1, *[r.get(c) for c in cols]])


def setup(monkeypatch: pytest.MonkeyPatch) -> tuple[duckdb.DuckDBPyConnection, refs.Members]:
    def no_file(cycle: int):
        raise download.NotFound(str(cycle))
    monkeypatch.setattr(download, "leadership_csv", no_file)          # the leadership-PAC file is not needed here
    con = duckdb.connect()
    load.ensure_tables(con)
    cols = load.COLUMNS["pas2"].split(",")
    for cycle in (2018, 2020):
        lines = (FIX / f"pas2_{cycle % 100}.txt").read_text().splitlines()
        insert(con, "pas2", cycle, [dict(zip(cols, (v or None for v in ln.split("|")))) for ln in lines])
        insert(con, "cn", cycle, [{"CAND_ID": "S2TX00312", "CAND_NAME": "CRUZ, RAFAEL EDWARD TED"},
                                  {"CAND_ID": "H6OH04082", "CAND_NAME": "JORDAN, JAMES D."}])
        insert(con, "ccl", cycle, [{"CAND_ID": "S2TX00312", "CMTE_ID": "C00492785", "CMTE_DSGN": "P", "CMTE_TP": "S"},
                                   {"CAND_ID": "H6OH04082", "CMTE_ID": "C00416594", "CMTE_DSGN": "P", "CMTE_TP": "H"}])
        insert(con, "cm", cycle, [
            {"CMTE_ID": "C00492785", "CMTE_NM": "TED CRUZ FOR SENATE", "CMTE_TP": "S", "CMTE_DSGN": "P", "CAND_ID": "S2TX00312"},
            {"CMTE_ID": "C00416594", "CMTE_NM": "JIM JORDAN FOR CONGRESS", "CMTE_TP": "H", "CMTE_DSGN": "P", "CAND_ID": "H6OH04082"},
            {"CMTE_ID": SCF, "CMTE_NM": "SENATE CONSERVATIVES FUND", "CMTE_TP": "Q", "CMTE_DSGN": "U"},
            {"CMTE_ID": HFF, "CMTE_NM": "HOUSE FREEDOM FUND", "CMTE_TP": "Q", "CMTE_DSGN": "D"},
            {"CMTE_ID": NORPAC, "CMTE_NM": "NORPAC", "CMTE_TP": "Q", "CMTE_DSGN": "U"},
            {"CMTE_ID": RJC, "CMTE_NM": "REPUBLICAN JEWISH COALITION-POLITICAL ACTION COMMITTEE (RJC-PAC)", "CMTE_TP": "Q", "CMTE_DSGN": "B"},
            {"CMTE_ID": VALERO, "CMTE_NM": "VALERO ENERGY CORPORATION POLITICAL ACTION COMMITTEE", "CMTE_TP": "Q", "CMTE_DSGN": "B",
             "CONNECTED_ORG_NM": "VALERO ENERGY CORPORATION"}])
    # weball: the recipient's own summary (line 11c, party, refunds to committees), real figures for the two cycles
    insert(con, "weball", 2018, [{"CAND_ID": "S2TX00312", "OTHER_POL_CMTE_CONTRIB": "1281824.21", "POL_PTY_CONTRIB": "100",
                                  "CMTE_REFUNDS": "6000"}])
    insert(con, "weball", 2020, [{"CAND_ID": "H6OH04082", "OTHER_POL_CMTE_CONTRIB": "142548", "POL_PTY_CONTRIB": "0",
                                  "CMTE_REFUNDS": "3500"}])
    members = refs.Members("test", {CRUZ: {"name": "Ted Cruz", "current": True, "fec_ids": ["S2TX00312"]},
                                    JORDAN: {"name": "Jim Jordan", "current": True, "fec_ids": ["H6OH04082"]}})
    members.build_index()
    build.prepare_reference_tables(con, members, [2018, 2020], {})
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    return con, members


def by_giver(con, rule: str) -> dict[str, tuple[int, float]]:
    return {c: (n, float(s)) for c, n, s in con.execute(
        "SELECT CMTE_ID, count(*), sum(amt) FROM p_rules WHERE rule = ? GROUP BY 1", [rule]).fetchall()}


def test_lists_are_exact_ids_and_do_not_overlap() -> None:
    ids = list(conduits.LISTED) + list(conduits.FORWARDERS)
    assert all(len(i) == 9 and i[0] == "C" and i[1:].isdigit() for i in ids) and len(set(ids)) == len(ids)
    assert {SCF, HFF, NORPAC, RJC} <= set(conduits.LISTED)
    assert set(conduits.FORWARDERS) == {"C00694323", "C00401224", "C00468314"}       # unchanged behaviour


def test_listed_conduit_rows_are_dropped_under_their_own_rule(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    dropped = by_giver(con, conduits.RULE)
    # Cruz 2018: SCF $75,778 in 4 rows (one of $36,039, one of $29,739), NORPAC $23,400 net in 5, the 6 recorded RJC rows
    assert dropped[SCF] == (4, 75778.0) and dropped[NORPAC] == (5, 23400.0) and dropped[RJC] == (6, 14784.0)
    assert dropped[HFF] == (6, 17750.0)                                # Jordan 2020, non-memo rows
    assert by_giver(con, "drop:memo_item") == {HFF: (3, 55.0)}         # memo rows keep their earlier label
    assert by_giver(con, "keep:pac_money") == {VALERO: (3, 7500.0)}    # an ordinary PAC is untouched
    assert con.execute("SELECT count(*) FROM p_rules").fetchone()[0] == 27 == sum(n for n, _ in dropped.values()) + 6


def test_only_the_listed_cycle_files_of_a_committee_are_dropped(monkeypatch) -> None:
    assert conduits.LISTED[RJC][1] == (2018, 2020) and conduits.is_listed(RJC, 2018) and not conduits.is_listed(RJC, 2022)
    assert not conduits.is_listed(HFF, 2018) and conduits.is_listed(HFF, 2020) and not conduits.is_listed(SCF, 2022)
    assert not conduits.is_listed(VALERO, 2018) and not conduits.is_listed(RJC, None)
    con, _ = setup(monkeypatch)
    monkeypatch.setitem(conduits.LISTED, HFF, ("HOUSE FREEDOM FUND", (2016, 2022)))    # as if 2020 were an ordinary cycle
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    assert HFF not in by_giver(con, conduits.RULE) and by_giver(con, "keep:pac_money")[HFF] == (6, 17750.0)
    assert by_giver(con, conduits.RULE)[SCF] == (4, 75778.0)


def test_in_kind_rows_of_a_listed_conduit_and_earmark_memos_keep_their_rules(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    con.execute("UPDATE pas2 SET TRANSACTION_TP = '24Z' WHERE CMTE_ID = ? AND TRANSACTION_AMT = '5195'", [HFF])
    con.execute("UPDATE pas2 SET MEMO_TEXT = 'EARMARKED CONTRIBUTION' WHERE CMTE_ID = ? AND TRANSACTION_AMT = '8400'", [NORPAC])
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    assert by_giver(con, "keep:pac_money")[HFF] == (1, 5195.0)          # only 24K rows are covered by the list
    assert by_giver(con, "drop:earmarked_via_conduit") == {NORPAC: (1, 8400.0)}


def test_edges_and_exclusion_counts(monkeypatch) -> None:
    con, members = setup(monkeypatch)
    build.resolve_orgs(con, refs.Companies("t", {}, {}), refs.Overrides({}, {}, 0, 0), {})
    build.edge_inputs(con)
    edges = list(build.aggregate(con, {b: m["name"] for b, m in members.info.items()}, "pac_money", {}))
    assert sorted((e["from"]["id"], e["to"]["id"], e["amount"]["exact"]) for e in edges) == [
        (f"pac:{VALERO}", CRUZ, 5000), (f"pac:{VALERO}", JORDAN, 2500)]
    ex = conduits.exclusions(con)[conduits.KEY]
    assert (ex["rows"], ex["dollars"]) == (21, 131712.0) == (ex["all_recipients"]["rows"], ex["all_recipients"]["dollars"])
    assert ex["by_cycle"] == {"2018": {"rows": 15, "dollars": 113962.0}, "2020": {"rows": 6, "dollars": 17750.0}}
    assert [c["committee"] for c in ex["committees"]] == sorted(conduits.LISTED) and ex["giver_member_pairs"] == 4
    assert {c["committee"]: c["rows"] for c in ex["committees"] if c["rows"]} == {SCF: 4, NORPAC: 5, RJC: 6, HFF: 6}
    assert "earmarked by individuals" in ex["reason"] and "own direct gifts" in ex["reason"]


def test_review_lists_kept_rows_that_look_forwarded(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    rev = conduits.review(con)
    assert rev["rows_over_limit"]["count"] == rev["rows_over_hard"]["count"] == rev["sums_over_limit"]["count"] == 0
    # Without the list (as before this rule) the same rows are kept and show up in the review.
    monkeypatch.setattr(conduits, "LISTED", {})
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    rev = conduits.review(con)
    over = rev["rows_over_limit"]
    assert over["count"] == 5 and over["givers"] == 3 and over["dollars"] == 92373.0
    assert [(r["committee"], r["to"], r["amount"], r["date"]) for r in rev["rows_over_hard"]["rows"]] == [
        (SCF, CRUZ, 36039.0, "2018-10-10"), (SCF, CRUZ, 29739.0, "2018-10-17"), (NORPAC, CRUZ, 13000.0, "2018-10-12")]
    assert all(r["sub_id"] and r["type"] == "24K" and r["url"].startswith("https://docquery.fec.gov/") for r in over["rows"])
    sums = {(s["committee"], s["to"], s["election"]): s["dollars"] for s in rev["sums_over_limit"]["sums"]}
    assert sums[(SCF, CRUZ, "G2018")] == 70778.0 and sums[(NORPAC, CRUZ, "P")] == 23400.0
    assert sums[(RJC, CRUZ, "G2018")] == 9784.0 and sums[(HFF, JORDAN, "P2020")] == 10330.0
    assert (VALERO, CRUZ, "P2018") not in sums


def test_crosscheck_compares_like_with_like(monkeypatch) -> None:
    con, members = setup(monkeypatch)
    (cruz,) = crosscheck.rows_for(con, CRUZ, "Ted Cruz", ["S2TX00312"])
    assert cruz["cycle"] == 2018 and cruz["recipient_line_11c"] == 1281824.21 and cruz["ours_positive"] == 5000.0
    assert cruz["listed_conduits_left_out"] == 114062.0                  # positive rows only: the -$100 row is not netted
    assert cruz["ours_negative"] == 0.0 and cruz["recipient_refunds_to_committees"] == 6000.0
    assert cruz["residual"] == round(5000 - 1281824.21, 2) and cruz["residual_label"] == "giver-reported minus recipient line 11c"
    (jordan,) = crosscheck.rows_for(con, JORDAN, "Jim Jordan", ["H6OH04082"])
    assert jordan["ours_positive"] == 2500.0 and jordan["listed_conduits_left_out"] == 17750.0
    assert jordan["ours_positive_dated_december_even_year"] == 0.0
    # a positive row dated in December of the even year is shown as timing; a negative row is kept apart, not netted
    con.execute("UPDATE p_rules SET dt = DATE '2020-12-15' WHERE CMTE_ID = ? AND cycle = 2020", [VALERO])
    con.execute("UPDATE p_rules SET amt = -1000 WHERE CMTE_ID = ? AND amt = 1000", [VALERO])
    (jordan,) = crosscheck.rows_for(con, JORDAN, "Jim Jordan", ["H6OH04082"])
    assert jordan["ours_positive_dated_december_even_year"] == 2500.0 == jordan["ours_positive"]
    (cruz,) = crosscheck.rows_for(con, CRUZ, "Ted Cruz", ["S2TX00312"])
    assert (cruz["ours_positive"], cruz["ours_negative"]) == (4000.0, -1000.0)
    report: dict = {}
    crosscheck.run(con, members.info, report, lambda *a: None)
    assert [(r["member"], r["cycle"]) for r in report["weball_check"]] == [(JORDAN, 2020), (CRUZ, 2018)]


def meta_for(con) -> tuple[dict, dict]:
    """(meta.json as assembled: counts only; the full review as written to pipeline/build/)."""
    ex, rev = conduits.exclusions(con), conduits.review(con)
    return {"exclusions": {"non_member_trade_rows": {"rows": 1, "reason": "x"}, **ex},
            "reports": {"fec": {"exclusions": ex, "conduit_review": conduits.counts_only(rev)}}}, rev


def run_check(meta: dict, rev: dict | None, **kw) -> Checker:
    c = Checker()
    vc.check_conduits(c, meta, rev, **kw)
    return c


def test_report_writes_counts_to_the_report_and_lists_to_a_build_file(monkeypatch, tmp_path) -> None:
    con, _ = setup(monkeypatch)
    con.execute("UPDATE p_rules SET amt = 25000 WHERE CMTE_ID = ? AND amt = 4000", [VALERO])
    report: dict = {}
    conduits.report_all(con, report, tmp_path)
    counts = report["conduit_review"]
    assert counts["rows_over_hard"] == {"count": 1, "dollars": 25000.0} and "rows" not in counts["rows_over_limit"]
    assert not any(isinstance(v, list) for part in counts.values() if isinstance(part, dict) for v in part.values())
    meta = {"exclusions": report["exclusions"], "reports": {"fec": report}}
    c = Checker()
    vc.check_conduits(c, meta, review_path=tmp_path / conduits.REVIEW_FILE)     # reads the lists from the build file
    assert not c.errors
    c = Checker()
    vc.check_conduits(c, meta, review_path=tmp_path / "absent.json")
    assert list(c.errors) == ["fec conduits: review of kept rows is present"]


def test_validator_passes_reports_and_can_enforce(monkeypatch, capsys) -> None:
    con, _ = setup(monkeypatch)
    c = run_check({"reports": {}, "exclusions": {}}, None)              # a build without the FEC stage: nothing to check
    assert c.checks == 0
    assert not run_check(*meta_for(con)).errors and "0 single rows above $10,000" in capsys.readouterr().out

    # A kept in-kind (24Z) row of a listed conduit in a listed cycle is expected and must not fail the build.
    con.execute("UPDATE pas2 SET TRANSACTION_TP = '24Z' WHERE CMTE_ID = ? AND TRANSACTION_AMT = '5195'", [HFF])
    build.classify_rows(con, [2018, 2020], "2026-11-24")
    meta, rev = meta_for(con)
    assert [(r["committee"], r["type"], r["amount"]) for r in rev["rows_over_limit"]["rows"]] == [(HFF, "24Z", 5195.0)]
    assert rev["sums_over_limit"]["count"] == 0 and not run_check(meta, rev).errors
    rev["rows_over_limit"]["rows"][0]["type"] = "24K"                    # the same row as a 24K would be a failure
    assert list(run_check(meta, rev).errors) == ["fec conduits: no kept row is from a listed conduit"]
    capsys.readouterr()

    con.execute("UPDATE p_rules SET amt = 25000 WHERE CMTE_ID = ? AND amt = 4000", [VALERO])
    meta, rev = meta_for(con)
    c = run_check(meta, rev)                                             # report only by default: printed, not failed
    out = capsys.readouterr().out
    assert not c.errors and "1 single rows above $10,000" in out and VALERO in out and "report only" in out
    c = run_check(meta, rev, enforce_hard=True)
    assert list(c.errors) == ["fec conduits: single pac_money row above $10,000 not on the reviewed allow-list"]
    (row,) = rev["rows_over_hard"]["rows"]
    monkeypatch.setattr(vc, "ALLOWED_ROWS", frozenset({row["sub_id"]}))
    assert not run_check(meta, rev, enforce_hard=True).errors


def test_validator_fails_on_a_missing_or_altered_count(monkeypatch) -> None:
    con, _ = setup(monkeypatch)
    meta, rev = meta_for(con)
    del meta["exclusions"][conduits.KEY]
    assert "fec conduits: exclusion is counted in meta.json" in run_check(meta, rev).errors
    meta, rev = meta_for(con)
    rev["rows_over_limit"]["rows"].append({"committee": SCF, "cycle": 2018, "type": "24K", "sub_id": "1"})
    assert {"fec conduits: no kept row is from a listed conduit",
            "fec conduits: review counts agree with their lists"} <= set(run_check(meta, rev).errors)
    meta, rev = meta_for(con)
    meta["reports"]["fec"]["conduit_review"]["sums_over_limit"]["sums"] = []     # a list must not travel in meta.json
    assert "fec conduits: review counts agree with their lists" in run_check(meta, rev).errors
    meta, rev = meta_for(con)
    meta["exclusions"][conduits.KEY]["committees"][0]["rows"] += 1
    meta["reports"]["fec"]["exclusions"] = meta["exclusions"]
    assert "fec conduits: committee counts add up to the total" in run_check(meta, rev).errors


def test_assembler_merges_the_fec_exclusion_into_meta() -> None:
    from pipeline.assemble.run import merged_exclusions
    trade = {"non_member_trade_rows": {"rows": 1, "reason": "x"}}
    fec = {conduits.KEY: {"rows": 2, "dollars": 10.0, "reason": "y"}}
    assert merged_exclusions({"hf_trades": {"exclusions": trade}, "fec": {"exclusions": fec}}) == {**trade, **fec}
    assert merged_exclusions({"hf_trades": {"exclusions": trade}}) == trade      # a build without the FEC stage
