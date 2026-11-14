"""Load the plug-in files every source module writes under pipeline/build/ (data dictionary: "Intermediate plug-in format").

Reads `orgs/*.jsonl`, `edges/*.jsonl` and `sources/*.json`. Writes nothing. Rules:
- orgs merge by id; for ticker/cik/sector the first non-null value wins (files in name order); a `company` row
  replaces the name and kind of an `other` row, and among rows of the same standing the later file's name wins;
- an edge with missing keys, a bad type/family, a derived edge without `stat` (or a filed edge with one), no
  evidence, an unknown endpoint or an evidence source not listed in `sources/*.json` is dropped and counted;
- edges with the same type/from/to/via are merged (by_year re-summed); two derived edges never merge.

Memory (why two passes): evidence is most of the plug-in bytes but is published only on full edges (a few percent of
all ties). load_edges(slim=True) drops it after validating; attach_evidence() re-reads the files and restores it on
the edges that will be published in full, with the same merge rule as merge_edges.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from ..config import MAX_EVIDENCE
from ..contract import EDGE_KEYS, FAMILY, Edge, OrgSummary
from ..edges import by_year, edge_id, sum_amounts
from ..util import EDGES_DIR, ORGS_DIR, SOURCES_DIR, read_json, read_jsonl

Orgs = dict[str, OrgSummary]
MoneyCoverage = dict[str, dict[str, str]]   # chamber -> year -> "full" | "partial"


def load_orgs() -> tuple[Orgs, list[str]]:
    orgs: Orgs = {}
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


def merge_edges(a: Edge, b: Edge) -> Edge:
    """Two plug-in edges with the same key. No current plug-in emits such duplicates (meta.assembly shows
    edges_after_merge == sum of edges_read); the rule exists so a second source for the same tie adds up."""
    if a["stat"] is not None or b["stat"] is not None:
        raise ValueError(f"duplicate derived edge {a['type']} {a['from']['id']} {a['to']['id']}")
    years = by_year([(y["y"], y["n"], y) for y in a["by_year"] + b["by_year"]])
    notes = [n for n in (a["note"], b["note"]) if n]
    evidence = merge_evidence(a["evidence"], b["evidence"])
    return {**a, "by_year": years, "amount": sum_amounts(years), "count": sum(y["n"] for y in years),
            "first": min(a["first"], b["first"]), "last": max(a["last"], b["last"]), "evidence": evidence,
            "evidence_total": a["evidence_total"] + b["evidence_total"], "weak": a["weak"] or b["weak"],
            "note": "; ".join(dict.fromkeys(notes)) or None}


def line_problem(e: dict[str, Any], members: set[str], orgs: Orgs, sources: set[str]) -> str | None:
    problem = edge_problem(e)
    if problem is None:
        for end in (e["from"], e["to"]):
            known = end["id"] in members if end["kind"] == "member" else end["id"] in orgs
            if not known:
                problem = f"unknown {end['kind']} endpoint"
        if any(ev["source"] not in sources for ev in e["evidence"]):
            problem = "evidence source not listed in sources/*.json"
    return problem


def edge_key(e: dict[str, Any]) -> tuple[str, str, str, str | None]:
    """Merge key; orders an undirected edge's ends in place first."""
    if not e["directed"] and e["from"]["id"] > e["to"]["id"]:
        e["from"], e["to"] = e["to"], e["from"]
    return e["type"], e["from"]["id"], e["to"]["id"], (e["via"] or {}).get("id")


def merge_evidence(a: list[Any], b: list[Any]) -> list[Any]:
    return sorted(a + b, key=lambda ev: ev.get("date") or "", reverse=True)[:MAX_EVIDENCE]


def load_edges(members: set[str], orgs: Orgs, sources: set[str], slim: bool = False) -> tuple[list[Edge], dict[str, Any]]:
    """Every valid plug-in edge with its id, sorted by (type, from, to, via), plus the assembly report.
    slim=True leaves `evidence` empty (see attach_evidence)."""
    merged: dict[tuple[str, str, str, str | None], Edge] = {}
    dropped: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)
    read: Counter[str] = Counter()
    for path in sorted(EDGES_DIR.glob("*.jsonl")):
        for e in read_jsonl(path):
            read[path.name] += 1
            problem = line_problem(e, members, orgs, sources)
            if problem:
                key = f"{path.name}: {problem}"
                dropped[key] += 1
                if len(examples[key]) < 10:
                    examples[key].append(f"{e.get('type')} {e.get('from', {}).get('id')} -> {e.get('to', {}).get('id')}")
                continue
            key = edge_key(e)
            if slim:
                e["evidence"] = []
            merged[key] = merge_edges(merged[key], e) if key in merged else e
    edges = []
    for key in sorted(merged):
        e = merged.pop(key)
        e["id"] = edge_id(e["type"], e["from"], e["to"], e["via"])
        edges.append(e)
    ids = Counter(e["id"] for e in edges)
    if max(ids.values(), default=1) > 1:
        raise AssertionError("edge id collision")
    return edges, {"edges_read": dict(read), "edges_after_merge": len(edges), "edges_dropped": dict(dropped),
                   "edges_dropped_examples": dict(examples)}


def attach_evidence(edges: list[Edge], wanted: set[str], members: set[str], orgs: Orgs, sources: set[str]) -> None:
    """Second pass: restore `evidence` on the edges whose id is in `wanted`, merging duplicates as merge_edges does."""
    by_key = {(e["type"], e["from"]["id"], e["to"]["id"], (e["via"] or {}).get("id")): e for e in edges if e["id"] in wanted}
    seen: set[tuple[str, str, str, str | None]] = set()
    for path in sorted(EDGES_DIR.glob("*.jsonl")):
        for e in read_jsonl(path):
            if line_problem(e, members, orgs, sources):
                continue
            key = edge_key(e)
            target = by_key.get(key)
            if target is None:
                continue
            target["evidence"] = merge_evidence(target["evidence"], e["evidence"]) if key in seen else e["evidence"]
            seen.add(key)
    if seen != set(by_key):
        raise AssertionError(f"{len(set(by_key) - seen)} full edges lost their evidence")


def load_sources() -> tuple[dict[str, Any], dict[str, Any], MoneyCoverage]:
    """(sources by id, report by file stem, money coverage). A year is `full` if any plug-in declares it full."""
    sources: dict[str, Any] = {}
    reports: dict[str, Any] = {}
    money: MoneyCoverage = {"rep": {}, "sen": {}}
    for path in sorted(SOURCES_DIR.glob("*.json")):
        doc = read_json(path)
        sources.update(doc.get("sources", {}))
        reports[path.stem] = doc.get("report", {})
        for chamber, years in (doc.get("coverage", {}).get("money") or {}).items():
            for year, level in years.items():
                if money[chamber].get(year) != "full":
                    money[chamber][year] = level
    return sources, reports, money
