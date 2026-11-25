"""Owner decisions of 2026-11-25 on amended trades (pipeline/trade_amendments.py, trades.py, assemble/members.py,
assemble/delays.py, validate_trade_amendments.py, validate_delays.py):

1. A trade whose Deleted printings cancel every live printing (one each) stays listed and flagged, and is counted
   nowhere; a trade with a live printing left stays counted.
2. A House row marked Amended with no exactly matching original keeps its row; its lag is withheld and counted apart.

Fixtures are shaped like recorded rows: Kathy Manning (M001135) 20024436 row 30, deleted by 20029046 row 0; and an
event the dataset itself folded a Deleted printing into (Mark Green, 20011417 / 20019040 / 20019374).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from pipeline import trades, validate
from pipeline.assemble.delays import MEMBER_COLS, build_delays, rows_from_trade_file
from pipeline.assemble.members import counted_rows, trade_file, trade_summary
from pipeline.contract import TRADE_COLUMNS
from pipeline.edges_trades import traded_edges
from pipeline.holdings import positions
from pipeline.tests import test_trade_amendments as base
from pipeline.tests.test_trade_amendments import M, ev, mapped
from pipeline.validate_delays import check_delays
from pipeline.trade_amendments import cancelled
from pipeline.validate_trade_amendments import check_against_source, check_meta_counts, check_trade_file, no_live_printing_left

base.PUBLIC.update({"20024436": datetime(2024, 2, 7, 4, 59, 59), "20029046": datetime(2025, 4, 22, 3, 59, 59),
                    "20029100": datetime(2025, 5, 2, 3, 59, 59)})
BOND = dict(asset="US Treasury Note 4.25% [GS]", ticker=None, transactionDate=date(2024, 1, 5), action="purchase",
            amountLow=500001.0, amountHigh=1000000.0, member="M001135")


def manning() -> list[dict[str, Any]]:
    """A purchase, the later filing that deletes it, and an unrelated trade of the same filing."""
    return [ev("20024436", 30, **BOND), ev("20029046", 0, "Deleted", "2000112233", **BOND),
            ev("20024436", 31, **{**BOND, "transactionDate": date(2024, 1, 16), "amountLow": 15001.0, "amountHigh": 50000.0})]


def published(ts: list[dict[str, Any]], orgs: set[str] | None = None) -> dict[str, Any]:
    return trade_file(sorted(ts, key=lambda t: (t["date"], t["id"]), reverse=True), orgs)


def errors(fn: Any, *args: Any) -> dict[str, list[str]]:
    c = validate.Checker()
    fn(c, *args)
    return dict(c.errors)


def test_deleted_trade_is_listed_flagged_and_not_counted() -> None:
    ts, counts = mapped(manning())
    gone = next(t for t in ts if t["id"] == "house:20024436:30")
    assert len(ts) == 2 and counts["folded_deleted"] == 1
    assert gone["deleted"] is True and gone["amended"] is True and gone["lag_days"] == 32 and gone["low"] == 500001.0
    assert gone["amendments"] == [{"id": "house:20029046:0", "doc_id": "20029046", "url": "https://example.org/20029046.pdf",
                                   "status": "Deleted", "available": date(2025, 4, 21)}]
    tf = published([{**t, "org": "tk:UST" if t["deleted"] else None} for t in ts], orgs=set())
    assert len(tf["rows"]) == 2 and tf["not_counted"] == {"house:20024436:30": "deleted_by_later_filing"}
    assert [r[0] for r in counted_rows(tf)] == ["house:20024436:31"] and tf["lag_withheld"] == {}
    assert dict(zip(TRADE_COLUMNS, tf["rows"][1]))["org"] is None      # its org draws no tie, so it is not published
    assert errors(check_trade_file, tf, "trades/M001135") == {}
    counted = [t for t in ts if not t["deleted"]]
    assert trade_summary(counted)["count"] == 1 and build_delays(counted)["totals"]["count"] == 1
    assert [t["lag_days"] for t in rows_from_trade_file("M001135", tf)] == [21]
    doc = build_delays(counted)
    assert errors(check_delays, doc, {"M001135"}, {"M001135": tf}, {"M001135": trade_summary(counted)}, validate.is_date) == {}
    assert "delays: member row equals the one re-derived from trades/<id>.json" in errors(
        check_delays, build_delays(ts), {"M001135"}, {"M001135": tf}, {"M001135": trade_summary(ts)}, validate.is_date)
    assert "not_counted: a listed House trade flagged amended" in errors(
        check_trade_file, {**tf, "not_counted": {"house:20024436:31": "deleted_by_later_filing"}}, "trades/M001135")


def test_trade_summary_listed_counts_every_row_of_the_trade_file() -> None:
    ts, _ = mapped(manning())
    counted = [t for t in ts if not t["deleted"]]
    tf = published([{**t, "org": None} for t in ts])
    summary = trade_summary(counted, len(ts))
    assert (summary["count"], summary["listed"]) == (1, 2) and summary["listed"] == len(tf["rows"]) and summary["by_action"] == {"buy": 1}
    only = [t for t in ts if t["deleted"]]                  # a member whose only trade was deleted: a file, nothing counted
    none = trade_summary([], len(only))
    assert (none["count"], none["listed"], none["late"], none["first"]) == (0, 1, 0, None) and len(published([{**t, "org": None} for t in only])["rows"]) == 1
    assert trade_summary([])["listed"] == 0 and trade_summary(counted)["listed"] == 1      # no rows: no file, listed 0


def test_deleted_trade_draws_no_tie_and_no_position() -> None:
    ts, _ = mapped(manning())
    resolved = [{**t, "org": "tk:UST"} for t in ts]
    all_rows, counted = traded_edges(resolved), traded_edges([t for t in resolved if not t["deleted"]])
    assert all_rows[0]["count"] == 2 and counted[0]["count"] == 1      # edges_trades.run passes the counted trades only
    assert counted[0]["by_year"][0]["low"] == 15001.0 and counted[0]["by_year"][0]["high"] == 50000.0
    years = {"2023": {"assets": {"cols": ["name"], "rows": []}}}
    body = positions.build(years, published(resolved), {})
    assert body["summary"]["trades_in_unlisted_assets"] == 1          # the deleted row is not a trade of the timeline


def test_a_later_reprint_restores_a_deleted_trade() -> None:
    rows = manning()[:2] + [ev("20029100", 0, "Amended", "2000112233", **BOND)]
    ts, counts = mapped(rows)
    assert len(ts) == 1 and counts["folded_deleted"] == 1 and counts["folded_amended"] == 1
    assert ts[0]["deleted"] is False and [a["status"] for a in ts[0]["amendments"]] == ["Deleted", "Amended"]
    assert published([{**t, "org": None} for t in ts])["not_counted"] == {}
    only = mapped([ev("20029046", 0, "Deleted", "2000112233", **BOND)])[0][0]      # a Deleted row with no original
    assert only["deleted"] is True and only["amendments"] == [] and only["lag_withheld"] == "amended_unmatched"


def _printing(doc: str, row: int, status: str | None) -> dict[str, Any]:
    return {"doc": doc, "row": row, "url": f"https://example.org/{doc}.pdf", "at": base.PUBLIC[doc], "status": status}


def test_deleted_printing_the_dataset_folded_is_listed_under_the_trade() -> None:
    """The dataset folded the Deleted row into the original's event: there is no event to fold, only a printing."""
    first = {**ev("20024436", 30, **BOND), "printings": [_printing("20024436", 30, "New"), _printing("20029046", 0, "Deleted")]}
    ts, counts = mapped([first])
    assert counts["folded_deleted"] == 0 and ts[0]["deleted"] is True and ts[0]["amended"] is True
    assert ts[0]["amendments"] == [{"id": "house:20029046:0", "doc_id": "20029046", "url": "https://example.org/20029046.pdf",
                                    "status": "Deleted", "available": date(2025, 4, 21)}]
    assert errors(check_trade_file, published([{**t, "org": None} for t in ts]), "trades/M001135") == {}
    again = {**first, "printings": [*first["printings"], _printing("20029100", 4, "New")]}     # printed again later
    restored = mapped([again])[0][0]
    assert restored["deleted"] is False and [a["status"] for a in restored["amendments"]] == ["Deleted", "Reprinted"]
    senate = {**first, "chamber": "senate", "eventId": "senate:x:0"}
    assert mapped([senate])[0][0]["deleted"] is False


