"""Amended trade reports: one trade per transaction, timed from its earliest public filing (data dictionary: "Trade",
"Rules the pipeline must keep"). Pure functions; reads and writes nothing. Called from pipeline/trades.py.

What the source carries. `political_trades.filingStatus` is, on e-filed House PTRs, the "Filing Status: New | Amended
| Deleted" the Clerk prints under each transaction (Amended and Deleted rows also print a transaction ID,
`sourceTransactionId`; originals print none). On scanned and some text filings it is the dataset's reading of a
filing-level statement that the report amends an earlier one (no ID). The dataset often gives such a reprint its
own event, so one trade was counted twice and the copy looked as if it became public months after the trade.

House reprints (`fold`; exact signals only, never similarity). A current House event whose row is so marked is
folded into an earlier-public current event of the same member in a different filing when either
  (a) both carry the same House transaction ID, or
  (b) every field of the exact key is equal: member, transaction date, owner, action, amount low and high, ticker,
      and the asset text with only its bracketed asset-type code and surrounding spaces removed,
and exactly one earlier filing qualifies (candidates in several are left alone and counted). Rule (b) cannot tell
which of several identical rows of that filing is restated (it pairs them one to one) and cannot link an amendment
that changes a key field: such a row stays a trade of its own and is counted. Rows of multi-version events are not
key-matched. The folded trade keeps the earlier event's id, filing and first public date; its other fields are the
latest printing's; every later printing is listed in `amendments`. Unmarked same-key trades in different filings
are never merged; `same_key_other_filing` counts them.

Dataset versions (`apply_versions`). A multi-version event is cited and timed from its earliest version's filing;
later versions' filings are listed in `amendments` with status "Version". When the transaction date differs between
the earliest and the current version the lag is withheld (`date_corrected`), as it is when it would be negative.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Iterable, Mapping

MARKS = ("Amended", "Deleted")          # filing-status values that say "this row restates an earlier report"
VERSION = "Version"                     # amendments[].status of a later version of the same dataset event
_ASSET_CODE = re.compile(r"\s*\[[A-Za-z]{2}\]\s*")
RAW_KEY = ("memberId", "transactionDate", "owner", "action", "amountLow", "amountHigh", "ticker")
TRADE_KEY = ("date", "owner", "action", "low", "high", "ticker")
COUNTERS = ("marked_rows", "folded_amended", "folded_deleted", "folded_by_exact_key", "folded_by_transaction_id",
            "folded_with_printed_transaction_id", "folded_on_filing_level_amendment", "amended_without_original",
            "deleted_without_original", "original_ambiguous", "marked_already_versioned")

REASONS = {
    "amended_reprints_folded":
        "House rows the filing marks Amended or Deleted that restate, field for field (or by the same House "
        "transaction ID), a trade the member reported in an earlier filing; counted once, timed from the earliest "
        "public filing, later filings listed under the trade's amendments",
    "amended_rows_without_original":
        "House rows the filing marks Amended or Deleted with no exactly matching earlier trade; kept as their own "
        "trade, flagged amended, timed from the amending filing (rows = kept, not excluded)",
    "lag_withheld_date_corrected":
        "trades whose transaction date was corrected by a later version (or whose first public date would precede "
        "the transaction date): the first public filing showed another date, so lag_days and late are null; the "
        "trade is kept and counted apart in delays.json (rows = kept, not excluded)",
    "same_key_other_filing":
        "trades identical in every key field to a trade of the same member in a different filing, with no filed "
        "mark linking them; both are kept, never merged (rows = kept, not excluded)",
}


def asset_text(s: str | None) -> str:
    """Asset text as filed, minus the bracketed asset-type code (`[ST]`, `[OP]`, ...) and outer whitespace."""
    return _ASSET_CODE.sub(" ", s or "").strip()


def raw_key(r: Mapping[str, Any]) -> tuple[Any, ...]:
    return (*(r[k] for k in RAW_KEY), asset_text(r["assetDescription"]))


def trade_key(t: Mapping[str, Any]) -> tuple[Any, ...]:
    """The same key on a mapped or published trade (the member is the file or the `member` field)."""
    return (*(str(t[k]) if k == "date" and t[k] is not None else t[k] for k in TRADE_KEY), asset_text(t["asset"]))


def is_marked(r: Mapping[str, Any]) -> bool:
    return r["chamber"] == "house" and r.get("filing_status") in MARKS


def _order(r: Mapping[str, Any]) -> tuple[Any, ...]:
    return (r["first_available_at"] or datetime.max, str(r["sourceDocId"]), r["sourceRowIndex"] or 0, r["eventId"])


def apply_versions(r: dict[str, Any], versions: list[dict[str, Any]] | None) -> dict[str, Any]:
    """versions: every version of r's event, earliest public first, each {doc, row, url, at, date}. Cite and time
    the event from the earliest version's filing and list the later filings."""
    r = {**r, "amendments": [], "date_corrected": False}
    if not versions or len(versions) < 2:
        return r
    first, seen = versions[0], {versions[0]["doc"]}
    for v in versions[1:]:
        if v["doc"] not in seen:
            seen.add(v["doc"])
            r["amendments"].append({"id": r["eventId"], "doc_id": v["doc"], "url": v["url"], "available_at": v["at"],
                                    "status": VERSION})
    return {**r, "sourceDocId": first["doc"], "sourceRowIndex": first["row"], "sourceUrl": first["url"],
            "first_available_at": first["at"], "date_corrected": first["date"] != r["transactionDate"]}


