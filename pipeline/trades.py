"""Trades from the Hugging Face dataset austin-starks/congressional-stock-trades.

Pins the dataset revision, verifies each parquet file against snapshot.json, keeps the current
version of every trade event, maps raw values to the contract enums with explicit tables, and
writes pipeline/build/trades.parquet (one row per current event, org not yet resolved).
"""
from __future__ import annotations

import os
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import requests

from .util import BUILD, CACHE, fetch, print_table, read_json, sha256_file, write_source_meta

DATASET = "austin-starks/congressional-stock-trades"
API = f"https://huggingface.co/api/datasets/{DATASET}"
SOURCE_ID = "hf_trades"
TABLES = ("political_trade_events", "political_trades", "political_filings")
DOCS = ("README.md", "METHODOLOGY.md", "LICENSE_DATA.md", "snapshot.json")
LATE_DAYS = 45
EASTERN = ZoneInfo("America/New_York")

OWNER = {"self": "self", "spouse": "spouse", "joint": "joint", "dependent_child": "dependent",
         "not_indicated": "unspecified"}
ACTION = {"purchase": "buy", "sale": "sell", "exchange": "exchange", "unmarked": "other"}
# House asset type codes (Clerk PTR instructions). Codes not listed map to "unknown".
HOUSE_ASSET = {
    "ST": "stock", "RS": "stock",                       # stocks incl. ADRs; restricted stock units
    "OP": "option", "SA": "option",                     # options; stock appreciation rights
    "EF": "fund", "MF": "fund", "HE": "fund", "HN": "fund", "RE": "fund",  # ETFs, mutual, hedge/PE funds, REITs
    "CS": "bond", "GS": "bond", "AB": "bond", "ET": "bond",  # corporate, government, asset-backed, ETNs
    "CT": "crypto",
    "PS": "private", "OI": "private", "OL": "private",  # non-public stock; ownership interests
    "OT": "other", "VA": "other", "FU": "other", "FE": "other", "PM": "other", "MO": "other",
}
# Senate eFD asset type labels.
SENATE_ASSET = {
    "Stock": "stock", "Stock Option": "option", "Corporate Bond": "bond", "Municipal Security": "bond",
    "Mutual Fund": "fund", "Cryptocurrency": "crypto", "Non-Public Stock": "private",
    "Other": "other", "Commodities/Futures Contract": "other",
}


def pinned_revision() -> str:
    """HF_REVISION env var if set, else the dataset's current commit SHA."""
    if os.environ.get("HF_REVISION"):
        return os.environ["HF_REVISION"]
    r = requests.get(API, timeout=60)
    r.raise_for_status()
    return r.json()["sha"]


def download(revision: str) -> tuple[Path, list[dict[str, Any]]]:
    """Fetch docs and parquet files for a revision into the cache; verify sha256 from snapshot.json."""
    root = CACHE / "hf" / revision
    base = f"https://huggingface.co/datasets/{DATASET}/resolve/{revision}"
    tree = requests.get(f"{API}/revision/{revision}", timeout=60)
    tree.raise_for_status()
    paths = sorted(s["rfilename"] for s in tree.json()["siblings"]
                   if s["rfilename"].endswith(".parquet") or s["rfilename"] in DOCS)
    files = []
    for p in paths:
        meta = fetch(f"{base}/{p}", root / p)
        files.append({"path": p, "bytes": meta["bytes"], "sha256": meta["sha256"], "retrieved": meta["retrieved"]})
    expected = {f["publicPath"]: f["sha256"] for t in read_json(root / "snapshot.json")["tables"].values()
                for m in t["manifests"] for f in m["files"]}
    for f in files:
        if f["path"] in expected and expected[f["path"]] != f["sha256"]:
            raise RuntimeError(f"sha256 mismatch for {f['path']}; delete {root} and retry")
    return root, files


def asset_class(chamber: str, code: str | None, label: str | None) -> str:
    if chamber == "house":
        return HOUSE_ASSET.get(code, "unknown") if code else "unknown"
    return SENATE_ASSET.get(label, "unknown") if label else "unknown"


def available_date(ts: datetime | None) -> date | None:
    """availableAt is a UTC instant (end of an Eastern-time day); convert to the Eastern date."""
    return None if ts is None else ts.replace(tzinfo=timezone.utc).astimezone(EASTERN).date()