def test_a_deleted_row_cancels_one_printing_not_the_trade() -> None:
    """Grijalva G000551 house:20001226:0: reported New in 20001226 (public 2014-07-01), printed again as New in the
    fuller 20001267 and Deleted in 20001268, both public 2014-07-09. One printing is cancelled, one remains."""
    base.PUBLIC.update({"20001226": datetime(2014, 7, 2, 3, 59, 59), "20001267": datetime(2014, 7, 10, 3, 59, 59),
                        "20001268": datetime(2014, 7, 10, 3, 59, 59), "20012558": datetime(2019, 7, 9, 3, 59, 59),
                        "20012662": datetime(2019, 7, 20, 3, 59, 59), "20017615": datetime(2020, 9, 12, 3, 59, 59)})
    old = dict(transactionDate=date(2014, 6, 20), member="G000551")
    for order in ((0, 1, 2), (2, 1, 0), (1, 2, 0)):         # the result does not depend on how same-day filings sort
        prints = [_printing("20001226", 0, "New"), _printing("20001267", 3, "New"), _printing("20001268", 0, "Deleted")]
        t = mapped([{**ev("20001226", 0, **old), "printings": [prints[i] for i in order]}])[0][0]
        assert t["deleted"] is False and t["amended"] is True
        assert [(a["id"], a["status"]) for a in t["amendments"]] == [("house:20001268:0", "Deleted"), ("house:20001267:3", "Reprinted")]
        tf = published([{**t, "org": None}])
        assert tf["not_counted"] == {} and errors(check_trade_file, tf, "trades/G000551") == {}
    # Langevin L000559 house:20012558:0: New, New again eleven days later, one Deleted row a year on
    lang = [_printing("20012558", 0, "New"), _printing("20012662", 0, "New"), _printing("20017615", 2, "Deleted")]
    assert mapped([{**ev("20012558", 0, member="L000559"), "printings": lang}])[0][0]["deleted"] is False
    assert mapped([{**ev("20012558", 0, member="L000559"), "printings": [*lang, _printing("20017615", 3, "Deleted")]}])[0][0]["deleted"] is True
    # a Deleted row cannot cancel a printing that became public after it
    late = [_printing("20001226", 0, "Deleted"), _printing("20001267", 3, "New")]
    assert cancelled(late) is False and cancelled(late[:1]) is True and cancelled(late[1:]) is False
    src_prints = [(base.PUBLIC[p["doc"]], p["doc"], p["row"], p["status"]) for p in lang]
    assert no_live_printing_left(src_prints) is False and no_live_printing_left([src_prints[0], src_prints[2]]) is True
    assert no_live_printing_left(src_prints[:2]) is False and no_live_printing_left([*src_prints, (base.PUBLIC["20017615"], "20017615", 3, "Deleted")]) is True


