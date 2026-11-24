"""Folding of amended House trade reports (pipeline/trade_amendments.py, pipeline/trades.py), the published trade
file (assemble/members.py `trade_file`) and its validator (pipeline/validate_trade_amendments.py).

Fixtures are shaped like recorded rows of the source dataset at commit c93d0573 for Nancy Pelosi (P000197): filing
20015042 (public 2020-02-11) and its reprint 20016961 (public 2020-07-20, rows marked Amended with a transaction ID),
and 20018011 / 20018355 reprinted in 20018539.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from pipeline import trades, validate
from pipeline.assemble.delays import build_delays
from pipeline.assemble.members import trade_file, trade_summary
from pipeline.trade_amendments import apply_versions, asset_text, fold, same_key_other_filing
from pipeline.validate_trade_amendments import check_against_source, check_folding, check_same_key, check_trade_file

M = "P000197"
PUBLIC = {"20015042": datetime(2020, 2, 12, 4, 59, 59), "20016961": datetime(2020, 7, 21, 3, 59, 59),
          "20018011": datetime(2021, 1, 22, 4, 59, 59), "20018355": datetime(2021, 3, 10, 4, 59, 59),
          "20018539": datetime(2021, 4, 10, 3, 59, 59), "9111820": datetime(2017, 9, 29, 3, 59, 59),
          "9111930": datetime(2017, 10, 25, 3, 59, 59)}
AMZN = dict(transactionDate=date(2020, 1, 16), action="sale", ticker="AMZN", amountLow=250001.0, amountHigh=500000.0)
AB = dict(transactionDate=date(2020, 12, 22), action="purchase", ticker="AB", amountLow=500001.0, amountHigh=1000000.0)


def ev(doc: str, row: int, status: str | None = "New", tid: str | None = None, *, asset: str = "Amazon.com, Inc. (AMZN)",
       code: str | None = None, chamber: str = "house", member: str = M, **over: Any) -> dict[str, Any]:
    """One current event joined to its printed row, as trades.load hands it to fold()."""
    base = {"eventId": f"{chamber}:{doc}:{row}", "version": 1, "n_versions": 1, "chamber": chamber, "memberId": member,
            "sourceDocId": doc, "sourceRowIndex": row, "sourceUrl": f"https://example.org/{doc}.pdf",
            "availableAt": PUBLIC[doc], "first_available_at": PUBLIC[doc], "supersededAt": None,
            "filing_status": status, "transaction_id": tid, "owner": "spouse", "partialSale": None,
            "assetDescription": asset, "assetTypeCode": code, "assetTypeLabel": None, "ticker_source": "printed", **AMZN}
    return {**base, **over}


def pelosi() -> list[dict[str, Any]]:
    """Three printed originals and their five-row reprint filings; two rows of each reprint filing are new trades."""
    return [
        ev("20015042", 0, action="purchase", amountLow=1000001.0, amountHigh=5000000.0),
        ev("20015042", 1), ev("20015042", 2),                       # two identical sales of AMZN calls
        ev("20016961", 0, "Amended", "2000060675", code="OP"), ev("20016961", 1, "Amended", "2000060676", code="OP"),
        ev("20016961", 2, asset="American Express Company (AXP)", ticker="AXP", transactionDate=date(2020, 6, 24), action="purchase"),
        ev("20018011", 0, asset="AllianceBernstein Holding L.P. Units (AB) [ST]", code="ST", **AB),
        ev("20018539", 0, "Amended", "2000074389", asset="AllianceBernstein Holding L.P. Units (AB)", **AB),
    ]


def mapped(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    kept, counts = fold(apply_versions(r, r.get("versions")) for r in rows)
    return [trades.map_row(r) for r in kept], counts


def versioned(first_doc: str, later_doc: str, first_date: date, **over: Any) -> dict[str, Any]:
    """The current (second) version of a dataset event first printed in first_doc with first_date."""
    r = ev(later_doc, 7, None, **{"asset": "Roblox", "ticker": "RBLX", "transactionDate": date(2021, 2, 18), **over})
    vs = [{"doc": first_doc, "row": 0, "url": f"https://example.org/{first_doc}.pdf", "at": PUBLIC[first_doc], "date": first_date},
          {"doc": later_doc, "row": 7, "url": r["sourceUrl"], "at": PUBLIC[later_doc], "date": r["transactionDate"]}]
    return {**r, "eventId": f"house:{first_doc}:0", "version": 2, "n_versions": 2, "versions": vs}


def test_asset_text_drops_only_the_type_code_and_outer_space() -> None:
    assert asset_text(" AllianceBernstein Holding L.P. Units (AB) [ST] ") == "AllianceBernstein Holding L.P. Units (AB)"
    assert asset_text("Apple Inc. (AAPL) [OP]") == asset_text("Apple Inc. (AAPL)") == "Apple Inc. (AAPL)"
    assert asset_text("Apple Inc (AAPL)") != asset_text("Apple Inc. (AAPL)")          # never by similarity
    assert asset_text(None) == ""


def test_pelosi_reprints_fold_into_the_original_trade() -> None:
    ts, counts = mapped(pelosi())
    by_id = {t["id"]: t for t in ts}
    assert sorted(by_id) == ["house:20015042:0", "house:20015042:1", "house:20015042:2", "house:20016961:2", "house:20018011:0"]
    assert counts["folded_amended"] == counts["folded_by_exact_key"] == 3 and counts["amended_without_original"] == 0
    assert counts["folded_with_printed_transaction_id"] == 3 and counts["folded_on_filing_level_amendment"] == 0
    for i, reprint in (("house:20015042:1", "house:20016961:0"), ("house:20015042:2", "house:20016961:1")):
        t = by_id[i]
        assert t["amended"] is True and t["doc_id"] == "20015042" and t["url"].endswith("20015042.pdf")
        assert t["available"] == date(2020, 2, 11) and t["lag_days"] == 26 and t["late"] is False   # not 186 days
        assert t["amendments"] == [{"id": reprint, "doc_id": "20016961", "url": "https://example.org/20016961.pdf",
                                    "status": "Amended", "available": date(2020, 7, 20)}]
        assert t["asset_class"] == "option"                 # other fields are the latest printing's ([OP] was added)
    ab = by_id["house:20018011:0"]
    assert ab["lag_days"] == 30 and ab["amendments"][0]["id"] == "house:20018539:0" and ab["asset"].endswith("(AB)")
    assert by_id["house:20015042:0"]["amended"] is False and by_id["house:20016961:2"]["amendments"] == []
    assert same_key_other_filing(ts)["trades"] == 0
    assert trade_summary(ts)["late"] == 0 and build_delays(ts)["totals"]["amended"] == 3


def test_unmarked_same_key_in_another_filing_is_kept_and_counted() -> None:
    """McCaul-shaped: two scanned filings print the same row, neither carries a filing status."""
    rows = [ev("9111820", 4, None, member="M001157"), ev("9111930", 4, None, member="M001157"),
            ev("9111820", 5, None, member="M001157"), ev("9111820", 6, None, member="M001157", ticker="MSFT", asset="Microsoft")]
    ts, counts = mapped(rows)
    assert len(ts) == 4 and not any(t["amended"] or t["amendments"] for t in ts) and counts["marked_rows"] == 0
    assert same_key_other_filing(ts) == {"trades": 3, "groups": 1, "members": {"M001157": 3}}


def test_amended_row_that_changes_a_key_field_is_not_folded() -> None:
    rows = [ev("20015042", 1), ev("20016961", 0, "Amended", "2000060675", transactionDate=date(2020, 1, 17))]
    ts, counts = mapped(rows)
    assert len(ts) == 2 and counts["amended_without_original"] == 1 and counts["folded_amended"] == 0
    late = next(t for t in ts if t["id"] == "house:20016961:0")
    assert late["amended"] is True and late["amendments"] == [] and late["lag_days"] == 185   # from the amending filing
    assert next(t for t in ts if t["id"] == "house:20015042:1")["amended"] is False


def test_fold_is_one_to_one_and_refuses_an_ambiguous_original() -> None:
    one_original, counts = mapped([ev("20015042", 1), ev("20016961", 0, "Amended"), ev("20016961", 1, "Amended")])
    assert sorted(t["id"] for t in one_original) == ["house:20015042:1", "house:20016961:1"]
    assert counts["folded_amended"] == 1 and counts["amended_without_original"] == 1
    # the same trade printed unmarked in two earlier filings: which one the amendment restates is not filed
    rows = [ev("9111820", 0, None), ev("9111930", 0, None), ev("20016961", 0, "Amended")]
    ts, counts = mapped(rows)
    assert len(ts) == 3 and counts["original_ambiguous"] == 1 and counts["folded_amended"] == 0
    assert same_key_other_filing(ts)["trades"] == 3
    assert mapped([ev("20015042", 1), ev("20016961", 0, "Amended", first_available_at=None, availableAt=None)])[1]["folded_amended"] == 0


def test_chain_deleted_and_transaction_id() -> None:
    chain, counts = mapped([ev("20015042", 1), ev("20016961", 0, "Amended"), ev("20018539", 0, "Deleted")])
    assert len(chain) == 1 and [a["status"] for a in chain[0]["amendments"]] == ["Amended", "Deleted"]
    assert counts["folded_amended"] == 1 and counts["folded_deleted"] == 1 and chain[0]["lag_days"] == 26
    assert counts["folded_on_filing_level_amendment"] == 2 and counts["folded_with_printed_transaction_id"] == 0   # no ID printed
    # same House transaction ID on two amendments whose key fields differ: one trade, the latest values
    rows = [ev("20016961", 0, "Amended", "2000060675"), ev("20018539", 0, "Amended", "2000060675", amountLow=100001.0, amountHigh=250000.0)]
    ts, counts = mapped(rows)
    assert len(ts) == 1 and counts["folded_by_transaction_id"] == 1 and ts[0]["low"] == 100001.0
    assert ts[0]["id"] == "house:20016961:0" and ts[0]["available"] == date(2020, 7, 20)
    redated = [ev("20016961", 0, "Amended", "2000060675"), ev("20018539", 0, "Amended", "2000060675", transactionDate=date(2020, 1, 15))]
    one = mapped(redated)[0][0]
    assert one["date"] == date(2020, 1, 15) and one["lag_days"] is None and one["late"] is None and one["lag_withheld"] is True
    other_member = [ev("20016961", 0, "Amended", "2000060675"), ev("20018539", 0, "Amended", "2000060675", member="M001157", ticker="X")]
    assert len(mapped(other_member)[0]) == 2


def test_dataset_versions_cite_the_first_filing_and_withhold_a_corrected_lag() -> None:
    same, moved, before = (versioned("20018355", "20018539", date(2021, 2, 18)), versioned("20018011", "20018539", date(2021, 1, 4)),
                           versioned("20018011", "20018539", date(2021, 1, 4), transactionDate=date(2021, 1, 25), ticker="X"))
    ts, _ = mapped([same, moved, before])
    a, b, c = (next(t for t in ts if t["id"] == i and t["ticker"] == k) for i, k in (
        ("house:20018355:0", "RBLX"), ("house:20018011:0", "RBLX"), ("house:20018011:0", "X")))
    assert a["doc_id"] == "20018355" and a["url"].endswith("20018355.pdf") and a["available"] == date(2021, 3, 9)
    assert a["lag_days"] == 19 and a["late"] is False and a["amended"] is True and a["lag_withheld"] is False
    assert a["amendments"] == [{"id": "house:20018355:0", "doc_id": "20018539", "url": "https://example.org/20018539.pdf",
                                "status": "Version", "available": date(2021, 4, 9)}]
    for t in (b, c):            # the first public filing showed 2021-01-04; c would be -4 days: never published
        assert t["available"] == date(2021, 1, 21) and t["lag_days"] is None and t["late"] is None and t["lag_withheld"] is True
    g = build_delays(ts)["totals"]
    assert g["date_corrected"] == 2 and g["undated"] == 0 and g["dated"] == 1 and g["negative"] == 0 and sum(g["bands"].values()) == 1
    assert trade_summary(ts)["late"] == 0
    tf = _published(ts[:1])
    assert _errors(check_trade_file, tf, "trades/x") == {} and tf["amendments"][ts[0]["id"]][0]["status"] == "Version"


def test_marked_row_of_a_multi_version_event_is_not_key_matched() -> None:
    v2 = {**versioned("20018355", "20018539", date(2021, 2, 18)), "filing_status": "Amended"}
    twin = ev("20018011", 3, asset="Roblox", ticker="RBLX", transactionDate=date(2021, 2, 18))     # same key, earlier filing
    ts, counts = mapped([twin, v2])
    assert len(ts) == 2 and counts["marked_already_versioned"] == 1 and counts["folded_amended"] == 0
    assert counts["amended_without_original"] == 0


def test_senate_rows_are_not_folded() -> None:
    rows = [ev("20015042", 1, None, chamber="senate"), ev("20016961", 0, "Amended", chamber="senate")]
    ts, counts = mapped(rows)
    assert len(ts) == 2 and counts["marked_rows"] == 0 and not any(t["amended"] for t in ts)


def _write(root: Any, events: list[dict[str, Any]], with_status: bool = True) -> None:
    raw = [{k: v for k, v in e.items() if k not in ("n_versions", "first_available_at", "filing_status", "transaction_id", "ticker_source")}
           for e in events]
    printed = [{"docId": e["sourceDocId"], "rowIndex": e["sourceRowIndex"], "resolutionStatus": "printed", "identitySource": "legislators",
                **({"filingStatus": e["filing_status"], "sourceTransactionId": e["transaction_id"]} if with_status else {})}
               for e in events if e["supersededAt"] is None]
    filings = [{"docId": d, "filerFirst": "N", "filerLast": "P", "sourceUrl": "u", "identitySource": "legislators", "extractionStatus": "ok",
                "failureReason": None, "memberId": M, "filingDate": PUBLIC[d].date(), "chamber": "house"} for d in sorted({e["sourceDocId"] for e in events})]
    for name, rows in (("political_trade_events", raw), ("political_trades", printed), ("political_filings", filings)):
        (root / "data" / name).mkdir(parents=True)
        pq.write_table(pa.Table.from_pylist(rows), root / "data" / name / "part-0.parquet")


def test_load_folds_counts_and_uses_the_first_version_date(tmp_path) -> None:
    old = ev("20018355", 0, asset="Roblox", ticker="RBLX", transactionDate=date(2021, 2, 18), supersededAt=datetime(2021, 4, 10))
    new = {**old, "version": 2, "supersededAt": None, "sourceDocId": "20018539", "sourceRowIndex": 5, "availableAt": PUBLIC["20018539"]}
    _write(tmp_path / "a", pelosi() + [old, new])
    ts, info = trades.load(duckdb.connect(), tmp_path / "a", {M})
    assert len(ts) == 6 and info["current_events"] == 9 and info["filing_status_in_source"] is True
    assert info["exclusions"]["amended_reprints_folded"]["rows"] == 3 == info["amendment_counts"]["trades_amended_reprints_folded"]
    assert info["exclusions"]["same_key_other_filing"]["rows"] == 0 == info["amendment_counts"]["trades_same_key_other_filing"]
    v2 = next(t for t in ts if t["ticker"] == "RBLX")
    assert v2["version"] == 2 and v2["amended"] is True and v2["available"] == date(2021, 3, 9) and v2["lag_days"] == 19
    assert v2["doc_id"] == "20018355" and [a["doc_id"] for a in v2["amendments"]] == ["20018539"] and "lag_withheld" not in v2
    assert info["exclusions"]["lag_withheld_date_corrected"]["rows"] == 0 == info["amendment_counts"]["trades_lag_withheld_date_corrected"]
    assert pa.Table.from_pylist(ts, schema=trades.SCHEMA).num_rows == 6
    # a source without the filing-status column: nothing is folded, the pairs are counted, and the report says so
    _write(tmp_path / "b", pelosi(), with_status=False)
    ts, info = trades.load(duckdb.connect(), tmp_path / "b", {M})
    assert len(ts) == 8 and info["filing_status_in_source"] is False and info["amendments"]["marked_rows"] == 0
    assert info["exclusions"]["same_key_other_filing"]["rows"] == 6 and info["amendments"]["same_key_other_filing"]["members"] == {M: 6}


def _published(ts: list[dict[str, Any]]) -> dict[str, Any]:
    return trade_file([{**t, "org": None} for t in sorted(ts, key=lambda t: (t["date"], t["id"]), reverse=True)])


def _errors(fn: Any, *args: Any) -> dict[str, list[str]]:
    c = validate.Checker()
    fn(c, *args)
    return dict(c.errors)


def test_trade_file_cites_both_filings_and_validates() -> None:
    ts, _ = mapped(pelosi())
    tf = _published(ts)
    assert set(tf["filings"]) == {"20015042", "20016961", "20018011", "20018539"} and len(tf["rows"]) == 5
    assert tf["amendments"]["house:20015042:1"] == [{"id": "house:20016961:0", "doc": "20016961", "status": "Amended", "available": "2020-07-20"}]
    assert set(tf["amendments"]) == {"house:20015042:1", "house:20015042:2", "house:20018011:0"}
    assert _errors(check_trade_file, tf, "trades/P000197") == {}
    bad = {**tf, "amendments": {**tf["amendments"], "house:20015042:0": [{"id": "house:20016961:2", "doc": "20015042", "status": "New", "available": "2020-01-01"}]}}
    errs = _errors(check_trade_file, bad, "trades/P000197")
    assert "amendments: listed under a published trade flagged amended" in errs and "amendments: entry schema" in errs
    early = {**tf, "amendments": {"house:20015042:1": [{"id": "house:20016961:2", "doc": "20015042", "status": "Amended", "available": "2020-01-01"}]}}
    assert len(_errors(check_trade_file, early, "trades/P000197")) == 3
    assert "schema" in _errors(check_trade_file, {k: v for k, v in tf.items() if k != "amendments"}, "trades/P000197")


def test_validator_requires_same_key_pairs_to_be_counted() -> None:
    unfolded = [trades.map_row({**r, "amendments": [], "marked": False, "date_corrected": False}) for r in pelosi()]  # as before this rule
    rows = {M: _published(unfolded)["rows"]}
    counted = same_key_other_filing(unfolded)
    assert counted == {"trades": 6, "groups": 2, "members": {M: 6}}

    def meta(n: int, per_member: dict[str, Any]) -> dict[str, Any]:
        return {"counts": {"trades_same_key_other_filing": n}, "exclusions": {"same_key_other_filing": {"rows": n}},
                "reports": {"hf_trades": {"amendments": {"same_key_other_filing": per_member}}}}
    assert _errors(check_same_key, rows, meta(6, counted)) == {}
    assert len(_errors(check_same_key, rows, meta(0, {"trades": 0, "groups": 0, "members": {}}))) == 2   # uncounted duplicates fail
    folded = {M: _published(mapped(pelosi())[0])["rows"]}
    assert _errors(check_same_key, folded, meta(0, {"trades": 0, "groups": 0, "members": {}})) == {}


def _source(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, int], str], dict[tuple[str, str], str]]:
    marks = {(r["sourceDocId"], r["sourceRowIndex"]): r["filing_status"] for r in rows if r["filing_status"] in ("Amended", "Deleted")}
    return marks, {("house", d): trades.available_date(at).isoformat() for d, at in PUBLIC.items()}


def test_validator_rereads_the_source_and_catches_a_missed_fold(tmp_path) -> None:
    rows = pelosi() + [ev("20015042", 3), ev("20016961", 3, "Amended"), ev("20016961", 4, "Amended")]   # one original, two reprints
    marks, public = _source(rows)
    tf = _published(mapped(rows)[0])
    assert _errors(check_against_source, {M: tf["rows"]}, {M: tf["amendments"]}, marks, public) == {}
    unfolded = _published([trades.map_row({**r, "amendments": [], "marked": False, "date_corrected": False}) for r in pelosi()])
    errs = _errors(check_against_source, {M: unfolded["rows"]}, {M: {}}, marks, public)
    assert sorted(errs["amendments: a marked House row with one exact earlier filing was folded"]) == [
        f"{M}:house:20016961:0", f"{M}:house:20016961:1", f"{M}:house:20018539:0"]
    assert "amendments: the source still carries the filing status column" in _errors(check_against_source, {M: tf["rows"]}, {M: tf["amendments"]}, None, public)
    # `doc` must be the filing public on `available`: citing the amending filing with the original's date fails
    wrong = [[("20016961" if c == "20015042" else c) for c in r] for r in tf["rows"]]
    assert "trade doc is the filing that became public on `available`" in _errors(check_against_source, {M: wrong}, {M: {}}, marks, public)
    # the stage did not read the status, or the cache is gone: both fail
    meta = {"counts": {"trades_same_key_other_filing": 0}, "exclusions": {"same_key_other_filing": {"rows": 0}}, "sources": {"hf_trades": {"revision": "r"}},
            "reports": {"hf_trades": {"filing_status_in_source": False, "amendments": {"marked_rows": 0, "same_key_other_filing": {"trades": 0, "groups": 0, "members": {}}}}}}
    errs = _errors(check_folding, {M: _published(mapped(pelosi())[0])["rows"]}, meta, tmp_path, tmp_path)
    assert len(errs) == 2 and any("filing status" in k for k in errs) and any("download cache" in k for k in errs)


def test_reprint_folded_into_a_date_corrected_event_keeps_the_lag_withheld() -> None:
    corrected = versioned("20015042", "20016961", date(2019, 12, 1), transactionDate=date(2020, 1, 10))
    reprint = ev("20018011", 5, "Amended", asset="Roblox", ticker="RBLX", transactionDate=date(2020, 1, 10))
    ts, counts = mapped([corrected, reprint])
    assert len(ts) == 1 and counts["folded_amended"] == 1
    assert ts[0]["lag_withheld"] is True and ts[0]["lag_days"] is None and ts[0]["late"] is None
