"""Names and shapes from docs/data-dictionary.md ("Types"), as Python types and column lists.

Reads and writes nothing. These TypedDicts describe the JSON the stages pass around and publish, so a function
signature says which contract object it takes instead of `dict[str, Any]`. They are documentation for readers and
type checkers; nothing is validated at runtime here (`pipeline/validate.py` does that against the output).
"""
from __future__ import annotations

from datetime import date
from typing import Literal, TypedDict

# ---------------------------------------------------------------- edge types and families ("Edge")
FAMILY: dict[str, str] = {
    "traded": "holding", "owns": "holding", "position": "people",
    "pac_money": "money", "employee_money": "money", "lobbyist_money": "money", "outside_spending": "money",
    "paid_travel": "money", "revolving_door": "people", "oversees": "context", "funds": "money",
    "fundraises_with": "money", "shared_donors": "money", "traded_together": "holding",
    "legislates_with": "context", "shared_staff": "people", "sits_with": "context",
}
FAMILY_ORDER = {"money": 0, "holding": 1, "people": 2, "context": 3}   # board order on the member map
PARTIES = ("D", "I", "R")
SPLIT_MEASURES = ("given", "support", "oppose", "traded")              # OrgSummary.split measures

# ---------------------------------------------------------------- columnar tables
TRADE_COLUMNS = ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "partial",
                 "ticker", "ticker_source", "asset", "asset_class", "low", "high", "org", "doc"]
EDGE_KEYS = {"type", "family", "basis", "from", "to", "directed", "via", "amount", "count", "first", "last",
             "by_year", "evidence", "evidence_total", "stat", "weak", "note"}
MEMBER_LEDGER_COLS = ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"]
ORG_TIE_COLS = ["type", "member", "exact", "low", "high", "count", "first", "last", "edge", "note"]
WALL_COLS = ["id", "name", "last", "party", "state", "chamber", "district", "current", "photo", "cases", "trades",
             "pac", "support", "oppose", "orgs"]
WALL_YEARS_COLS = ["id", "terms", "cases", "trades", "pac", "oppose"]
ORG_INDEX_COLS = ["id", "name", "kind", "ticker", "members_D", "members_I", "members_R", "dollars_D", "dollars_I",
                  "dollars_R", "degree"]


# ---------------------------------------------------------------- objects
class Node(TypedDict):
    kind: Literal["member", "org"]
    id: str


class Via(TypedDict):
    id: str
    name: str


class Amount(TypedDict):
    """A disclosed range. Missing is null, never zero; see edges.sum_amounts for the sum rule."""
    low: float | None
    high: float | None
    exact: float | None


class YearAmount(Amount):
    y: int
    n: int


class Evidence(TypedDict):
    label: str
    date: str | None
    url: str | None
    source: str          # a key of meta.json.sources
    record: str | None


class Edge(TypedDict):
    """A plug-in edge (`id` is added by the assembler)."""
    type: str
    family: str
    basis: Literal["filed", "derived"]
    directed: bool
    via: Via | None
    amount: Amount
    count: int
    first: str
    last: str
    by_year: list[YearAmount]
    evidence: list[Evidence]
    evidence_total: int
    stat: dict | None
    weak: bool
    note: str | None
    # "from" and "to" are Python keywords/awkward; edges carry them as plain keys: e["from"], e["to"] (both Node).


class OrgSummary(TypedDict, total=False):
    id: str
    name: str
    kind: str
    ticker: str | None
    cik: int | None
    sector: str | None
    degree: int          # added by the assembler
    split: dict          # PartySplit, added by the assembler


class Case(TypedDict):
    id: str
    member: str
    org: str
    types: list[str]
    edges: list[str]
    years: list[int]     # [first, last] calendar year in which every listed type is active
    score: int
    money: float
    trades: int


class Term(TypedDict):
    chamber: Literal["rep", "sen"]
    start: str
    end: str
    state: str
    district: int | None
    party: Literal["D", "R", "I"]


class SpineMember(TypedDict):
    """pipeline/build/spine.json value (bioguide id -> this)."""
    name: str
    first: str
    last: str
    party: str
    state: str
    chamber: str
    district: int | None
    current: bool
    served: list[str | None]
    terms: list[Term]
    fec_ids: list[str]
    committees: list[dict]


class Trade(TypedDict):
    """One row of pipeline/build/trades_resolved.parquet (trades.parquet has no `org`)."""
    id: str
    member: str
    chamber: str
    version: int
    amended: bool
    date: date | None
    available: date | None
    lag_days: int | None
    late: bool | None
    owner: str
    owner_raw: str | None
    action: str
    action_raw: str | None
    partial: bool | None
    ticker: str | None
    ticker_source: str | None
    asset: str
    asset_class: str
    asset_type_raw: str | None
    low: float | None
    high: float | None
    url: str
    doc_id: str                 # the earliest filing of the trade
    amendments: list[dict]      # later filings: {id, doc_id, url, status "Amended" | "Deleted" | "Version", available}
    org: str | None