def test_amended_row_without_its_original_gets_its_own_delays_bucket() -> None:
    rows = [ev("20015042", 0), ev("20016961", 0, "Amended", "2000060675", transactionDate=date(2020, 1, 17)),
            base.versioned("20018011", "20018539", date(2021, 1, 4))]
    ts, counts = mapped(rows)
    assert counts["amended_without_original"] == 1 and len(ts) == 3
    assert sorted(str(t["lag_withheld"]) for t in ts) == ["None", "amended_unmatched", "date_corrected"]
    doc = build_delays(ts)
    g = doc["totals"]
    assert (g["count"], g["dated"], g["date_corrected"], g["amended_unmatched"], g["undated"], g["negative"]) == (3, 1, 1, 1, 0, 0)
    assert sum(g["bands"].values()) == 1 and g["max"] == 26 and trade_summary(ts)["late"] == 0   # never 185 days, never 0
    assert MEMBER_COLS[-2:] == ["date_corrected", "amended_unmatched"] and doc["members"]["rows"][0][-2:] == [1, 1]
    tf = published([{**t, "org": None} for t in ts])
    assert sorted(tf["lag_withheld"].values()) == ["amended_unmatched", "date_corrected"]
    assert errors(check_delays, doc, {M}, {M: tf}, {M: trade_summary(ts)}, validate.is_date) == {}
    swapped = {**tf, "lag_withheld": {k: "date_corrected" for k in tf["lag_withheld"]}}     # the reason is part of the figures
    assert errors(check_delays, doc, {M}, {M: swapped}, {M: trade_summary(ts)}, validate.is_date) != {}


def _meta(ts: list[dict[str, Any]], **over: int) -> dict[str, Any]:
    counted = [t for t in ts if not t["deleted"]]
    n = {"deleted_by_later_filing": len(ts) - len(counted),
         "lag_withheld_date_corrected": sum(t["lag_withheld"] == "date_corrected" for t in counted),
         "lag_withheld_amended_unmatched": sum(t["lag_withheld"] == "amended_unmatched" for t in counted), **over}
    return {"counts": {f"trades_{k}": v for k, v in n.items()},
            "exclusions": {"deleted_by_later_filing": {"rows": n["deleted_by_later_filing"]},
                           "lag_withheld_date_corrected": {"rows": n["lag_withheld_date_corrected"]},
                           "amended_rows_without_original": {"rows": n["lag_withheld_amended_unmatched"]}},
            "reports": {"hf_trades": {"trades_written": len(ts), "trades_counted": len(counted)}}}


