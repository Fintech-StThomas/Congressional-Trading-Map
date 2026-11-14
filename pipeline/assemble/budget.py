"""Publication budget: which ties are published as full Edges and which as ledger rows (data dictionary:
"Publication budget"). Pure functions over edges; reads and writes nothing.

- Member file: every non-money edge except LEDGER_ONLY_TYPES, every Case edge, and the MONEY_EDGES_PER_MEMBER largest
  money edges are full Edges; other money ties are ledger rows (all for current members, the largest
  FORMER_MEMBER_LEDGER_ROWS for former members). `ledger_totals` always covers every tie that is not a full edge.
- Org file: every non-money tie and the money ties of the MONEY_MEMBERS_PER_ORG members with the largest money totals.
Size of a tie = amount.exact, else high, else low (FEC money is exact; trade ranges have no exact).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Iterable

from ..config import LEDGER_ONLY_TYPES, MONEY_EDGES_PER_MEMBER, MONEY_MEMBERS_PER_ORG
from ..contract import MEMBER_LEDGER_COLS, ORG_TIE_COLS, Edge
from ..edges import sum_amounts

Table = dict[str, list[Any]]   # {"cols": [...], "rows": [[...], ...]}


def num(x: float | None) -> float | int | None:
    """Whole-dollar floats as ints for compact JSON."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def edge_size(e: Edge) -> float:
    a = e["amount"]
    return a["exact"] or a["high"] or a["low"] or 0.0


def rank(edges: Iterable[Edge]) -> list[Edge]:
    """Largest first, then most records, then id (a total order, so output is stable)."""
    return sorted(edges, key=lambda e: (-edge_size(e), -e["count"], e["id"]))


def member_end(e: Edge) -> str:
    """The member endpoint of a member-org edge."""
    return e["to"]["id"] if e["to"]["kind"] == "member" else e["from"]["id"]


def split_member_edges(mid: str, edges: list[Edge], case_edges: set[str]) -> tuple[list[Edge], list[Edge], list[Edge]]:
    """(full edges, money ledger edges largest first, ledger-only context edges) for one member."""
    money = rank(e for e in edges if e["family"] == "money" and e["id"] not in case_edges)
    ledger_types = set(LEDGER_ONLY_TYPES)
    full_ids = {e["id"] for e in edges if (e["family"] != "money" and e["type"] not in ledger_types) or e["id"] in case_edges}
    full_ids |= {e["id"] for e in money[:MONEY_EDGES_PER_MEMBER]}
    context = sorted((e for e in edges if e["type"] in ledger_types), key=lambda e: (-e["count"], e["id"]))
    return [e for e in edges if e["id"] in full_ids], money[MONEY_EDGES_PER_MEMBER:], context


def member_ledger(mid: str, edges: list[Edge]) -> Table:
    """Ledger rows in the given order. `kind`/`other` name the other endpoint; `dir` is "out" when this member is
    the payer, "in" when the payee, "both" for undirected ties."""
    rows = []
    for e in edges:
        mine_from = e["from"]["id"] == mid
        other = e["to"] if mine_from else e["from"]
        a = e["amount"]
        rows.append([e["type"], other["kind"], other["id"], (e["via"] or {}).get("id"), num(a["exact"]), num(a["low"]),
                     num(a["high"]), e["count"], e["first"], e["last"], e["note"],
                     "both" if not e["directed"] else ("out" if mine_from else "in")])
    return {"cols": MEMBER_LEDGER_COLS, "rows": rows}


def org_ties(edges: list[Edge], full_in_member_file: set[tuple[str, str]]) -> tuple[Table, list[Edge]]:
    """(ties table, money edges left out of it)."""
    totals: Counter[str] = Counter()
    for e in edges:
        if e["family"] == "money":
            totals[member_end(e)] += edge_size(e)
    top = {m for m, _ in sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))[:MONEY_MEMBERS_PER_ORG]}
    listed, rest = [], []
    for e in rank(edges):
        (listed if e["family"] != "money" or member_end(e) in top else rest).append(e)
    rows = [[e["type"], member_end(e), num(e["amount"]["exact"]), num(e["amount"]["low"]), num(e["amount"]["high"]),
             e["count"], e["first"], e["last"], e["id"] if (member_end(e), e["id"]) in full_in_member_file else None,
             e["note"]]
            for e in listed]
    return {"cols": ORG_TIE_COLS, "rows": rows}, rest


def ledger_totals(edges: list[Edge]) -> dict[str, Any]:
    """Per type: edges, records and summed amounts of the ties a reader cannot see as full edges."""
    groups: dict[str, list[Edge]] = defaultdict(list)
    for e in edges:
        groups[e["type"]].append(e)
    return {t: {"edges": len(es), "records": sum(e["count"] for e in es), **sum_amounts(e["amount"] for e in es)}
            for t, es in sorted(groups.items())}
