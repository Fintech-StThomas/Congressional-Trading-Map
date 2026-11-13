"""Validate web/public/data against docs/data-dictionary.md: python -m pipeline.validate.

(a) schema of every output file, (b) invariants (row counts, evidence, endpoints, by_year sums,
owner never defaulted, ledger totals), (c) a reproducible sample of 25 trades for hand checking
against the original filings (pipeline/build/validation_sample.csv). Exits non-zero on any failure.
"""
from __future__ import annotations

import csv
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

import pyarrow.parquet as pq

from .assemble import FORMER_MEMBER_LEDGER_ROWS, LEDGER_ONLY_TYPES, MEMBER_LEDGER_COLS, ORG_TIE_COLS, TRADE_COLUMNS, shard
from .edges import FAMILY, MAX_EVIDENCE, edge_id, sum_amounts
from .util import BUILD, OUT, read_json

SAMPLE_SIZE, SAMPLE_SEED = 25, 13107
DATE = "date"
OWNERS = {"self", "spouse", "joint", "dependent", "unspecified"}
ACTIONS = {"buy", "sell", "exchange", "other"}
CLASSES = {"stock", "option", "fund", "bond", "crypto", "private", "other", "unknown"}
ORG_KINDS = {"company", "pac", "party", "super_pac", "committee", "lobby", "other"}
TICKER_SOURCES = {"printed", "resolved", None}


class Checker:
    def __init__(self) -> None:
        self.errors: dict[str, list[str]] = defaultdict(list)
        self.checks = 0

    def check(self, ok: bool, rule: str, detail: str) -> None:
        self.checks += 1
        if not ok:
            self.errors[rule].append(detail)

    def report(self) -> int:
        for rule, items in sorted(self.errors.items()):
            print(f"FAIL {rule}: {len(items)} problems, e.g. {items[:3]}")
        print(f"{self.checks} checks, {sum(len(v) for v in self.errors.values())} failures")
        return 1 if self.errors else 0


def is_date(v: Any) -> bool:
    return isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-"


def is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def opt(pred: Callable[[Any], bool]) -> Callable[[Any], bool]:
    return lambda v: v is None or pred(v)


def shape(c: Checker, obj: Any, spec: dict[str, Callable[[Any], bool]], where: str) -> None:
    if not isinstance(obj, dict):
        c.check(False, "schema", f"{where}: not an object")
        return
    c.check(set(obj) == set(spec), "schema", f"{where}: keys {sorted(set(obj) ^ set(spec))}")
    for k, pred in spec.items():
        if k in obj:
            c.check(pred(obj[k]), "schema", f"{where}.{k}={str(obj[k])[:60]}")


AMOUNT = {"low": opt(is_num), "high": opt(is_num), "exact": opt(is_num)}
NODE = {"kind": lambda v: v in ("member", "org"), "id": lambda v: isinstance(v, str) and bool(v)}
MEMBER_SUMMARY = {
    "id": lambda v: isinstance(v, str), "name": lambda v: isinstance(v, str), "first": lambda v: isinstance(v, str),
    "last": lambda v: isinstance(v, str), "party": lambda v: v in ("D", "R", "I"), "state": lambda v: isinstance(v, str) and len(v) == 2,
    "chamber": lambda v: v in ("sen", "rep"), "district": opt(lambda v: isinstance(v, int)), "current": lambda v: isinstance(v, bool),
    "served": lambda v: isinstance(v, list) and len(v) == 2 and is_date(v[0]) and opt(is_date)(v[1]),
    "photo": lambda v: isinstance(v, bool), "counts": lambda v: isinstance(v, dict) and set(v) == {"trades", "orgs", "members", "cases"},
}
ORG_SUMMARY = {"id": lambda v: isinstance(v, str), "name": lambda v: isinstance(v, str), "kind": lambda v: v in ORG_KINDS,
               "ticker": opt(lambda v: isinstance(v, str)), "cik": opt(lambda v: isinstance(v, int)),
               "sector": opt(lambda v: isinstance(v, str)), "degree": lambda v: isinstance(v, int) and v >= 1}
CASE = {"id": lambda v: isinstance(v, str), "member": lambda v: isinstance(v, str), "org": lambda v: isinstance(v, str),
        "types": lambda v: isinstance(v, list) and len(v) >= 2, "edges": lambda v: isinstance(v, list) and len(v) >= 2,
        "years": lambda v: isinstance(v, list) and len(v) == 2 and v[0] <= v[1], "score": is_num, "money": is_num, "trades": lambda v: isinstance(v, int)}


