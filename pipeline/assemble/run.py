"""Assemble every plug-in source into the site files (docs/data-dictionary.md, "Files in web/public/data/").

Reads pipeline/build/{spine.json, trades_resolved.parquet, edges/*.jsonl, orgs/*.jsonl, sources/*.json}. Writes
every file in web/public/data/ except the holdings files (carried over), into a staging directory that is then
swapped into place. Steps: load plug-ins -> index edges by member and org -> cases -> member files (written as they
are built, so they are not all held in memory) -> org shards -> summary files (incl. delays.json) -> meta.json -> swap.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Any

import pyarrow.parquet as pq

from .. import config
from ..config import BOARD_EDGES, FORMER_MEMBER_LEDGER_ROWS, LEDGER_ONLY_TYPES, MONEY_EDGES_PER_MEMBER, MONEY_MEMBERS_PER_ORG
from ..contract import Case, Edge, Trade
from ..util import BUILD, PORTRAITS, print_table, read_json, utc_now, write_json
from .budget import ledger_totals, member_end, member_ledger, org_ties, split_member_edges
from .cases import find_cases
from .delays import build_delays
from .finance import load_campaign_finance
from .members import board_order, coverage, node_info, trade_file, trade_summary
from .orgs import SplitStats, org_index, party_split, shard
from .plugins import attach_evidence, load_edges, load_orgs, load_sources
from .publish import git_commit, staging_dir, swap_into_place
from .wall import wall_rows, wall_years


def publication_budget() -> dict[str, Any]:
    """Echoed into meta.json so a reader of the data knows the caps without reading code."""
    return {
        "money_edges_per_member": MONEY_EDGES_PER_MEMBER, "former_member_ledger_rows": FORMER_MEMBER_LEDGER_ROWS,
        "money_members_per_org": MONEY_MEMBERS_PER_ORG, "ledger_only_types": list(LEDGER_ONLY_TYPES),
        "case_rule": config.CASE_RULE, "case_min_types": config.CASE_MIN_TYPES,
        "rule": ("Full Edge objects appear only in member files: every non-money edge, every Case edge and the "
                 f"{MONEY_EDGES_PER_MEMBER} largest money edges per member. Other money ties are ledger rows "
                 f"(complete for current members, largest {FORMER_MEMBER_LEDGER_ROWS} for former members); "
                 "ledger_totals always cover all of them. Org files list every non-money tie and money ties for "
                 f"their {MONEY_MEMBERS_PER_ORG} largest members; ledger_totals cover the rest.")}


def merged_exclusions(reports: dict[str, Any]) -> dict[str, Any]:
    """meta.json `exclusions`: the trade exclusions plus the FEC stage's (conduit_pass_through)."""
    return {**reports.get("hf_trades", {}).get("exclusions", {}), **reports.get("fec", {}).get("exclusions", {})}


