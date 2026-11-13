"""Edge construction helpers shared by the edge builders and the assembler.

Amount rule (also in the contract): `low` adds the known lows and is null only when no record has
one (a lower bound stays valid when some amounts are unknown); `high` and `exact` are null as soon
as any record lacks them, because an unknown amount has no upper bound.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Any, Iterable

FAMILY = {
    "traded": "holding", "owns": "holding", "position": "people",
    "pac_money": "money", "employee_money": "money", "lobbyist_money": "money", "outside_spending": "money",
    "paid_travel": "money", "revolving_door": "people", "oversees": "context", "funds": "money",
    "fundraises_with": "money", "shared_donors": "money", "traded_together": "holding",
    "legislates_with": "context", "shared_staff": "people", "sits_with": "context",
}
MAX_EVIDENCE = 5
Amount = dict[str, float | None]


def node(kind: str, id_: str) -> dict[str, str]:
    return {"kind": kind, "id": id_}


def edge_id(type_: str, frm: dict[str, str], to: dict[str, str], via: dict[str, Any] | None = None) -> str:
    """sha1 of type|from|to (plus |via when the edge runs through a named intermediary), first 12 hex."""
    key = f"{type_}|{frm['id']}|{to['id']}" + (f"|{via['id']}" if via else "")
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def sum_amounts(items: Iterable[Amount]) -> Amount:
    lows: list[float] = []
    high: float | None = 0.0
    exact: float | None = 0.0
    any_item = False
    for a in items:
        any_item = True
        if a.get("low") is not None:
            lows.append(a["low"])
        high = None if high is None or a.get("high") is None else high + a["high"]
        exact = None if exact is None or a.get("exact") is None else exact + a["exact"]
    if not any_item:
        return {"low": None, "high": None, "exact": None}
    return {"low": round(sum(lows), 2) if lows else None,
            "high": None if high is None else round(high, 2), "exact": None if exact is None else round(exact, 2)}


def by_year(records: Iterable[tuple[int, int, Amount]]) -> list[dict[str, Any]]:
    """records: (year, n, amount). Returns sorted by_year entries."""
    groups: dict[int, list[tuple[int, Amount]]] = defaultdict(list)
    for y, n, a in records:
        groups[y].append((n, a))
    return [{"y": y, "n": sum(n for n, _ in rows), **sum_amounts(a for _, a in rows)} for y, rows in sorted(groups.items())]


def top_evidence(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Largest first, then most recent first; `_size` is a private sort helper and is dropped."""
    ranked = sorted(items, key=lambda e: (-(e.get("_size") or 0.0), _neg_date(e.get("date")), e.get("record") or ""))
    return [{k: v for k, v in e.items() if not k.startswith("_")} for e in ranked[:MAX_EVIDENCE]]


def _neg_date(d: str | None) -> str:
    """Sort key that puts later ISO dates first and missing dates last."""
    if d is None:
        return "~"
    return "".join(chr(ord("9") - int(c) + ord("0")) if c.isdigit() else c for c in d)


def make_edge(type_: str, frm: dict[str, str], to: dict[str, str], *, directed: bool, basis: str,
              years: list[dict[str, Any]], first: str, last: str, evidence: list[dict[str, Any]],
              evidence_total: int, via: dict[str, Any] | None = None, stat: dict[str, Any] | None = None,
              weak: bool = False, note: str | None = None) -> dict[str, Any]:
    if not directed and frm["id"] > to["id"]:
        frm, to = to, frm
    return {
        "type": type_, "family": FAMILY[type_], "basis": basis, "from": frm, "to": to, "directed": directed,
        "via": via, "amount": sum_amounts(years), "count": sum(y["n"] for y in years), "first": first, "last": last,
        "by_year": years, "evidence": evidence, "evidence_total": evidence_total, "stat": stat, "weak": weak, "note": note,
    }