def check_edge(c: Checker, e: dict[str, Any], where: str, sources: set[str], members: set[str], orgs: set[str]) -> None:
    shape(c, e, {
        "id": lambda v: isinstance(v, str) and len(v) == 12, "type": lambda v: v in FAMILY,
        "family": lambda v: v in ("money", "holding", "people", "context"), "basis": lambda v: v in ("filed", "derived"),
        "from": lambda v: isinstance(v, dict), "to": lambda v: isinstance(v, dict), "directed": lambda v: isinstance(v, bool),
        "via": opt(lambda v: isinstance(v, dict) and isinstance(v.get("id"), str) and isinstance(v.get("name"), str)),
        "amount": lambda v: isinstance(v, dict), "count": lambda v: isinstance(v, int) and v >= 1,
        "first": is_date, "last": is_date, "by_year": lambda v: isinstance(v, list) and bool(v),
        "evidence": lambda v: isinstance(v, list) and 1 <= len(v) <= MAX_EVIDENCE, "evidence_total": lambda v: isinstance(v, int),
        "stat": opt(lambda v: isinstance(v, dict)), "weak": lambda v: isinstance(v, bool), "note": opt(lambda v: isinstance(v, str)),
    }, where)
    if set(e) < {"id", "type", "from", "to", "evidence", "by_year", "amount", "count"}:
        return
    eid = e["id"]
    shape(c, e["from"], NODE, f"{where}.from")
    shape(c, e["to"], NODE, f"{where}.to")
    shape(c, e["amount"], AMOUNT, f"{where}.amount")
    c.check(FAMILY.get(e["type"]) == e["family"], "edge family matches type", eid)
    c.check(e["id"] == edge_id(e["type"], e["from"], e["to"], e["via"]), "edge id is sha1(type|from|to[|via])", eid)
    c.check((e["basis"] == "derived") == (e["stat"] is not None), "derived edges carry stat, filed do not", eid)
    if e["stat"] is not None:
        c.check({"observed", "expected", "lift", "method"} <= set(e["stat"]), "schema", f"{eid}.stat")
    c.check(e["directed"] or e["from"]["id"] <= e["to"]["id"], "undirected edges ordered", eid)
    c.check(e["first"] <= e["last"], "first <= last", eid)
    c.check(e["evidence_total"] >= len(e["evidence"]), "evidence_total >= evidence", eid)
    for i, ev in enumerate(e["evidence"]):
        shape(c, ev, {"label": lambda v: isinstance(v, str) and bool(v), "date": opt(is_date),
                      "url": opt(lambda v: isinstance(v, str) and v.startswith("http")), "source": lambda v: isinstance(v, str),
                      "record": opt(lambda v: isinstance(v, str))}, f"{eid}.evidence[{i}]")
        c.check(ev.get("source") in sources, "evidence source listed in meta.json", f"{eid}:{ev.get('source')}")
    for end in (e["from"], e["to"]):
        known = end.get("id") in (members if end.get("kind") == "member" else orgs)
        c.check(known, "edge endpoint exists", f"{eid}:{end.get('id')}")
    for i, y in enumerate(e["by_year"]):
        shape(c, y, {"y": lambda v: isinstance(v, int), "n": lambda v: isinstance(v, int) and v >= 1, **AMOUNT}, f"{eid}.by_year[{i}]")
    c.check(sum(y.get("n", 0) for y in e["by_year"]) == e["count"], "by_year n sums to count", eid)
    c.check(sum_amounts(e["by_year"]) == {k: e["amount"][k] for k in ("low", "high", "exact")}, "by_year amounts sum to totals", eid)


def check_table(c: Checker, table: Any, cols: list[str], where: str) -> list[dict[str, Any]]:
    ok = isinstance(table, dict) and table.get("cols") == cols and isinstance(table.get("rows"), list)
    c.check(ok, "schema", f"{where} columnar table")
    if not ok:
        return []
    for r in table["rows"]:
        c.check(isinstance(r, list) and len(r) == len(cols), "schema", f"{where} row width")
    return [dict(zip(cols, r)) for r in table["rows"]]