def run() -> None:
    spine = read_json(BUILD / "spine.json")
    sources, reports, money_cov = load_sources()
    orgs, org_files = load_orgs()
    edges, edge_report = load_edges(set(spine), orgs, set(sources), slim=True)
    trades: list[Trade] = pq.read_table(BUILD / "trades_resolved.parquet").to_pylist()
    trades_report = reports["hf_trades"]
    finance = load_campaign_finance(set(spine))
    this_year = date.today().year

    by_member_trades: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        by_member_trades[t["member"]].append(t)
    member_edges: dict[str, list[Edge]] = defaultdict(list)
    org_edges: dict[str, list[Edge]] = defaultdict(list)
    for e in edges:
        for end in {e["from"]["id"]: e["from"], e["to"]["id"]: e["to"]}.values():
            (member_edges if end["kind"] == "member" else org_edges)[end["id"]].append(e)
    split_stats = SplitStats()
    used_orgs = {o: {**orgs[o], "degree": len({end["id"] for e in es for end in (e["from"], e["to"]) if end["kind"] == "member"}),
                     "split": party_split(es, spine, split_stats)}
                 for o, es in sorted(org_edges.items())}
    split_report = party_split_report(split_stats, spine)
    cases = find_cases(edges)
    case_edges = {eid for c in cases for eid in c["edges"]}
    member_cases: dict[str, list[Case]] = defaultdict(list)
    for c in cases:
        member_cases[c["member"]].append(c)
    failed: dict[str, set[int]] = defaultdict(set)
    for f in trades_report.get("failed_filings", []):
        failed[f["member"]].add(f["year"])

    # Publication budget for every member first, so evidence can be restored on exactly the full edges.
    full: dict[str, list[Edge]] = {}
    ledgers: dict[str, tuple[list[Edge], list[Edge]]] = {}
    for mid in sorted(spine):
        full[mid], rest, context = split_member_edges(mid, member_edges.get(mid, []), case_edges)
        ledgers[mid] = (rest, context)
    full_pairs = {(mid, e["id"]) for mid, es in full.items() for e in es}
    full_ids = {eid for _, eid in full_pairs}
    attach_evidence(edges, full_ids, set(spine), orgs, set(sources))

    staging = staging_dir()
    summaries: dict[str, dict[str, Any]] = {}
    ledger_stats: Counter[str] = Counter()
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
        rest, context = ledgers.pop(mid)
        shown = (rest if m["current"] else rest[:FORMER_MEMBER_LEDGER_ROWS]) + context
        ledger_stats["ledger_money_ties"] += len(rest)
        ledger_stats["ledger_rows_published"] += len(shown)
        ledger_stats["ledger_rows_former_members_cut"] += len(rest) + len(context) - len(shown)
        ts = sorted(by_member_trades.get(mid, []), key=lambda t: (t["date"] or date.min, t["id"]), reverse=True)
        if ts:
            write_json(staging / "trades" / f"{mid}.json", trade_file(ts))
        refs = {end["id"]: end for e in full[mid] for end in (e["from"], e["to"]) if end["id"] != mid}
        write_json(staging / "members" / f"{mid}.json", {
            "member": {**summary, "terms": m["terms"], "committees": m["committees"], "fec_ids": m["fec_ids"]},
            "edges": full[mid], "board": [e["id"] for e in sorted(full[mid], key=lambda e: board_order(e, case_edges))[:BOARD_EDGES]],
            "nodes": {k: node_info(v, orgs, spine) for k, v in sorted(refs.items())},
            "ledger": member_ledger(mid, shown), "ledger_totals": ledger_totals(rest + context),
            "trade_summary": trade_summary(ts),
            "cases": member_cases.get(mid, []), "campaign_finance": finance.get(mid),
            "coverage": coverage(m, trades_report["coverage"], failed[mid], money_cov, this_year)})

    shards: dict[str, dict[str, Any]] = defaultdict(dict)
    for o, es in org_edges.items():
        ties, rest = org_ties(es, full_pairs)
        chambers = Counter(spine[mid]["chamber"] for mid in {member_end(e) for e in es})
        shards[shard(o)][o] = {"org": used_orgs[o], "ties": ties, "ledger_totals": ledger_totals(rest),
                               "chambers": {ch: chambers[ch] for ch in ("rep", "sen")},
                               "years": [min(int(e["first"][:4]) for e in es), max(int(e["last"][:4]) for e in es)]}
    for k, v in sorted(shards.items()):
        write_json(staging / "orgs" / f"{k}.json", dict(sorted(v.items())))
    n_shards = len(shards)
    del shards

    states: dict[str, list[str]] = defaultdict(list)
    current = sorted((s for s in summaries.values() if s["current"]),
                     key=lambda s: (s["state"], s["chamber"] != "sen", s["district"] or 0, s["last"], s["id"]))
    for s in current:
        states[s["state"]].append(s["id"])
    # Graph-view ties: member pairs that exist as a full Edge somewhere, without context (committee) ties.
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
                   "member_ties": len(member_ties), "cases": len(cases), "org_shards": n_shards, **ledger_stats,
                   **trades_report.get("amendment_counts", {})},
        "publication_budget": publication_budget(),
        "unmatched": {
            "trades_without_ticker": trades_report.get("null_ticker"),
            "tickers_without_sec_match": reports.get("sec", {}).get("tickers_unmatched"),
            "trades_with_unmatched_ticker": reports.get("sec", {}).get("trades_unmatched_ticker"),
            "edges_dropped_at_assembly": edge_report["edges_dropped"],
        },
        "exclusions": merged_exclusions(reports),
        "assembly": {**edge_report, "org_files": org_files, "party_split": split_report},
        "coverage_notes": [
            f"House trades: the dataset's House filings begin {trades_report['coverage']['rep']['first_filing']}; "
            "earlier House years are marked none (a few late-filed earlier trades still appear).",
            f"Senate trades: filings begin {trades_report['coverage']['sen']['first_filing']} (STOCK Act PTRs began July 2012).",
            f"Latest filings: House {trades_report['coverage']['rep']['last_filing']}, Senate {trades_report['coverage']['sen']['last_filing']}.",
            "Money coverage per year comes from the money source plug-ins; it is none where no plug-in declares it.",
            "Committee assignments (sits_with) are the current Congress only.",
        ],
    }
    trade_first = {ch: int(str(trades_report["coverage"][ch]["first_filing"])[:4]) for ch in ("rep", "sen")}
    for rel, obj in (
        ("members.json", [summaries[m] for m in sorted(summaries)]),
        ("orgs.json", list(used_orgs.values())),
        ("board.json", {"states": dict(sorted(states.items()))}),
        ("member-ties.json", member_ties), ("cases.json", cases),
        ("wall.json", wall_rows(summaries, member_edges)), ("org-index.json", org_index(used_orgs, org_edges, spine)),
        ("delays.json", build_delays(trades)),
        ("wall-years.json", wall_years(spine, member_edges, member_cases, by_member_trades, this_year, trade_first)),
    ):
        write_json(staging / rel, obj)
    sizes = {p.relative_to(staging).as_posix(): p.stat().st_size for p in staging.rglob("*.json")}
    meta["files"] = {"count": len(sizes) + 1, "bytes": sum(sizes.values()),
                     "largest": dict(sorted(sizes.items(), key=lambda kv: -kv[1])[:10])}
    write_json(staging / "meta.json", meta)
    swap_into_place(staging)
    report(sizes, edge_types, edge_report, full_ids, full_types, ledger_stats, len(used_orgs), len(cases), len(current))