def test_meta_counts_equal_the_files() -> None:
    ts, _ = mapped(manning() + [ev("20016961", 0, "Amended", "2000060675", member="M001135")])
    files = {"M001135": published([{**t, "org": None} for t in ts])}
    assert errors(check_meta_counts, files, _meta(ts)) == {}
    assert "not_counted: the deleted trades in the files equal meta.json" in errors(check_meta_counts, files, _meta(ts, deleted_by_later_filing=0))
    assert "lag_withheld: the counted trades with a withheld lag equal meta.json" in errors(
        check_meta_counts, files, _meta(ts, lag_withheld_amended_unmatched=0))


def _source(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, int], str], dict[tuple[str, str], str], dict[str, Any]]:
    marks = {(r["sourceDocId"], r["sourceRowIndex"]): r["filing_status"] for r in rows if r["filing_status"] in ("Amended", "Deleted")}
    events = {r["eventId"]: [r["filing_status"], 1, [(base.PUBLIC[r["sourceDocId"]], r["sourceDocId"], r["sourceRowIndex"], r["filing_status"])]]
              for r in rows}
    return marks, {("house", d): trades.available_date(at).isoformat() for d, at in base.PUBLIC.items()}, events


def test_validator_rederives_deleted_and_unmatched_from_the_source() -> None:
    rows = manning() + [ev("20016961", 0, "Amended", "2000060675", member="M001135")]
    ts, _ = mapped(rows)
    tf = published([{**t, "org": None} for t in ts])
    src = _source(rows)
    assert errors(check_against_source, {"M001135": tf}, *src) == {}
    kept = {**tf, "not_counted": {}}                                   # a build that forgot the deletion
    assert list(errors(check_against_source, {"M001135": kept}, *src)) == [
        "not_counted: exactly the trades whose Deleted printings in the source cancel every live one"]
    i, late = TRADE_COLUMNS.index("lag_days"), TRADE_COLUMNS.index("late")
    timed = {**tf, "lag_withheld": {}, "rows": [[*r[:i], 186, *r[i + 1:late], True, *r[late + 1:]] if r[0] == "house:20016961:0" else r
                                                 for r in tf["rows"]]}  # a build that timed it from the amending filing
    assert list(errors(check_against_source, {"M001135": timed}, *src)) == [
        "lag_withheld: amended_unmatched exactly on single-version House rows the source marks"]


def test_load_reads_the_printings_the_dataset_folded(tmp_path) -> None:
    rows = [ev("20024436", 30, **BOND), ev("20024436", 31, **{**BOND, "amountLow": 1001.0, "amountHigh": 15000.0})]
    base._write(tmp_path, rows)
    events, printed = (tmp_path / "data" / t / "part-0.parquet" for t in ("political_trade_events", "political_trades"))
    pq.write_table(pa.Table.from_pylist([
        {**e, "contributorRowIds": '["20024436:30","20029046:0"]' if e["sourceRowIndex"] == 30 else '["20024436:31"]'}
        for e in pq.read_table(events).to_pylist()]), events)
    was = [{**t, "chamber": "house", "availableAt": base.PUBLIC[t["docId"]], "sourceUrl": f"https://example.org/{t['docId']}.pdf"}
           for t in pq.read_table(printed).to_pylist()]
    pq.write_table(pa.Table.from_pylist([*was, {**was[0], "docId": "20029046", "rowIndex": 0, "filingStatus": "Deleted",
                                                "sourceTransactionId": "2000112233", "availableAt": base.PUBLIC["20029046"],
                                                "sourceUrl": "https://example.org/20029046.pdf"}]), printed)
    ts, info = trades.load(duckdb.connect(), tmp_path, {"M001135"})
    gone = next(t for t in ts if t["id"] == "house:20024436:30")
    assert gone["deleted"] is True and [(a["id"], a["status"], a["available"]) for a in gone["amendments"]] == [
        ("house:20029046:0", "Deleted", date(2025, 4, 21))]
    assert info["trades_counted"] == 1 and info["amendment_counts"]["trades_deleted_by_later_filing"] == 1
    assert info["exclusions"]["deleted_by_later_filing"]["rows"] == 1 and "not counted" in info["exclusions"]["deleted_by_later_filing"]["reason"]
    assert info["amendment_counts"]["trades_lag_withheld_amended_unmatched"] == 0
