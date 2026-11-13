"""Assemble every plug-in source into the site files described in docs/data-dictionary.md.

Reads pipeline/build/{spine.json, trades_resolved.parquet, edges/*.jsonl, orgs/*.jsonl, sources/*.json},
builds into a staging directory and swaps it into web/public/data/ so readers never see a half-written tree.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Iterable

import pyarrow.parquet as pq

from .edges import FAMILY, by_year, edge_id, sum_amounts
from .util import (BUILD, EDGES_DIR, ORGS_DIR, OUT, PORTRAITS, ROOT, SOURCES_DIR, print_table, read_json, read_jsonl,
                   utc_now, write_json)

TRADE_COLUMNS = ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "partial",
                 "ticker", "ticker_source", "asset", "asset_class", "low", "high", "org", "doc"]
EDGE_KEYS = {"type", "family", "basis", "from", "to", "directed", "via", "amount", "count", "first", "last",
             "by_year", "evidence", "evidence_total", "stat", "weak", "note"}
CASE_FAMILIES = ("money", "holding", "people")
BOARD_EDGES = 12
BOARD_EVIDENCE = 1
# Publication budget (contract: "Publication budget"). Full Edge objects live only in member files.
MONEY_EDGES_PER_MEMBER = 15          # largest money edges per member kept as full Edges (plus every Case edge)
FORMER_MEMBER_LEDGER_ROWS = 100      # ledger rows kept for former members; current members keep all
MONEY_MEMBERS_PER_ORG = 200          # members listed per org for money ties; the rest is in ledger_totals
FAMILY_ORDER = {"money": 0, "holding": 1, "people": 2, "context": 3}
STOCK_ACT_YEAR = 2012
MEMBER_LEDGER_COLS = ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"]
ORG_TIE_COLS = ["type", "member", "exact", "low", "high", "count", "first", "last", "edge"]


def shard(org_id: str) -> str:
    return hashlib.sha1(org_id.encode()).hexdigest()[:2]


def num(x: float | None) -> float | int | None:
    """Whole-dollar floats as ints for compact JSON."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def edge_size(e: dict[str, Any]) -> float:
    a = e["amount"]
    return a["exact"] or a["high"] or a["low"] or 0.0


# ---------------------------------------------------------------- loading plug-ins