def party_split_report(st: SplitStats, spine: dict[str, Any]) -> dict[str, Any]:
    """meta.json.assembly.party_split: how often a tie-year fell outside every term, and how many dollars the
    party-at-the-time rule counts under a party other than the member's latest one. The per-member list goes to
    pipeline/build/party_split_moves.json (not published)."""
    moved = sorted(((mid, a, b, round(v, 2)) for (mid, a, b), v in st.moved.items() if v), key=lambda r: (-r[3], r[0]))
    write_json(BUILD / "party_split_moves.json", [{"member": mid, "name": spine[mid]["name"], "latest": a, "counted": b,
                                                   "dollars": v} for mid, a, b, v in moved])
    out = {"rule": "each tie's by_year amounts count under the party of the member's term in that year",
           "tie_years_outside_terms": st.out_of_term_years, "edges_with_years_outside_terms": len(st.out_of_term_edges),
           "dollars_outside_terms": round(st.out_of_term_dollars, 2),
           "members_with_dollars_under_another_party": len({r[0] for r in moved}),
           "dollars_under_another_party": round(sum(r[3] for r in moved), 2)}
    print(f"party split: {out}")
    return out


def report(sizes: dict[str, int], edge_types: Counter[str], edge_report: dict[str, Any], full_ids: set[str],
           full_types: Counter[str], ledger_stats: Counter[str], n_orgs: int, n_cases: int, n_current: int) -> None:
    from ..util import OUT
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    groups: Counter[str] = Counter()
    for rel, size in sizes.items():
        groups[rel.split("/")[0] if "/" in rel else rel] += size
    print(f"edges: {sum(edge_types.values())} {dict(sorted(edge_types.items()))}; dropped: {edge_report['edges_dropped']}")
    print(f"full edges: {len(full_ids)} {dict(sorted(full_types.items()))}; {dict(ledger_stats)}")
    print(f"orgs: {n_orgs}; cases: {n_cases}; current members on board: {n_current}")
    print_table("output size", [(k, f"{v / 1e6:.1f} MB") for k, v in groups.most_common()], ("file/dir", "size"))
    print_table("largest files", [(k, f"{v / 1e6:.1f} MB") for k, v in sorted(sizes.items(), key=lambda kv: -kv[1])[:12]],
                ("file", "size"))
    print(f"total web/public/data: {total / 1e6:.1f} MB in {sum(1 for p in OUT.rglob('*') if p.is_file())} files")