def check_member_ledger(c: Checker, mf: dict[str, Any], where: str, orgs: set[str], members: set[str]) -> None:
    rows = check_table(c, mf["ledger"], MEMBER_LEDGER_COLS, f"{where}.ledger")
    for row in rows:
        c.check(FAMILY.get(row["type"]) == "money" or row["type"] in LEDGER_ONLY_TYPES, "ledger rows are money or ledger-only ties", f"{where}:{row['type']}")
        c.check(row["other"] in (members if row["kind"] == "member" else orgs), "ledger endpoint exists", f"{where}:{row['other']}")
        c.check(row["dir"] in ("in", "out", "both") and row["count"] >= 1, "schema", f"{where} ledger dir/count")
    per_type = Counter(r["type"] for r in rows)
    totals = {t: v["edges"] for t, v in mf["ledger_totals"].items()}
    if mf["member"]["current"]:
        c.check(dict(per_type) == totals, "current members: ledger is complete (matches ledger_totals)", where)
    else:
        money_total = sum(n for t, n in totals.items() if t not in LEDGER_ONLY_TYPES)
        c.check(sum(1 for r in rows if r["type"] not in LEDGER_ONLY_TYPES) == min(money_total, FORMER_MEMBER_LEDGER_ROWS)
                and all(per_type[t] <= n for t, n in totals.items()), "former members: ledger is the largest rows", where)
    sizes = [r["exact"] or r["high"] or r["low"] or 0 for r in rows if r["type"] not in LEDGER_ONLY_TYPES]
    c.check(sizes == sorted(sizes, reverse=True), "ledger rows largest first", where)


def check_trades(c: Checker, mf: dict[str, Any], where: str, orgs: set[str]) -> int:
    t = mf
    c.check(set(t) == {"cols", "rows", "filings"}, "schema", f"{where} keys")
    c.check(t.get("cols") == TRADE_COLUMNS, "schema", f"{where}.trades.cols")
    prev = None
    for r in t.get("rows", []):
        row = dict(zip(TRADE_COLUMNS, r))
        c.check(len(r) == len(TRADE_COLUMNS), "schema", f"{where}.trade width")
        c.check(row["owner"] in OWNERS and row["action"] in ACTIONS and row["asset_class"] in CLASSES
                and row["ticker_source"] in TICKER_SOURCES, "trade enums", f"{where}:{row['id']}")
        c.check(opt(is_date)(row["date"]) and opt(is_date)(row["available"]), "schema", f"{where}:{row['id']} dates")
        c.check(row["low"] is None or row["high"] is None or row["low"] <= row["high"], "trade low <= high", row["id"])
        c.check((row["lag_days"] is None) == (row["date"] is None or row["available"] is None), "lag null iff a date is missing", row["id"])
        c.check(row["late"] is None if row["lag_days"] is None else row["late"] == (row["lag_days"] > 45), "late = lag_days > 45", row["id"])
        c.check(row["doc"] in mf["filings"], "trade doc has a filing URL", row["id"])
        c.check(row["org"] is None or row["org"] in orgs, "trade org exists", f"{row['id']}:{row['org']}")
        c.check((row["org"] is None) == (row["ticker"] is None), "org resolved iff ticker present", row["id"])
        key = (row["date"] or "", row["id"])
        c.check(prev is None or key <= prev, "trades newest first", row["id"])
        prev = key
    return len(t.get("rows", []))


def check_owner_never_defaulted(c: Checker) -> None:
    t = pq.read_table(BUILD / "trades_resolved.parquet", columns=["id", "owner", "owner_raw"]).to_pylist()
    for r in t:
        c.check((r["owner"] == "self") == (r["owner_raw"] == "self"), "owner self only when filed as self", r["id"])
        c.check(r["owner_raw"] is not None or r["owner"] == "unspecified", "unlabelled owner is unspecified", r["id"])


def write_sample() -> Path:
    rows = pq.read_table(BUILD / "trades_resolved.parquet").to_pylist()
    rows.sort(key=lambda r: r["id"])
    sample = random.Random(SAMPLE_SEED).sample(rows, SAMPLE_SIZE)
    path = BUILD / "validation_sample.csv"
    cols = ["id", "member", "chamber", "date", "available", "owner", "owner_raw", "action", "partial", "ticker",
            "ticker_source", "asset", "asset_class", "asset_type_raw", "low", "high", "org", "url"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols + ["checked_by", "matches_filing", "comment"])
        for r in sorted(sample, key=lambda r: r["id"]):
            w.writerow([r[k] for k in cols] + ["", "", ""])
    return path