def load_orgs() -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Merge OrgSummary rows by id: the first non-null value wins, files in name order; a company kind wins."""
    orgs: dict[str, dict[str, Any]] = {}
    files = sorted(ORGS_DIR.glob("*.jsonl"))
    for path in files:
        for row in read_jsonl(path):
            cur = orgs.setdefault(row["id"], {"id": row["id"], "name": row.get("name") or row["id"], "kind": "other",
                                              "ticker": None, "cik": None, "sector": None})
            for k in ("ticker", "cik", "sector"):
                if cur[k] is None and row.get(k) is not None:
                    cur[k] = row[k]
            if row.get("kind") == "company" or cur["kind"] == "other":
                cur["kind"] = row.get("kind") or cur["kind"]
                if row.get("name"):
                    cur["name"] = row["name"]
    return orgs, [p.name for p in files]


def edge_problem(e: dict[str, Any]) -> str | None:
    missing = EDGE_KEYS - set(e)
    if missing:
        return f"missing keys {sorted(missing)}"
    if e["type"] not in FAMILY or FAMILY[e["type"]] != e["family"]:
        return f"bad type/family {e['type']}/{e['family']}"
    if e["basis"] not in ("filed", "derived") or (e["basis"] == "derived") != (e["stat"] is not None):
        return "derived edges need stat and filed edges must not have one"
    if not e["evidence"]:
        return "no evidence"
    return None


def merge_edges(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    if a["stat"] is not None or b["stat"] is not None:
        raise ValueError(f"duplicate derived edge {a['type']} {a['from']['id']} {a['to']['id']}")
    years = by_year([(y["y"], y["n"], y) for y in a["by_year"] + b["by_year"]])
    notes = [n for n in (a["note"], b["note"]) if n]
    evidence = sorted(a["evidence"] + b["evidence"], key=lambda ev: ev.get("date") or "", reverse=True)
    return {**a, "by_year": years, "amount": sum_amounts(years), "count": sum(y["n"] for y in years),
            "first": min(a["first"], b["first"]), "last": max(a["last"], b["last"]), "evidence": evidence[:5],
            "evidence_total": a["evidence_total"] + b["evidence_total"], "weak": a["weak"] or b["weak"],
            "note": "; ".join(dict.fromkeys(notes)) or None}


def load_edges(members: set[str], orgs: dict[str, Any], sources: set[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    merged: dict[tuple[str, str, str, str | None], dict[str, Any]] = {}
    dropped: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    read = Counter()
    for path in sorted(EDGES_DIR.glob("*.jsonl")):
        for e in read_jsonl(path):
            read[path.name] += 1
            problem = edge_problem(e)
            ends = [e["from"], e["to"]] if problem is None else []
            if problem is None:
                for end in ends:
                    known = end["id"] in members if end["kind"] == "member" else end["id"] in orgs
                    if not known:
                        problem = f"unknown {end['kind']} endpoint"
                if any(ev["source"] not in sources for ev in e["evidence"]):
                    problem = "evidence source not listed in sources/*.json"
            if problem:
                key = f"{path.name}: {problem}"
                dropped[key] += 1
                if len(examples[key]) < 10:
                    examples[key].append(f"{e.get('type')} {e.get('from', {}).get('id')} -> {e.get('to', {}).get('id')}")
                continue
            if not e["directed"] and e["from"]["id"] > e["to"]["id"]:
                e["from"], e["to"] = e["to"], e["from"]
            key = (e["type"], e["from"]["id"], e["to"]["id"], (e["via"] or {}).get("id"))
            merged[key] = merge_edges(merged[key], e) if key in merged else e
    edges = []
    for key in sorted(merged):
        e = merged[key]
        e["id"] = edge_id(e["type"], e["from"], e["to"], e["via"])
        edges.append(e)
    ids = Counter(e["id"] for e in edges)
    if max(ids.values(), default=1) > 1:
        raise AssertionError("edge id collision")
    return edges, {"edges_read": dict(read), "edges_after_merge": len(edges), "edges_dropped": dict(dropped),
                   "edges_dropped_examples": dict(examples)}


def load_sources() -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    sources: dict[str, Any] = {}
    reports: dict[str, Any] = {}
    money: dict[str, str] = {}
    for path in sorted(SOURCES_DIR.glob("*.json")):
        doc = read_json(path)
        sources.update(doc.get("sources", {}))
        reports[path.stem] = doc.get("report", {})
        for year, level in (doc.get("coverage", {}).get("money", {}) or {}).items():
            if money.get(year) != "full":
                money[year] = level
    return sources, reports, money


# ---------------------------------------------------------------- derived structures

def find_cases(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Member-org pairs with >= 3 distinct filed edge types (money/holding/people) active in a common year."""
    pairs: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for e in edges:
        if e["basis"] != "filed" or e["family"] not in CASE_FAMILIES:
            continue
        ends = {e["from"]["kind"]: e["from"]["id"], e["to"]["kind"]: e["to"]["id"]}
        if set(ends) == {"member", "org"}:
            pairs[(ends["member"], ends["org"])].append(e)
    cases = []
    for (member, org), es in sorted(pairs.items()):
        if len({e["type"] for e in es}) < 3:
            continue
        span = {t: (min(int(e["first"][:4]) for e in es if e["type"] == t), max(int(e["last"][:4]) for e in es if e["type"] == t))
                for t in {e["type"] for e in es}}
        best: tuple[int, int, frozenset[str]] | None = None
        for y in range(min(s[0] for s in span.values()), max(s[1] for s in span.values()) + 1):
            active = frozenset(t for t, (lo, hi) in span.items() if lo <= y <= hi)
            if len(active) >= 3 and (best is None or len(active) > len(best[2])):
                best = (y, y, active)
        if best is None:
            continue
        types = sorted(best[2])
        window = (max(span[t][0] for t in types), min(span[t][1] for t in types))
        chosen = [e for e in es if e["type"] in best[2]]
        money = sum(edge_size(e) for e in chosen if e["family"] == "money")
        cases.append({"id": hashlib.sha1(f"case|{member}|{org}".encode()).hexdigest()[:12], "member": member, "org": org,
                      "types": types, "edges": sorted(e["id"] for e in chosen), "years": list(window),
                      "score": len(types), "_money": money})
    cases.sort(key=lambda c: (-c["score"], -c["_money"], c["id"]))
    for c in cases:
        del c["_money"]
    return cases


