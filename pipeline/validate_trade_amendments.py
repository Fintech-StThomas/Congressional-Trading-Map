"""Checks for amended, withheld-lag and deleted trades in trades/<id>.json (data dictionary: "TradeFile", "Rules the
pipeline must keep"). Called from validate.py; the rules themselves are pipeline/trade_amendments.py.

Per file (`check_trade_file`): the schema of `amendments`, `lag_withheld` and `not_counted`; every later filing
hangs under a published trade flagged amended, cites a different filing that has a URL, and is not public earlier
than the trade; a folded House printing is not also published as a trade, a later dataset version carries the
trade's own id; a lag is withheld exactly on the rows named in `lag_withheld` (`lag_null_is_valid`); a not-counted
row is listed, flagged amended and House.
Across files (`check_folding`): no member has two published trades with the same exact key in different filings
unless meta.json counts them, per member; the listed, deleted and withheld totals equal meta.json; the trades stage
did read the source's filing status; and, re-reading the source dataset from the download cache independently of
the trades stage, (a) every trade's `doc` and every later filing became public on the date published for it, (b) no
published House trade whose own row is marked Amended or Deleted still has an exact-key trade in exactly one
earlier filing (a missed fold), (c) a trade is in `not_counted` exactly when, counting its House printings in the
source, the Deleted ones cancel every live one (one each, a live printing no later than the Deleted one), and (d) a lag is withheld as `amended_unmatched` exactly when the trade's own
single-version House row is marked and both dates are present.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import duckdb

from .assemble.members import counted_rows
from .contract import TRADE_COLUMNS
from .trade_amendments import DELETED, MARKS, REPRINT, VERSION, WITHHELD, same_key_other_filing, trade_key
from .trades import available_date
from .util import CACHE

FILE_KEYS = {"cols", "rows", "filings", "amendments", "lag_withheld", "not_counted"}
FLAG_KEYS = {"flags", "flags_not_evaluated"}   # added by the assembler; required and checked by validate_flags.py
Files = dict[str, dict[str, Any]]                        # member id -> trades/<id>.json ({"rows": []} when none)
__all__ = ["check_folding", "check_trade_file", "counted_rows", "lag_null_is_valid"]
AMENDMENT_KEYS = {"id", "doc", "status", "available"}
Later = dict[str, dict[str, list[dict[str, Any]]]]      # member id -> TradeFile.amendments


def check_trade_file(c: Any, tf: dict[str, Any], where: str) -> None:
    c.check(set(tf) - FLAG_KEYS == FILE_KEYS, "schema", f"{where} keys")
    later = tf.get("amendments")
    c.check(isinstance(later, dict), "schema", f"{where}.amendments")
    if not isinstance(later, dict):
        return
    rows = {r[0]: dict(zip(TRADE_COLUMNS, r)) for r in tf.get("rows", []) if len(r) == len(TRADE_COLUMNS)}
    filings = tf.get("filings", {})
    withheld, gone = tf.get("lag_withheld"), tf.get("not_counted")
    c.check(isinstance(withheld, dict) and isinstance(gone, dict), "schema", f"{where}.lag_withheld / not_counted")
    for tid, why in (withheld if isinstance(withheld, dict) else {}).items():
        row = rows.get(tid)
        c.check(why in WITHHELD and row is not None and row["lag_days"] is None and row["late"] is None and row["amended"] is True
                and row["date"] is not None and row["available"] is not None,
                "lag_withheld: a listed amended trade with both dates and no lag", f"{where}:{tid}")
    for tid, why in (gone if isinstance(gone, dict) else {}).items():
        row = rows.get(tid)
        c.check(why == DELETED and row is not None and row["amended"] is True and tid.startswith("house:"),
                "not_counted: a listed House trade flagged amended", f"{where}:{tid}")
    for tid, printings in later.items():
        row = rows.get(tid)
        c.check(row is not None and row["amended"] is True and isinstance(printings, list) and len(printings) > 0,
                "amendments: listed under a published trade flagged amended", f"{where}:{tid}")
        if row is None or not isinstance(printings, list):
            continue
        for a in printings:
            ok = isinstance(a, dict) and set(a) == AMENDMENT_KEYS and a["status"] in (*MARKS, VERSION, REPRINT)
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


def lag_null_is_valid(row: dict[str, Any], tf: dict[str, Any]) -> bool:
    """`lag_days` is null iff a date is missing, or both dates are present and the file withholds the lag for a
    stated reason (`lag_withheld[id]`: the transaction date was corrected, or the row is an Amended House row whose
    original was not matched). Never 0 or negative in place of a withheld lag."""
    if row["date"] is None or row["available"] is None:
        return row["lag_days"] is None
    return (row["lag_days"] is None) == ((tf.get("lag_withheld") or {}).get(row["id"]) in WITHHELD)


def check_same_key(c: Any, published: Files, meta: dict[str, Any]) -> None:
    """Every listed row counts here, deleted or not: the same-key figure describes what the files show."""
    trades = [{"member": mid, **dict(zip(TRADE_COLUMNS, r))} for mid, tf in published.items() for r in tf.get("rows", [])]
    got = same_key_other_filing(trades, doc="doc")
    said = meta.get("reports", {}).get("hf_trades", {}).get("amendments", {}).get("same_key_other_filing", {})
    c.check(got["trades"] == meta.get("counts", {}).get("trades_same_key_other_filing")
            == meta.get("exclusions", {}).get("same_key_other_filing", {}).get("rows"),
            "same-key trades in different filings: the count in meta.json equals the published trade files", str(got["trades"]))
    c.check(got["members"] == said.get("members") and got["groups"] == said.get("groups"),
            "same-key trades in different filings: every member's pairs are counted in meta.json",
            str(sorted(set(got["members"].items()) ^ set((said.get("members") or {}).items()))[:3]))


def check_meta_counts(c: Any, published: Files, meta: dict[str, Any]) -> None:
    """Listed rows, not-counted rows and withheld lags (of counted rows) equal what meta.json says."""
    counts, excl, rep = meta.get("counts", {}), meta.get("exclusions", {}), meta.get("reports", {}).get("hf_trades", {})
    gone = sum(len(tf.get("not_counted") or {}) for tf in published.values())
    c.check(gone == counts.get("trades_deleted_by_later_filing") == excl.get(DELETED, {}).get("rows"),
            "not_counted: the deleted trades in the files equal meta.json", str(gone))
    listed = sum(len(tf.get("rows", [])) for tf in published.values())
    c.check(listed == rep.get("trades_written") and listed - gone == rep.get("trades_counted"),
            "not_counted: listed and counted rows equal the trades stage report", f"{listed} listed, {gone} not counted")
    for why, key in zip(WITHHELD, ("lag_withheld_date_corrected", "amended_rows_without_original")):
        n = sum(1 for tf in published.values() for tid, w in (tf.get("lag_withheld") or {}).items()
                if w == why and tid not in (tf.get("not_counted") or {}))
        c.check(n == counts.get(f"trades_lag_withheld_{why}") == excl.get(key, {}).get("rows"),
                "lag_withheld: the counted trades with a withheld lag equal meta.json", f"{why}: {n}")


def read_source(root: Path) -> tuple[dict[tuple[str, int], str] | None, dict[tuple[str, str], str | None], dict[str, Any] | None]:
    """From the cached dataset: the filing status of every marked House row, by (docId, rowIndex) (None when the
    column is gone); the Eastern date each filing became public, by (chamber, docId); and, per current House event,
    [status of its own row, number of versions, its printings as (public instant, docId, rowIndex, status)] (None
    when the source lacks the contributor list)."""
    con = duckdb.connect()
    src = lambda t: f"read_parquet('{root}/data/{t}/*.parquet')"  # noqa: E731
    cols = lambda t: {r[0] for r in con.execute(f"describe select * from {src(t)}").fetchall()}  # noqa: E731
    marks = events = None
    if "filingStatus" in cols("political_trades"):
        marks = {(d, i): s for d, i, s in con.execute(f"""select docId, rowIndex, filingStatus from {src('political_trades')}
            where chamber = 'house' and filingStatus in {MARKS}""").fetchall()}
        if "contributorRowIds" in cols("political_trade_events"):
            events = {e: [own, n, prints] for e, own, n, prints in con.execute(f"""
                with ev as (select *, count(*) over (partition by eventId) as n from {src('political_trade_events')}
                            qualify supersededAt is null),
                     pr as (select eventId, unnest(from_json(contributorRowIds, '["varchar"]')) as rid from ev where chamber = 'house')
                select ev.eventId, any_value(own.filingStatus), any_value(ev.n),
                       list((t.availableAt, t.docId, t.rowIndex, t.filingStatus)) filter (where t.docId is not null)
                from ev left join {src('political_trades')} own on own.chamber = 'house' and own.docId = ev.sourceDocId and own.rowIndex = ev.sourceRowIndex
                left join pr on pr.eventId = ev.eventId
                left join {src('political_trades')} t on t.chamber = 'house' and t.docId || ':' || t.rowIndex = pr.rid
                where ev.chamber = 'house' group by 1""").fetchall()}
    public = {(ch, d): (available_date(at).isoformat() if at else None) for ch, d, at in con.execute(
        f"select chamber, docId, availableAt from {src('political_filings')}").fetchall()}
    return marks, public, events


def no_live_printing_left(prints: Iterable[tuple[Any, ...]]) -> bool:
    """prints: (public instant, docId, rowIndex, status) of every House printing of one trade, from the source.
    Counts, without ordering same-instant filings: walking the Deleted printings oldest first, each takes one live
    printing that was public no later than it; the trade is deleted when there is a Deleted printing and every live
    one was taken."""
    live = sorted(p[0] for p in prints if p[3] != "Deleted" and p[0] is not None)
    undated_live = sum(1 for p in prints if p[3] != "Deleted" and p[0] is None)
    deleted = sorted((p[0] for p in prints if p[3] == "Deleted"), key=lambda at: (at is None, at))
    taken = 0
    for at in deleted:
        if undated_live:
            undated_live -= 1
        elif taken < len(live) and (at is None or live[taken] <= at):
            taken += 1
    return bool(deleted) and taken == len(live) and not undated_live


def check_against_source(c: Any, published: Files, marks: dict[tuple[str, int], str] | None,
                         public: dict[tuple[str, str], str | None], events: dict[str, Any] | None = None) -> None:
    c.check(marks is not None, "amendments: the source still carries the filing status column", "")
    for mid, tf in published.items():
        trades = [dict(zip(TRADE_COLUMNS, r)) for r in tf.get("rows", [])]
        later, withheld, gone = (tf.get(k) or {} for k in ("amendments", "lag_withheld", "not_counted"))
        same: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
        for t in trades:
            same[trade_key(t)].append(t)
            chamber = t["id"].split(":", 1)[0]
            c.check((chamber, t["doc"]) in public and public[(chamber, t["doc"])] == t["available"],
                    "trade doc is the filing that became public on `available`", f"{mid}:{t['id']}")
            for a in later.get(t["id"], []):
                c.check(public.get((chamber, a["doc"]), "") == a["available"],
                        "amendments: the later filing became public on its `available`", f"{mid}:{t['id']}:{a['doc']}")
            if events is not None and t["id"] in events:        # (c) and (d): House trades, straight from the source
                own, n_versions, prints = events[t["id"]]
                folded = [p for a in later.get(t["id"], []) for p in (events.get(a["id"], [0, 0, []])[2] or [])]
                c.check((t["id"] in gone) == no_live_printing_left({(p[1], p[2]): p for p in [*(prints or []), *folded]}.values()),
                        "not_counted: exactly the trades whose Deleted printings in the source cancel every live one", f"{mid}:{t['id']}")
                unmatched = own in MARKS and n_versions == 1 and t["date"] is not None and t["available"] is not None
                c.check((withheld.get(t["id"]) == "amended_unmatched") == unmatched,
                        "lag_withheld: amended_unmatched exactly on single-version House rows the source marks", f"{mid}:{t['id']}")
        for t in trades:
            doc, _, row = t["id"].partition(":")[2].rpartition(":")
            if not (t["id"].startswith("house:") and t["version"] == 1 and row.isdigit() and (marks or {}).get((doc, int(row)))):
                continue
            earlier = {o["doc"] for o in same[trade_key(t)] if o["doc"] != t["doc"] and o["available"] and t["available"]
                       and (o["available"], o["doc"]) < (t["available"], t["doc"])
                       and t["doc"] not in {a["doc"] for a in later.get(o["id"], [])}}
            c.check(len(earlier) != 1, "amendments: a marked House row with one exact earlier filing was folded", f"{mid}:{t['id']}")


def check_folding(c: Any, published: Files, meta: dict[str, Any], out: Path, cache: Path = CACHE) -> None:
    """published: member id -> trades/<id>.json as read by validate.py. `out` is kept for callers; nothing is re-read."""
    check_same_key(c, published, meta)
    check_meta_counts(c, published, meta)
    rep = meta.get("reports", {}).get("hf_trades", {})
    house = any(str(r[0]).startswith("house:") for tf in published.values() for r in tf.get("rows", []))
    c.check(not house or (rep.get("filing_status_in_source") is True and rep.get("amendments", {}).get("marked_rows", 0) > 0),
            "amendments: the trades stage read the source's filing status (House trades exist, some rows are marked)", "")
    root = cache / "hf" / str(meta.get("sources", {}).get("hf_trades", {}).get("revision"))
    found = (root / "data" / "political_trades").is_dir() and (root / "data" / "political_filings").is_dir()
    c.check(found, "amendments: the trades dataset is in the download cache for the independent check", str(root))
    if found:
        check_against_source(c, published, *read_source(root))