def main() -> int:
    c = Checker()
    meta = read_json(OUT / "meta.json")
    sources = set(meta["sources"])
    members_list = read_json(OUT / "members.json")
    orgs_list = read_json(OUT / "orgs.json")
    members = {m["id"] for m in members_list}
    orgs = {o["id"] for o in orgs_list}
    for m in members_list:
        shape(c, m, MEMBER_SUMMARY, f"members.json:{m.get('id')}")
    for o in orgs_list:
        shape(c, o, ORG_SUMMARY, f"orgs.json:{o.get('id')}")
    c.check(len(orgs) == len(orgs_list) and len(members) == len(members_list), "ids unique in summaries", "")
    cases = read_json(OUT / "cases.json")
    for k in cases:
        shape(c, k, CASE, f"cases.json:{k.get('id')}")

    seen_edges: dict[str, dict[str, Any]] = {}
    full_pairs: set[tuple[str, str]] = set()
    trade_rows = 0
    for mid in sorted(members):
        mf = read_json(OUT / "members" / f"{mid}.json")
        where = f"members/{mid}"
        c.check(set(mf) == {"member", "edges", "board", "nodes", "ledger", "ledger_totals", "trade_summary", "cases", "coverage"},
                "schema", f"{where} keys")
        c.check(mf["member"]["id"] == mid, "member file id", where)
        for e in mf["edges"]:
            check_edge(c, e, where, sources, members, orgs)
            c.check(mid in (e["from"]["id"], e["to"]["id"]), "member file edges touch the member", f"{where}:{e['id']}")
            seen_edges[e["id"]] = e
            full_pairs.add((mid, e["id"]))
            c.check(e["type"] not in LEDGER_ONLY_TYPES, "ledger-only types are not full edges", e["id"])
            for end in (e["from"], e["to"]):
                c.check(end["id"] == mid or end["id"] in mf["nodes"], "member nodes cover full edges", f"{where}:{end['id']}")
        ids = {e["id"] for e in mf["edges"]}
        c.check(len(mf["board"]) <= 12 and set(mf["board"]) <= ids, "board: <= 12 ids of full edges", where)
        check_member_ledger(c, mf, where, orgs, members)
        tpath = OUT / "trades" / f"{mid}.json"
        n = check_trades(c, read_json(tpath), f"trades/{mid}", orgs) if tpath.exists() else 0
        trade_rows += n
        c.check(mf["member"]["counts"]["trades"] == n == mf["trade_summary"]["count"], "trade counts match trades file", where)
        for cov in mf["coverage"]:
            c.check(cov["trades"] in ("full", "partial", "none", "n/a") and cov["money"] in ("full", "partial", "none"), "schema", f"{where} coverage")

    for k in sorted({shard(o) for o in orgs}):
        doc = read_json(OUT / "orgs" / f"{k}.json")
        for oid, of in doc.items():
            c.check(shard(oid) == k, "org in the right shard", oid)
            c.check(set(of) == {"org", "ties", "ledger_totals"}, "schema", f"orgs/{k}:{oid} keys")
            shape(c, of["org"], ORG_SUMMARY, f"orgs/{k}:{oid}")
            ties = check_table(c, of["ties"], ORG_TIE_COLS, f"orgs/{k}:{oid}.ties")
            for t in ties:
                c.check(t["member"] in members and t["type"] in FAMILY, "org tie endpoint exists", f"{oid}:{t['member']}")
                c.check(t["edge"] is None or (t["member"], t["edge"]) in full_pairs, "org tie edge id is in that member's file",
                        f"{oid}:{t['edge']}")
            c.check(len(ties) + sum(v["edges"] for v in of["ledger_totals"].values()) >= 1, "org has at least one tie", oid)
    sharded = {oid for k in {shard(o) for o in orgs} for oid in read_json(OUT / "orgs" / f"{k}.json")}
    c.check(sharded == orgs, "every org in orgs.json has an org file", str(len(sharded ^ orgs)))

    for e in read_json(OUT / "member-ties.json"):
        check_edge(c, e, "member-ties", sources, members, orgs)
        c.check(e["from"]["kind"] == e["to"]["kind"] == "member" and e["family"] != "context" and e["id"] in seen_edges,
                "member-ties: non-context member pairs published as full edges", e["id"])
    board = read_json(OUT / "board.json")
    c.check(set(board) == {"states"}, "schema", "board keys")
    c.check({m for ids in board["states"].values() for m in ids} == {m["id"] for m in members_list if m["current"]},
            "board states list every current member", "")
    for k in cases:
        c.check(all(eid in seen_edges for eid in k["edges"]), "case edges are published", k["id"])

    # Row counts across stages: no join may have multiplied or lost trades.
    resolved = pq.read_metadata(BUILD / "trades_resolved.parquet").num_rows
    parsed = pq.read_metadata(BUILD / "trades.parquet").num_rows
    expected = meta["reports"]["hf_trades"]["trades_written"]
    for label, n in (("trades.parquet", parsed), ("trades_resolved.parquet", resolved), ("member files", trade_rows),
                     ("meta.counts.trades", meta["counts"]["trades"])):
        c.check(n == expected, "trade row counts stable across joins", f"{label}={n} expected {expected}")
    check_owner_never_defaulted(c)
    print(f"validation sample written to {write_sample()}")
    return c.report()


if __name__ == "__main__":
    sys.exit(main())