def rank(edges: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(edges, key=lambda e: (-edge_size(e), -e["count"], e["id"]))


def split_member_edges(mid: str, edges: list[dict[str, Any]], case_edges: set[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(full, ledger) for one member: every non-money edge and Case edge is full, plus the
    MONEY_EDGES_PER_MEMBER largest money edges; the remaining money edges become ledger rows."""
    money = rank(e for e in edges if e["family"] == "money" and e["id"] not in case_edges)
    full_ids = {e["id"] for e in edges if e["family"] != "money" or e["id"] in case_edges}
    full_ids |= {e["id"] for e in money[:MONEY_EDGES_PER_MEMBER]}
    return [e for e in edges if e["id"] in full_ids], money[MONEY_EDGES_PER_MEMBER:]


def member_ledger(mid: str, edges: list[dict[str, Any]]) -> dict[str, Any]:
    """Ledger rows, largest first. `kind`/`other` name the other endpoint; `dir` is "out" when this
    member is the payer, "in" when the payee, "both" for undirected ties."""
    rows = []
    for e in edges:
        mine_from = e["from"]["id"] == mid
        other = e["to"] if mine_from else e["from"]
        a = e["amount"]
        rows.append([e["type"], other["kind"], other["id"], (e["via"] or {}).get("id"), num(a["exact"]), num(a["low"]),
                     num(a["high"]), e["count"], e["first"], e["last"], e["note"],
                     "both" if not e["directed"] else ("out" if mine_from else "in")])
    return {"cols": MEMBER_LEDGER_COLS, "rows": rows}


def org_ties(edges: list[dict[str, Any]], full_in_member_file: set[tuple[str, str]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(ties table, money edges left out). Every non-money tie is listed; money ties only for the
    MONEY_MEMBERS_PER_ORG members who received or paid the most."""
    def member_of(e: dict[str, Any]) -> str:
        return e["to"]["id"] if e["to"]["kind"] == "member" else e["from"]["id"]
    totals: Counter[str] = Counter()
    for e in edges:
        if e["family"] == "money":
            totals[member_of(e)] += edge_size(e)
    top = {m for m, _ in sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))[:MONEY_MEMBERS_PER_ORG]}
    listed, rest = [], []
    for e in rank(edges):
        (listed if e["family"] != "money" or member_of(e) in top else rest).append(e)
    rows = [[e["type"], member_of(e), num(e["amount"]["exact"]), num(e["amount"]["low"]), num(e["amount"]["high"]),
             e["count"], e["first"], e["last"], e["id"] if (member_of(e), e["id"]) in full_in_member_file else None]
            for e in listed]
    return {"cols": ORG_TIE_COLS, "rows": rows}, rest


def ledger_totals(edges: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in edges:
        groups[e["type"]].append(e)
    return {t: {"edges": len(es), "records": sum(e["count"] for e in es), **sum_amounts(e["amount"] for e in es)}
            for t, es in sorted(groups.items())}


def in_office(terms: list[dict[str, Any]], year: int) -> set[str]:
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
        elif year == first.year and first.month > 1 or year == this_year or year in failed:
            levels.append("partial")
        else:
            levels.append("full")
    return min(levels, key=["full", "partial", "none"].index)


def coverage(m: dict[str, Any], chamber_cov: dict[str, Any], failed: set[int], money: dict[str, str], this_year: int) -> list[dict[str, Any]]:
    out = []
    for y in range(2000, this_year + 1):
        chambers = in_office(m["terms"], y)
        if not chambers:
            continue
        money_level = money.get(str(y), "none") if m["fec_ids"] else "none"
        out.append({"year": y, "trades": trade_coverage(chambers, y, chamber_cov, failed, this_year), "money": money_level})
    return out


def trade_row(t: dict[str, Any]) -> list[Any]:
    vals = {**t, "date": t["date"].isoformat() if t["date"] else None,
            "available": t["available"].isoformat() if t["available"] else None,
            "low": num(t["low"]), "high": num(t["high"]), "doc": t["doc_id"]}
    return [vals[c] for c in TRADE_COLUMNS]


def board_order(e: dict[str, Any], case_edges: set[str]) -> tuple[Any, ...]:
    return (e["id"] not in case_edges, FAMILY_ORDER[e["family"]], -edge_size(e), -e["count"], e["id"])


def write_tree(staging: Path, files: Iterable[tuple[str, Any]]) -> None:
    for rel, obj in files:
        write_json(staging / rel, obj)


def swap_into_place(staging: Path) -> None:
    old = OUT.with_name(OUT.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if OUT.exists():
        OUT.rename(old)
    staging.rename(OUT)
    if old.exists():
        shutil.rmtree(old)


def git_commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None


# ---------------------------------------------------------------- main

def run() -> None:
    spine: dict[str, dict[str, Any]] = read_json(BUILD / "spine.json")
    sources, reports, money_cov = load_sources()
    orgs, org_files = load_orgs()
    edges, edge_report = load_edges(set(spine), orgs, set(sources))
    trades = pq.read_table(BUILD / "trades_resolved.parquet").to_pylist()
    trades_report = reports["hf_trades"]
    this_year = date.today().year

    by_member_trades: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in trades:
        by_member_trades[t["member"]].append(t)
    member_edges: dict[str, list[dict[str, Any]]] = defaultdict(list)
    org_edges: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in edges:
        for end in {e["from"]["id"]: e["from"], e["to"]["id"]: e["to"]}.values():
            (member_edges if end["kind"] == "member" else org_edges)[end["id"]].append(e)
    used_orgs = {o: {**orgs[o], "degree": len({end["id"] for e in es for end in (e["from"], e["to"]) if end["kind"] == "member"})}
                 for o, es in sorted(org_edges.items())}
    cases = find_cases(edges)
    case_edges = {eid for c in cases for eid in c["edges"]}
    member_cases: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in cases:
        member_cases[c["member"]].append(c)
    failed: dict[str, set[int]] = defaultdict(set)
    for f in trades_report.get("failed_filings", []):
        failed[f["member"]].add(f["year"])

    summaries: dict[str, dict[str, Any]] = {}
    full: dict[str, list[dict[str, Any]]] = {}
    member_files: list[tuple[str, Any]] = []
    ledger_stats = Counter()
    for mid in sorted(spine):
        m = spine[mid]
        es = member_edges.get(mid, [])
        others = {end["id"] for e in es for end in (e["from"], e["to"]) if end["id"] != mid}
        summary = {"id": mid, "name": m["name"], "first": m["first"], "last": m["last"], "party": m["party"],
                   "state": m["state"], "chamber": m["chamber"], "district": m["district"], "current": m["current"],
                   "served": m["served"], "photo": (PORTRAITS / f"{mid}.webp").exists(),
                   "counts": {"trades": len(by_member_trades.get(mid, [])), "orgs": sum(o in orgs for o in others),
                              "members": sum(o in spine for o in others), "cases": len(member_cases.get(mid, []))}}
        summaries[mid] = summary
        full[mid], rest = split_member_edges(mid, es, case_edges)
        shown = rest if m["current"] else rest[:FORMER_MEMBER_LEDGER_ROWS]
        ledger_stats["ledger_ties"] += len(rest)
        ledger_stats["ledger_rows_published"] += len(shown)
        ledger_stats["ledger_rows_former_members_cut"] += len(rest) - len(shown)
        ts = sorted(by_member_trades.get(mid, []), key=lambda t: (t["date"] or date.min, t["id"]), reverse=True)
        member_files.append((f"members/{mid}.json", {
            "member": {**summary, "terms": m["terms"], "committees": m["committees"], "fec_ids": m["fec_ids"]},
            "edges": full[mid], "ledger": member_ledger(mid, shown), "ledger_totals": ledger_totals(rest),
            "trades": {"cols": TRADE_COLUMNS, "rows": [trade_row(t) for t in ts]},
            "filings": {t["doc_id"]: t["url"] for t in ts},
            "cases": member_cases.get(mid, []),
            "coverage": coverage(m, trades_report["coverage"], failed[mid], money_cov, this_year)}))

    full_pairs = {(mid, e["id"]) for mid, es in full.items() for e in es}
    shards: dict[str, dict[str, Any]] = defaultdict(dict)
    for o, es in org_edges.items():
        ties, rest = org_ties(es, full_pairs)
        shards[shard(o)][o] = {"org": used_orgs[o], "ties": ties, "ledger_totals": ledger_totals(rest)}

    states: dict[str, list[str]] = defaultdict(list)
    current = sorted((s for s in summaries.values() if s["current"]),
                     key=lambda s: (s["state"], s["chamber"] != "sen", s["district"] or 0, s["last"], s["id"]))
    for s in current:
        states[s["state"]].append(s["id"])
    # Board edges carry only their first evidence item (evidence_total unchanged); the member file has the rest.
    strings = {s["id"]: [{**e, "evidence": e["evidence"][:BOARD_EVIDENCE]}
                         for e in sorted(full[s["id"]], key=lambda e: board_order(e, case_edges))[:BOARD_EDGES]]
               for s in current}
    board_nodes = {end["id"]: used_orgs[end["id"]] for es in strings.values() for e in es
                   for end in (e["from"], e["to"]) if end["kind"] == "org"}
    # Graph-view ties: member pairs that exist as a full Edge somewhere, without context (committee) ties.
    full_ids = {eid for _, eid in full_pairs}
    member_ties = [e for e in edges if e["id"] in full_ids and e["from"]["kind"] == "member" == e["to"]["kind"]
                   and e["family"] != "context"]

    edge_types = Counter(e["type"] for e in edges)
    full_types = Counter(e["type"] for e in edges if e["id"] in full_ids)
    meta = {
        "build": {"time": utc_now(), "pipeline_commit": git_commit(), "contract": "docs/data-dictionary.md"},
        "sources": sources, "reports": reports,
        "counts": {"members": len(summaries), "current_members": len(current), "trades": len(trades),
                   "orgs": len(used_orgs), "edges": len(edges), "edges_by_type": dict(sorted(edge_types.items())),
                   "edges_full": len(full_ids), "edges_full_by_type": dict(sorted(full_types.items())),
                   "member_ties": len(member_ties), "cases": len(cases), "org_shards": len(shards), **ledger_stats},
        "publication_budget": {
            "money_edges_per_member": MONEY_EDGES_PER_MEMBER, "former_member_ledger_rows": FORMER_MEMBER_LEDGER_ROWS,
            "money_members_per_org": MONEY_MEMBERS_PER_ORG,
            "rule": ("Full Edge objects appear only in member files: every non-money edge, every Case edge and the "
                     f"{MONEY_EDGES_PER_MEMBER} largest money edges per member. Other money ties are ledger rows "
                     f"(complete for current members, largest {FORMER_MEMBER_LEDGER_ROWS} for former members); "
                     "ledger_totals always cover all of them. Org files list every non-money tie and money ties for "
                     f"their {MONEY_MEMBERS_PER_ORG} largest members; ledger_totals cover the rest.")},
        "unmatched": {
            "trades_without_ticker": trades_report.get("null_ticker"),
            "tickers_without_sec_match": reports.get("sec", {}).get("tickers_unmatched"),
            "trades_with_unmatched_ticker": reports.get("sec", {}).get("trades_unmatched_ticker"),
            "edges_dropped_at_assembly": edge_report["edges_dropped"],
        },
        "exclusions": trades_report.get("exclusions", {}),
        "assembly": {**edge_report, "org_files": org_files},
        "coverage_notes": [
            f"House trades: the dataset's House filings begin {trades_report['coverage']['rep']['first_filing']}; "
            "earlier House years are marked none (a few late-filed earlier trades still appear).",
            f"Senate trades: filings begin {trades_report['coverage']['sen']['first_filing']} (STOCK Act PTRs began July 2012).",
            f"Latest filings: House {trades_report['coverage']['rep']['last_filing']}, Senate {trades_report['coverage']['sen']['last_filing']}.",
            "Money coverage per year comes from the money source plug-ins; it is none where no plug-in declares it.",
            "Committee assignments (sits_with) are the current Congress only.",
        ],
    }
    files: list[tuple[str, Any]] = [
        ("members.json", [summaries[m] for m in sorted(summaries)]),
        ("orgs.json", list(used_orgs.values())),
        ("board.json", {"states": dict(sorted(states.items())), "strings": strings, "nodes": dict(sorted(board_nodes.items()))}),
        ("member-ties.json", member_ties), ("cases.json", cases),
        *member_files, *((f"orgs/{k}.json", dict(sorted(v.items()))) for k, v in sorted(shards.items())),
    ]
    staging = OUT.with_name(OUT.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    write_tree(staging, files)
    sizes = {p.relative_to(staging).as_posix(): p.stat().st_size for p in staging.rglob("*.json")}
    meta["files"] = {"count": len(sizes) + 1, "bytes": sum(sizes.values()),
                     "largest": dict(sorted(sizes.items(), key=lambda kv: -kv[1])[:10])}
    write_json(staging / "meta.json", meta)
    swap_into_place(staging)

    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    groups: Counter[str] = Counter()
    for rel, size in sizes.items():
        groups[rel.split("/")[0] if "/" in rel else rel] += size
    print(f"edges: {len(edges)} {dict(sorted(edge_types.items()))}; dropped: {edge_report['edges_dropped']}")
    print(f"full edges: {len(full_ids)} {dict(sorted(full_types.items()))}; {dict(ledger_stats)}")
    print(f"orgs: {len(used_orgs)}; cases: {len(cases)}; current members on board: {len(current)}")
    print_table("output size", [(k, f"{v / 1e6:.1f} MB") for k, v in groups.most_common()], ("file/dir", "size"))
    print_table("largest files", [(k, f"{v / 1e6:.1f} MB") for k, v in sorted(sizes.items(), key=lambda kv: -kv[1])[:12]],
                ("file", "size"))
    print(f"total web/public/data: {total / 1e6:.1f} MB in {sum(1 for p in OUT.rglob('*') if p.is_file())} files")
