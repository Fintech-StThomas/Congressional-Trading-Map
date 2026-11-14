"""Trades: enum mapping, Eastern dates, amendment handling (pipeline/trades.py), co-trading eligibility
(pipeline/edges_trades.py) and ticker/name normalisation (pipeline/util.py, pipeline/companies.py)."""
from __future__ import annotations

from datetime import date, datetime

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from pipeline import trades
from pipeline.companies import same_issuer_possible
from pipeline.edges_trades import eligible, shuffled
from pipeline.util import normalise_name, normalise_ticker


def test_normalise_name_drops_suffixes_and_punctuation() -> None:
    assert normalise_name("The Walt Disney Co.") == "WALT DISNEY"
    assert normalise_name("AT&T INC.") == "AT T"
    assert normalise_name("Berkshire Hathaway Holdings Group, Inc") == "BERKSHIRE HATHAWAY"
    assert normalise_name("McDonald's Corp") == "MCDONALDS"


def test_normalise_ticker_share_classes() -> None:
    assert normalise_ticker("brk/b") == normalise_ticker("BRK-B") == normalise_ticker("BRK.B") == "BRK.B"


def test_ticker_veto_only_when_names_clearly_differ() -> None:
    assert same_issuer_possible(["APPLE INC (AAPL)"], "Apple Inc.")
    assert same_issuer_possible(["AMERICAN INTL GROUP, INC. CMN"], "AMERICAN INTERNATIONAL GROUP, INC.")
    assert not same_issuer_possible(["SunTrust Banks, Inc. (STI)"], "Solidion Technology Inc.")


def test_owner_and_asset_mappings_never_guess() -> None:
    assert trades.OWNER["not_indicated"] == "unspecified"
    assert "self" not in {v for k, v in trades.OWNER.items() if k != "self"}
    assert trades.asset_class("house", None, None) == "unknown"
    assert trades.asset_class("house", "ZZ", None) == "unknown"
    assert trades.asset_class("senate", None, "Stock") == "stock"
    assert trades.asset_class("house", "GS", None) == "bond"


def test_available_date_is_eastern() -> None:
    assert trades.available_date(datetime(2012, 8, 23, 3, 59, 59)) == date(2012, 8, 22)
    assert trades.available_date(None) is None


def _event(event_id: str, version: int, superseded: datetime | None, low: float) -> dict:
    return {"eventId": event_id, "version": version, "supersededAt": superseded, "memberId": "A000001",
            "chamber": "house", "transactionDate": date(2020, 3, 2), "availableAt": datetime(2020, 5, 1, 3, 0),
            "owner": "spouse", "action": "purchase", "partialSale": None, "ticker": "AAPL",
            "assetDescription": "Apple Inc", "assetTypeCode": "ST", "assetTypeLabel": None, "amountLow": low,
            "amountHigh": 15000.0, "sourceUrl": "https://example.org/1.pdf", "sourceDocId": f"d{version}",
            "sourceRowIndex": 0}


def test_amended_event_keeps_only_the_current_version(tmp_path) -> None:
    root = tmp_path
    tables = {
        "political_trade_events": [_event("e1", 1, datetime(2020, 6, 1), 1001.0), _event("e1", 2, None, 1001.0),
                                   _event("e2", 1, None, 50001.0)],
        "political_trades": [{"docId": "d1", "rowIndex": 0, "resolutionStatus": "printed", "identitySource": "bioguide"},
                             {"docId": "d2", "rowIndex": 0, "resolutionStatus": "resolved", "identitySource": "bioguide"}],
        "political_filings": [{"docId": "d2", "filerFirst": "A", "filerLast": "B", "sourceUrl": "u", "identitySource": "bioguide",
                               "extractionStatus": "ok", "failureReason": None, "memberId": "A000001",
                               "filingDate": date(2020, 5, 1), "chamber": "house"}],
    }
    for name, rows in tables.items():
        (root / "data" / name).mkdir(parents=True)
        pq.write_table(pa.Table.from_pylist(rows), root / "data" / name / "part-0.parquet")
    rows, info = trades.load(duckdb.connect(), root, {"A000001"})
    assert sorted((r["id"], r["version"], r["amended"]) for r in rows) == [("e1", 2, True), ("e2", 1, False)]
    e1 = next(r for r in rows if r["id"] == "e1")
    assert e1["owner"] == "spouse" and e1["action"] == "buy" and e1["available"] == date(2020, 4, 30) and e1["lag_days"] == 59
    assert e1["late"] is True and e1["ticker_source"] == "resolved"
    assert info["exclusions"]["superseded_event_versions"]["rows"] == 1


def test_traded_together_eligibility() -> None:
    companies = {"co:1": {"sic": 3571, "pooled_vehicle": False}, "co:2": {"sic": None, "pooled_vehicle": False}}
    base = {"ticker": "X", "date": date(2020, 1, 1), "action": "buy", "asset_class": "stock", "org": "co:1"}
    assert eligible(base, companies)
    assert not eligible({**base, "asset_class": "fund"}, companies)
    assert eligible({**base, "asset_class": "unknown"}, companies)
    assert not eligible({**base, "asset_class": "unknown", "org": "co:2"}, companies)
    assert not eligible({**base, "ticker": None}, companies)
    assert not eligible({**base, "date": None}, companies)
    assert not eligible({**base, "action": "exchange"}, companies)


def test_shuffles_permute_days_within_member_year_and_are_seeded() -> None:
    rows = [{"member": m, "org": f"co:{i}", "action": "buy", "day": d, "year": 2020 + d // 400}
            for i, (m, d) in enumerate([("A", 1), ("A", 5), ("A", 9), ("B", 2), ("B", 450)])]
    a = pa.concat_tables(list(shuffled(rows))).to_pylist()
    b = pa.concat_tables(list(shuffled(rows))).to_pylist()
    assert a == b
    for p in range(3):
        days = sorted(r["day"] for r in a if r["perm"] == p and r["member"] == "A")
        assert days == [1, 5, 9]
        assert {r["day"] for r in a if r["perm"] == p and r["member"] == "B"} == {2, 450}  # different years: never swapped