def fold(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """rows: current events after apply_versions, with eventId, chamber, n_versions, sourceDocId, sourceRowIndex,
    sourceUrl, first_available_at, filing_status, transaction_id and the key fields. Returns the kept rows (each
    with `amendments`, oldest first) and counters. A group is [first printing, latest printing, amendments,
    filings already absorbed]."""
    groups: list[list[Any]] = []
    by_key: dict[tuple[Any, ...], list[list[Any]]] = defaultdict(list)
    by_tid: dict[str, list[Any]] = {}
    n: Counter[str] = Counter()
    for r in sorted(rows, key=_order):
        target, tid = None, r.get("transaction_id")
        if is_marked(r):
            n["marked_rows"] += 1
            same_id = by_tid.get(tid) if tid else None
            if same_id is not None and same_id[0]["memberId"] == r["memberId"] and r["sourceDocId"] not in same_id[3]:
                target = same_id
                n["folded_by_transaction_id"] += 1
            elif r["n_versions"] > 1:
                n["marked_already_versioned"] += 1          # the dataset already tied it to its original
            elif r["first_available_at"] is not None:
                found = [g for g in by_key[raw_key(r)] if r["sourceDocId"] not in g[3] and g[0]["first_available_at"] is not None]
                if len({g[0]["sourceDocId"] for g in found}) == 1:
                    target = found[0]
                    n["folded_by_exact_key"] += 1
                elif found:
                    n["original_ambiguous"] += 1
        if target is None:
            if is_marked(r) and r["n_versions"] == 1:
                n[f"{r['filing_status'].lower()}_without_original"] += 1
            target = [r, r, list(r["amendments"]), {r["sourceDocId"]} | {a["doc_id"] for a in r["amendments"]}]
            groups.append(target)
        else:
            n[f"folded_{r['filing_status'].lower()}"] += 1
            n["folded_with_printed_transaction_id" if tid else "folded_on_filing_level_amendment"] += 1
            target[1] = r
            target[2].append({"id": r["eventId"], "doc_id": r["sourceDocId"], "url": r["sourceUrl"],
                              "available_at": r["first_available_at"], "status": r["filing_status"]})
            target[2].extend(r["amendments"])
            target[3].add(r["sourceDocId"])
        if target not in by_key[raw_key(r)]:
            by_key[raw_key(r)].append(target)
        if tid and r["chamber"] == "house":
            by_tid.setdefault(tid, target)
    kept = [{**latest, **{k: first[k] for k in ("eventId", "version", "n_versions", "sourceDocId", "sourceRowIndex",
                                                "sourceUrl", "first_available_at")},
             "amendments": later, "marked": is_marked(first) or any(a["status"] in MARKS for a in later),
             "date_corrected": first["date_corrected"] or latest["date_corrected"]
                               or first["transactionDate"] != latest["transactionDate"]}
            for first, latest, later, _ in groups]
    return sorted(kept, key=lambda r: r["eventId"]), {k: n[k] for k in COUNTERS}


def same_key_other_filing(trades: Iterable[Mapping[str, Any]], doc: str = "doc_id") -> dict[str, Any]:
    """Trades sharing the exact key with a trade of the same member in a different filing (after folding)."""
    docs: dict[tuple[Any, ...], set[str]] = defaultdict(set)
    size: Counter[tuple[Any, ...]] = Counter()
    for t in trades:
        k = (t["member"], *trade_key(t))
        docs[k].add(t[doc])
        size[k] += 1
    hit = [k for k, d in docs.items() if len(d) > 1]
    members: Counter[str] = Counter()
    for k in hit:
        members[k[0]] += size[k]
    return {"trades": sum(size[k] for k in hit), "groups": len(hit), "members": dict(sorted(members.items()))}