def map_row(r: dict[str, Any]) -> dict[str, Any]:
    action = ACTION.get(r["action"], "other")
    avail = available_date(r["availableAt"])
    lag = (avail - r["transactionDate"]).days if avail and r["transactionDate"] else None
    return {
        "id": r["eventId"], "member": r["memberId"], "chamber": "sen" if r["chamber"] == "senate" else "rep",
        "version": r["version"], "amended": r["n_versions"] > 1,
        "date": r["transactionDate"], "available": avail, "lag_days": lag,
        "late": None if lag is None else lag > LATE_DAYS,
        "owner": OWNER.get(r["owner"], "unspecified"), "owner_raw": r["owner"],
        "action": action, "action_raw": r["action"],
        "partial": r["partialSale"] if action == "sell" else None,
        "ticker": r["ticker"], "ticker_source": r["ticker_source"],
        "asset": r["assetDescription"] or "",
        "asset_class": asset_class(r["chamber"], r["assetTypeCode"], r["assetTypeLabel"]),
        "asset_type_raw": r["assetTypeCode"] or r["assetTypeLabel"],
        "low": r["amountLow"], "high": r["amountHigh"], "url": r["sourceUrl"], "doc_id": r["sourceDocId"],
    }


def load(con: duckdb.DuckDBPyConnection, root: Path, spine_ids: set[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    for t in TABLES:
        con.execute(f"create or replace view {t} as select * from read_parquet('{root}/data/{t}/*.parquet')")
    one = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
    counts = {t: one(f"select count(*) from {t}") for t in TABLES}
    con.execute("""create or replace temp table cur as
        select e.*, count(*) over (partition by e.eventId) as n_versions
        from political_trade_events e qualify e.supersededAt is null""")
    n_cur = one("select count(*) from cur")
    n_events = one("select count(distinct eventId) from political_trade_events")
    if n_cur != n_events:
        raise AssertionError(f"{n_events} events but {n_cur} current versions")
    # Bring the dataset's ticker provenance from the printed trade row; must be 1:1.
    con.execute("""create or replace temp table cur2 as
        select c.*, case t.resolutionStatus when 'printed' then 'printed' when 'resolved' then 'resolved' end as ticker_source
        from cur c left join political_trades t on t.docId = c.sourceDocId and t.rowIndex = c.sourceRowIndex""")
    if one("select count(*) from cur2") != n_cur:
        raise AssertionError("join to political_trades multiplied rows")
    rows = [dict(zip([d[0] for d in con.description], r)) for r in con.execute("select * from cur2 order by eventId").fetchall()]
    kept = [r for r in rows if r["memberId"] in spine_ids]
    not_in_spine = Counter(r["memberId"] for r in rows if r["memberId"] not in spine_ids)

    exclusions = {
        "superseded_event_versions": {
            "rows": one("select count(*) from political_trade_events where supersededAt is not null"),
            "reason": "older versions of amended events; the current version is kept and flagged amended"},
        "trade_rows_folded_into_events": {
            "rows": counts["political_trades"] - one("select count(*) from political_trades where identitySource in ('non_member','unresolved')") - n_cur,
            "reason": "repeat printings of the same economic trade (duplicate filings, amendments) folded by the dataset into one event"},
        "non_member_trade_rows": {
            "rows": one("select count(*) from political_trades where identitySource = 'non_member'"),
            "filings": [list(r) for r in con.execute("""select docId, filerFirst || ' ' || filerLast, sourceUrl from political_filings
                         where identitySource = 'non_member' order by docId""").fetchall()],
            "reason": "filer never served in Congress (staff, candidates); the dataset gives them no events"},
        "unresolved_identity_trade_rows": {
            "rows": one("select count(*) from political_trades where identitySource = 'unresolved'"),
            "reason": "filer could not be matched to a member"},
        "failed_extraction_filings": {
            "rows": one("select count(*) from political_filings where extractionStatus = 'failed'"),
            "filings": [list(r) for r in con.execute("""select docId, filerFirst || ' ' || filerLast, failureReason, sourceUrl
                         from political_filings where extractionStatus = 'failed' order by docId""").fetchall()],
            "reason": "the dataset could not extract the filing with confidence; it contributes no trades"},
        "events_member_not_in_spine": {
            "rows": sum(not_in_spine.values()), "members": sorted(not_in_spine),
            "reason": "memberId not found among people with a term since 2000"},
    }
    coverage = {("sen" if ch == "senate" else "rep"): {"first_filing": lo.isoformat(), "last_filing": hi.isoformat()}
                for ch, lo, hi in con.execute("""select chamber, min(filingDate), max(filingDate) from political_filings
                                                  where extractionStatus = 'ok' group by 1""").fetchall()}
    failed = [{"member": m, "year": d.year, "doc": doc} for m, d, doc in con.execute(
        "select memberId, filingDate, docId from political_filings where extractionStatus = 'failed' order by docId").fetchall()]
    return [map_row(r) for r in kept], {"table_rows": counts, "current_events": n_cur, "exclusions": exclusions,
                                        "coverage": coverage, "failed_filings": failed}


SCHEMA = pa.schema([
    ("id", pa.string()), ("member", pa.string()), ("chamber", pa.string()), ("version", pa.int32()),
    ("amended", pa.bool_()), ("date", pa.date32()), ("available", pa.date32()), ("lag_days", pa.int32()),
    ("late", pa.bool_()), ("owner", pa.string()), ("owner_raw", pa.string()), ("action", pa.string()),
    ("action_raw", pa.string()), ("partial", pa.bool_()), ("ticker", pa.string()), ("ticker_source", pa.string()),
    ("asset", pa.string()), ("asset_class", pa.string()), ("asset_type_raw", pa.string()),
    ("low", pa.float64()), ("high", pa.float64()), ("url", pa.string()), ("doc_id", pa.string()),
])


def report(trades: list[dict[str, Any]]) -> dict[str, Any]:
    def bucket(field: str, raw: str) -> list[tuple[str, str, int]]:
        c = Counter((t[raw], t[field]) for t in trades)
        return sorted(((str(k[0]), k[1], n) for k, n in c.items()), key=lambda x: (x[1], -x[2]))
    tables = {"owner": bucket("owner", "owner_raw"), "action": bucket("action", "action_raw"),
              "asset_class": bucket("asset_class", "asset_type_raw")}
    for name, rows in tables.items():
        print_table(f"{name}: raw value -> contract bucket", rows, ("raw", name, "rows"))
    by_cy = Counter((t["chamber"], t["date"].year if t["date"] else None) for t in trades)
    years = sorted({y for _, y in by_cy if y is not None}) + [None]
    print_table("current events per chamber per transaction year", [
        (y, by_cy.get(("rep", y), 0), by_cy.get(("sen", y), 0)) for y in years], ("year", "rep", "sen"))
    lags = [t["lag_days"] for t in trades if t["lag_days"] is not None]
    return {
        "buckets": {k: [list(r) for r in v] for k, v in tables.items()},
        "events_per_chamber_year": {f"{c}:{y}": n for (c, y), n in sorted(by_cy.items(), key=lambda x: (x[0][0], x[0][1] or 0))},
        "null_ticker": sum(t["ticker"] is None for t in trades),
        "ticker_source": dict(Counter(str(t["ticker_source"]) for t in trades)),
        "null_owner_label": sum(t["owner"] == "unspecified" for t in trades),
        "null_date": sum(t["date"] is None for t in trades),
        "null_amount": sum(t["low"] is None and t["high"] is None for t in trades),
        "open_ended_amount": sum(t["low"] is not None and t["high"] is None for t in trades),
        "late": sum(bool(t["late"]) for t in trades), "negative_lag": sum(x < 0 for x in lags),
        "before_2012_07": sum(1 for t in trades if t["date"] and t["date"] < date(2012, 7, 1)),
        "amended": sum(t["amended"] for t in trades),
    }


def run() -> None:
    revision = pinned_revision()
    root, files = download(revision)
    spine_ids = set(read_json(BUILD / "spine.json"))
    con = duckdb.connect()
    trades, info = load(con, root, spine_ids)
    pq.write_table(pa.Table.from_pylist(trades, schema=SCHEMA), BUILD / "trades.parquet")
    rep = {**info, **report(trades), "trades_written": len(trades)}
    print(f"\nrows per table: {info['table_rows']}; current events kept: {len(trades)}")
    for k in ("null_ticker", "ticker_source", "null_owner_label", "null_date", "null_amount", "open_ended_amount",
              "late", "negative_lag", "before_2012_07", "amended"):
        print(f"  {k}: {rep[k]}")
    print_table("exclusions", [(k, v["rows"], v["reason"]) for k, v in info["exclusions"].items()],
                ("what", "rows", "why"))
    snap = read_json(root / "snapshot.json")
    write_source_meta(SOURCE_ID, {SOURCE_ID: {
        "name": f"Hugging Face {DATASET}", "url": f"https://huggingface.co/datasets/{DATASET}",
        "revision": revision, "retrieved": min(f["retrieved"] for f in files),
        "snapshot_generated": snap.get("generatedAt"), "legislators_commit": snap.get("identity", {}).get("legislatorsCommit"),
        "licence": "Public-record data; use restricted by 5 U.S.C. 13107(c), see the dataset's LICENSE_DATA.md",
        "files": files,
    }}, rep)
