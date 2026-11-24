"""Pieces of a member file (`members/<id>.json`) and trade file (`trades/<id>.json`). Data dictionary: "MemberFile",
"TradeFile", "Coverage". Pure functions; reads and writes nothing. `trade_file` also publishes the later House
printings folded into a trade (`amendments`), so both filings stay citable.

Coverage rule: one entry per year 2000..this year in which the member held office (a term ending on 3 January does
not count that year). Trades: n/a before the STOCK Act year; none before the chamber's first filing year in the
dataset; partial in that first year when it starts after January, in the current year, and in years with a failed
extraction of one of the member's filings; else full; the weaker level when both chambers were served that year. Money: the weaker level the money plug-ins declare for the
chamber(s) served, for members with an FEC id; else none.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from ..config import STOCK_ACT_YEAR
from ..contract import FAMILY_ORDER, TRADE_COLUMNS, Edge, Node, SpineMember, Term, Trade
from .budget import edge_size, num

LEVELS = ["full", "partial", "none"]


def trade_summary(ts: list[Trade]) -> dict[str, Any]:
    dates = [t["date"] for t in ts if t["date"]]
    return {"count": len(ts), "first": min(dates).isoformat() if dates else None,
            "last": max(dates).isoformat() if dates else None, "late": sum(bool(t["late"]) for t in ts),
            "by_year": dict(sorted(Counter(str(t["date"].year) if t["date"] else "none" for t in ts).items())),
            "by_owner": dict(sorted(Counter(t["owner"] for t in ts).items())),
            "by_action": dict(sorted(Counter(t["action"] for t in ts).items()))}


def node_info(ref: Node, orgs: dict[str, Any], spine: dict[str, SpineMember]) -> dict[str, Any]:
    if ref["kind"] == "member":
        return {"name": spine[ref["id"]]["name"], "kind": "member", "ticker": None}
    o = orgs[ref["id"]]
    return {"name": o["name"], "kind": o["kind"], "ticker": o["ticker"]}


def in_office(terms: list[Term], year: int) -> set[str]:
    """Chambers served in a year; a term ending on 3 January does not count for that year."""
    return {t["chamber"] for t in terms if t["start"] <= f"{year}-12-31" and t["end"] > f"{year}-01-03"}


def trade_coverage(chambers: set[str], year: int, chamber_cov: dict[str, Any], failed: set[int], this_year: int) -> str:
    if year < STOCK_ACT_YEAR or not chambers:
        return "n/a"
    levels = []
    for ch in chambers:
        first = date.fromisoformat(chamber_cov[ch]["first_filing"])
        if year < first.year:
            levels.append("none")
        elif (year == first.year and first.month > 1) or year == this_year or year in failed:
            levels.append("partial")
        else:
            levels.append("full")
    # why the weaker level: a year served in both chambers is only as complete as its least-covered part
    # (Markey 2013: House filings for 2013 are absent from the dataset, Senate ones present)
    return max(levels, key=LEVELS.index)


def coverage(m: SpineMember, chamber_cov: dict[str, Any], failed: set[int], money: dict[str, dict[str, str]],
             this_year: int) -> list[dict[str, Any]]:
    out = []
    for y in range(2000, this_year + 1):
        chambers = in_office(m["terms"], y)
        if not chambers:
            continue
        levels = [money[ch].get(str(y), "none") for ch in chambers] if m["fec_ids"] else ["none"]
        money_level = max(levels, key=LEVELS.index)
        out.append({"year": y, "trades": trade_coverage(chambers, y, chamber_cov, failed, this_year), "money": money_level})
    return out


def trade_row(t: Trade) -> list[Any]:
    vals = {**t, "date": t["date"].isoformat() if t["date"] else None,
            "available": t["available"].isoformat() if t["available"] else None,
            "low": num(t["low"]), "high": num(t["high"]), "doc": t["doc_id"]}
    return [vals[c] for c in TRADE_COLUMNS]


def trade_file(ts: list[Trade]) -> dict[str, Any]:
    """trades/<id>.json. `filings` covers every cited filing: each trade's own and each later printing folded into it."""
    filings = {t["doc_id"]: t["url"] for t in ts}
    later: dict[str, list[dict[str, Any]]] = {}
    for t in ts:
        for a in t.get("amendments") or []:
            filings[a["doc_id"]] = a["url"]
            later.setdefault(t["id"], []).append({"id": a["id"], "doc": a["doc_id"], "status": a["status"],
                                                  "available": a["available"].isoformat() if a["available"] else None})
    return {"cols": TRADE_COLUMNS, "rows": [trade_row(t) for t in ts], "filings": filings, "amendments": later}


def board_order(e: Edge, case_edges: set[str]) -> tuple[Any, ...]:
    """Map order: Case edges first, then by family (money, holding, people, context), then size."""
    return (e["id"] not in case_edges, FAMILY_ORDER[e["family"]], -edge_size(e), -e["count"], e["id"])
