"""Checks for amended trades in trades/<id>.json (data dictionary: "TradeFile", "Rules the pipeline must keep").
Called from validate.py; the folding itself is pipeline/trade_amendments.py.

Per file (`check_trade_file`): the schema of `amendments`; every later filing hangs under a published trade flagged
amended, cites a different filing that has a URL, and is not public earlier than the trade; a folded House printing
is not also published as a trade, a later dataset version carries the trade's own id.
Across files (`check_folding`): no member has two published trades with the same exact key in different filings
unless meta.json counts them, per member; the trades stage did read the source's filing status; and, re-reading the
source dataset from the download cache independently of the trades stage, (a) every trade's `doc` and every later
filing became public on the date published for it, and (b) no published House trade whose own row is marked Amended
or Deleted still has an exact-key trade in exactly one earlier filing (which would be a missed fold).
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

import duckdb

from .contract import TRADE_COLUMNS
from .trade_amendments import MARKS, VERSION, same_key_other_filing, trade_key
from .trades import available_date
from .util import CACHE, read_json

FILE_KEYS = {"cols", "rows", "filings", "amendments"}
AMENDMENT_KEYS = {"id", "doc", "status", "available"}
Later = dict[str, dict[str, list[dict[str, Any]]]]      # member id -> TradeFile.amendments


def check_trade_file(c: Any, tf: dict[str, Any], where: str) -> None:
    c.check(set(tf) == FILE_KEYS, "schema", f"{where} keys")
    later = tf.get("amendments")
    c.check(isinstance(later, dict), "schema", f"{where}.amendments")
    if not isinstance(later, dict):
        return
    rows = {r[0]: dict(zip(TRADE_COLUMNS, r)) for r in tf.get("rows", []) if len(r) == len(TRADE_COLUMNS)}
    filings = tf.get("filings", {})
    for tid, printings in later.items():
        row = rows.get(tid)
        c.check(row is not None and row["amended"] is True and isinstance(printings, list) and len(printings) > 0,
                "amendments: listed under a published trade flagged amended", f"{where}:{tid}")
        if row is None or not isinstance(printings, list):
            continue
        for a in printings:
            ok = isinstance(a, dict) and set(a) == AMENDMENT_KEYS and a["status"] in (*MARKS, VERSION)
            c.check(ok, "amendments: entry schema", f"{where}:{tid}")
            if not ok:
                continue
            c.check(a["doc"] in filings and a["doc"] != row["doc"],
                    "amendments: the later filing has a URL and is not the trade's own filing", f"{where}:{tid}")
            c.check(a["id"] == tid if a["status"] == VERSION else a["id"] not in rows,
                    "amendments: a folded printing is not also a published trade; a later version has the trade's id",
                    f"{where}:{a['id']}")
            c.check(a["available"] is None or row["available"] is None or a["available"] >= row["available"],
                    "amendments: the trade is timed from its earliest public filing", f"{where}:{tid}")


def check_same_key(c: Any, published: dict[str, list[list[Any]]], meta: dict[str, Any]) -> None:
    """published: member id -> rows of trades/<id>.json."""
    trades = [{"member": mid, **dict(zip(TRADE_COLUMNS, r))} for mid, rows in published.items() for r in rows]
    got = same_key_other_filing(trades, doc="doc")
    said = meta.get("reports", {}).get("hf_trades", {}).get("amendments", {}).get("same_key_other_filing", {})
    c.check(got["trades"] == meta.get("counts", {}).get("trades_same_key_other_filing")
            == meta.get("exclusions", {}).get("same_key_other_filing", {}).get("rows"),
            "same-key trades in different filings: the count in meta.json equals the published trade files", str(got["trades"]))
    c.check(got["members"] == said.get("members") and got["groups"] == said.get("groups"),
            "same-key trades in different filings: every member's pairs are counted in meta.json",
            str(sorted(set(got["members"].items()) ^ set((said.get("members") or {}).items()))[:3]))


def read_source(root: Path) -> tuple[dict[tuple[str, int], str] | None, dict[tuple[str, str], str | None]]:
    """From the cached dataset: the filing status of every marked House row, by (docId, rowIndex) (None when the
    column is gone), and the Eastern date each filing became public, by (chamber, docId)."""
    con = duckdb.connect()
    src = lambda t: f"read_parquet('{root}/data/{t}/*.parquet')"  # noqa: E731
    marks = None
    if "filingStatus" in {r[0] for r in con.execute(f"describe select * from {src('political_trades')}").fetchall()}:
        marks = {(d, i): s for d, i, s in con.execute(f"""select docId, rowIndex, filingStatus from {src('political_trades')}
            where chamber = 'house' and filingStatus in {MARKS}""").fetchall()}
    public = {(ch, d): (available_date(at).isoformat() if at else None) for ch, d, at in con.execute(
        f"select chamber, docId, availableAt from {src('political_filings')}").fetchall()}
    return marks, public


def check_against_source(c: Any, published: dict[str, list[list[Any]]], later: Later,
                         marks: dict[tuple[str, int], str] | None, public: dict[tuple[str, str], str | None]) -> None:
    c.check(marks is not None, "amendments: the source still carries the filing status column", "")
    for mid, rows in published.items():
        trades = [dict(zip(TRADE_COLUMNS, r)) for r in rows]
        same: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
        for t in trades:
            same[trade_key(t)].append(t)
            chamber = t["id"].split(":", 1)[0]
            c.check((chamber, t["doc"]) in public and public[(chamber, t["doc"])] == t["available"],
                    "trade doc is the filing that became public on `available`", f"{mid}:{t['id']}")
            for a in later.get(mid, {}).get(t["id"], []):
                c.check(public.get((chamber, a["doc"]), "") == a["available"],
                        "amendments: the later filing became public on its `available`", f"{mid}:{t['id']}:{a['doc']}")
        for t in trades:
            doc, _, row = t["id"].partition(":")[2].rpartition(":")
            if not (t["id"].startswith("house:") and t["version"] == 1 and row.isdigit() and (marks or {}).get((doc, int(row)))):
                continue
            earlier = {o["doc"] for o in same[trade_key(t)] if o["doc"] != t["doc"] and o["available"] and t["available"]
                       and (o["available"], o["doc"]) < (t["available"], t["doc"])
                       and t["doc"] not in {a["doc"] for a in later.get(mid, {}).get(o["id"], [])}}
            c.check(len(earlier) != 1, "amendments: a marked House row with one exact earlier filing was folded", f"{mid}:{t['id']}")


def check_folding(c: Any, published: dict[str, list[list[Any]]], meta: dict[str, Any], out: Path, cache: Path = CACHE) -> None:
    check_same_key(c, published, meta)
    rep = meta.get("reports", {}).get("hf_trades", {})
    house = any(str(r[0]).startswith("house:") for rows in published.values() for r in rows)
    c.check(not house or (rep.get("filing_status_in_source") is True and rep.get("amendments", {}).get("marked_rows", 0) > 0),
            "amendments: the trades stage read the source's filing status (House trades exist, some rows are marked)", "")
    root = cache / "hf" / str(meta.get("sources", {}).get("hf_trades", {}).get("revision"))
    found = (root / "data" / "political_trades").is_dir() and (root / "data" / "political_filings").is_dir()
    c.check(found, "amendments: the trades dataset is in the download cache for the independent check", str(root))
    if found:
        later = {mid: read_json(out / "trades" / f"{mid}.json").get("amendments", {}) for mid, rows in published.items() if rows}
        check_against_source(c, published, later, *read_source(root))
