"""LDA stage: python -m pipeline.lda.run [--download] [--contrib-years 2019-2026] [--filing-years 2019-2026].

Reads cached LDA API pages (pipeline/.cache/lda), optionally refreshing them first, and writes
pipeline/build/edges/lda.jsonl, pipeline/build/orgs/lda.jsonl, pipeline/build/sources/lda.json and
docs/validation/lda-sample.csv. Never fails on an API outage: it falls back to the cached pages and reports how
old they are.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import random
import sys
from collections import Counter, defaultdict

from . import download as dl
from .build import BUILD, REPO, OrgResolver, fec_committee_index, load_matcher, manifest_hash, read_slices
from .edges import contribution_rows, door_edges, implausible, latest_reports, money_edges, position_rows

EDGES = BUILD / "edges" / "lda.jsonl"
ORGS = BUILD / "orgs" / "lda.jsonl"
SOURCES = BUILD / "sources" / "lda.json"
SAMPLE = REPO / "docs" / "validation" / "lda-sample.csv"
DISCLAIMER = ("The Senate Office of Public Records and the Clerk of the House cannot vouch for the accuracy or "
              "completeness of data obtained through the LDA API; documents are as filed by registrants and "
              "lobbyists. Use is subject to the LDA API Terms of Service (https://lda.gov/api/tos/).")
CONTRIB_KINDS = ["contrib-all"] + [f"contrib-{t}" for t in dl.CONTRIBUTION_TYPES]


def dumps(o) -> str:
    return json.dumps(o, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def write_jsonl(path, rows) -> tuple[int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = "".join(dumps(r) + "\n" for r in rows)
    path.write_text(data, encoding="utf-8")
    return len(rows), len(data.encode())


def year_coverage(status: dict[int, dict]) -> dict[str, str]:
    """full: every cached slice for the year is complete; partial: some pages cached."""
    out = {}
    for y, s in sorted(status.items()):
        if s["pages_cached"] == 0:
            continue
        out[str(y)] = "full" if s["complete"] == s["slices"] and s["slices"] else "partial"
    return out


def contrib_by_year(years: list[int]) -> tuple[dict, dict]:
    """Per year use the 'contrib-all' slices when they are complete, else the per-type slices if those are, else
    whatever is cached (coverage then says partial)."""
    allp, alls = read_slices(["contrib-all"], years)
    typp, typs = read_slices([f"contrib-{t}" for t in dl.CONTRIBUTION_TYPES], years)
    out, status = {}, {}
    for y in years:
        a, t = alls.get(y), typs.get(y)
        a_full = a and a["slices"] and a["complete"] == a["slices"]
        t_full = t and t["slices"] and t["complete"] == t["slices"] and t["slices"] >= len(dl.CONTRIBUTION_TYPES)
        if a_full or not t_full:
            merged = dict(typp.get(y, {}))
            merged.update(allp.get(y, {}))
            out[y] = merged
            st = dict(a or {"slices": 0, "complete": 0, "pages": 0, "pages_cached": 0, "rows": 0})
            if not a_full and t and t["pages_cached"]:
                st["pages_cached"] += t["pages_cached"]
                st["complete"] = 0
            status[y] = st
        else:
            out[y], status[y] = typp.get(y, {}), t
    return out, status


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--download", action="store_true", help="fetch missing pages first (incremental)")
    ap.add_argument("--new-window", action="store_true", help="with --download: also fetch filings posted since "
                                                               "the last cutoff (daily job)")
    ap.add_argument("--max-minutes", type=float, default=None)
    ap.add_argument("--contrib-years", default=f"{dl.FIRST_CONTRIB_YEAR}-{dt.date.today().year}")
    ap.add_argument("--filing-years", default=f"2019-{dt.date.today().year}")
    a = ap.parse_args(argv)
    cyears, fyears = dl.parse_years(a.contrib_years), dl.parse_years(a.filing_years)
    report: dict = {"download": None}

    if a.download:
        try:
            r1 = dl.run(cyears, ["contrib-all"], new_window=a.new_window, max_minutes=a.max_minutes)
            r2 = dl.run(fyears, ["filings-covered"], max_minutes=a.max_minutes)
            report["download"] = {"contributions": r1, "filings": r2}
        except Exception as e:  # noqa: BLE001 - an outage must not stop the pipeline
            report["download"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
            print(f"  LDA download failed ({type(e).__name__}); using cached pages")

    cuts = dl.windows()
    if not cuts:
        print("  lda: no cached LDA pages and nothing downloaded; skipping (set LDA_API_KEY and run "
              "python -m pipeline.lda.download)")
        return 0
    stale_days = (dt.date.today() - dt.date.fromisoformat(cuts[-1])).days
    report["cache"] = {"cutoffs": cuts, "latest_cutoff": cuts[-1], "stale_days": stale_days}

    spine = json.loads((BUILD / "spine.json").read_text())
    fec = fec_committee_index()
    matcher = load_matcher(spine, fec)
    orgs = OrgResolver.load()
    report["reference"] = {"members": len(spine), "fec_member_committee_names": len(fec["member"]),
                           "fec_member_committee_names_ambiguous": sum(1 for v in fec["member"].values() if len(v) > 1),
                           "fec_other_committee_names": len(fec["other"])}

    # ---- contributions
    by_year, cstatus = contrib_by_year(cyears)
    crep: dict = {}
    reports = latest_reports(by_year, crep)
    rows = contribution_rows(reports, matcher, crep)
    medges = money_edges(rows, orgs)
    crep["coverage"] = year_coverage(cstatus)
    crep["slices"] = {str(y): s for y, s in sorted(cstatus.items()) if s.get("pages_cached")}
    crep["match"] = match_rates(rows)
    crep["top_unmatched"] = top_unmatched(rows)
    flagged = sorted((x for x in rows if x["bio"] and implausible(x)), key=lambda x: -x["amount"])
    crep["implausible_feca_items"] = {"count": len(flagged), "dollars": round(sum(x["amount"] for x in flagged), 2),
                                      "top": [{k: x[k] for k in ("bio", "registrant", "contributor", "payee", "amount",
                                                                 "date", "url")} for x in flagged[:20]]}
    report["contributions"] = crep

    # ---- covered positions
    fby, fstatus = read_slices(["filings-covered"], fyears)
    frep: dict = {}
    prow = position_rows(fby, frep)
    dedges, unmatched_pos = door_edges(prow, orgs, matcher, frep)
    frep["coverage"] = year_coverage(fstatus)
    frep["slices"] = {str(y): s for y, s in sorted(fstatus.items()) if s.get("pages_cached")}
    frep["edges"] = len(dedges)
    frep["edges_weak"] = sum(e["weak"] for e in dedges)
    frep["top_unmatched_positions"] = [{"position": p, "rows": n} for p, n in
                                       sorted(unmatched_pos.items(), key=lambda kv: (-kv[1], kv[0]))[:100]]
    report["revolving_door"] = frep

    edges = medges + dedges
    for e in edges:   # contract checks
        assert 1 <= len(e["evidence"]) <= 5 and e["count"] == sum(b["n"] for b in e["by_year"])
    n_e, b_e = write_jsonl(EDGES, edges)
    n_o, b_o = write_jsonl(ORGS, [orgs.orgs[k] for k in sorted(orgs.orgs)])
    report["org_resolution"] = dict(sorted(orgs.used.items()))
    report["outputs"] = {"edges": n_e, "edges_bytes": b_e, "orgs": n_o, "orgs_bytes": b_o,
                         "edges_by_type": dict(Counter(e["type"] for e in edges))}
    report["sanity"] = sanity(medges, dedges, spine, orgs)
    write_sample(rows)

    mh, nslices = manifest_hash(CONTRIB_KINDS + ["filings-covered"])
    retrieved = max((s for s in _finished()), default=cuts[-1])
    sources = {"lda": {
        "name": "Lobbying Disclosure Act filings (LD-2 quarterly reports, LD-203 contribution reports) via the LDA "
                "REST API, Secretary of the Senate and Clerk of the House",
        "url": "https://lda.gov/api/v1/", "revision": f"cutoff {cuts[-1]}; manifest sha256 {mh[:16]}",
        "retrieved": retrieved, "accessed": retrieved,
        "licence": "US government public records; LDA API Terms of Service https://lda.gov/api/tos/",
        "disclaimer": DISCLAIMER, "manifest_sha256": mh, "slices": nslices}}
    coverage = {"lobbying": {"contributions": crep["coverage"], "revolving_door": frep["coverage"]}}
    SOURCES.parent.mkdir(parents=True, exist_ok=True)
    SOURCES.write_text(json.dumps({"sources": sources, "report": report, "coverage": coverage},
                                  indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print_summary(report)
    return 0


def _finished():
    for st in (dl.CACHE / "pages").glob("*/*/*/state.json"):
        f = json.loads(st.read_text()).get("finished")
        if f:
            yield f[:10]


def match_rates(rows: list[dict]) -> dict:
    by = defaultdict(lambda: [0, 0.0])
    for x in rows:
        k = x["method"] if x["bio"] else f"unmatched:{x['method']}"
        by[k][0] += 1
        by[k][1] += x["amount"]
    nt, dtot = len(rows) or 1, sum(x["amount"] for x in rows) or 1
    return {k: {"rows": n, "dollars": round(s, 2), "row_share": round(n / nt, 4), "dollar_share": round(s / dtot, 4)}
            for k, (n, s) in sorted(by.items())}


def top_unmatched(rows: list[dict], n: int = 100) -> list[dict]:
    agg = defaultdict(lambda: [0, 0.0])
    for x in rows:
        if not x["bio"]:
            k = (x["honoree"], x["payee"], x["method"])
            agg[k][0] += 1
            agg[k][1] += x["amount"]
    top = sorted(agg.items(), key=lambda kv: (-kv[1][1], kv[0]))[:n]
    return [{"honoree": h, "payee": p, "reason": m, "rows": c, "dollars": round(s, 2)} for (h, p, m), (c, s) in top]


def sanity(medges, dedges, spine, orgs) -> dict:
    reg, mem = defaultdict(float), defaultdict(float)
    for e in medges:
        reg[e["from"]["id"]] += e["amount"]["exact"]
        mem[e["to"]["id"]] += e["amount"]["exact"]
    name = lambda oid: orgs.orgs.get(oid, {}).get("name", oid)  # noqa: E731
    door = Counter(e["from"]["id"] for e in dedges)
    return {
        "top_registrants": [[k, name(k), round(v, 2)] for k, v in sorted(reg.items(), key=lambda kv: -kv[1])[:20]],
        "top_members": [[k, spine[k]["name"], round(v, 2)] for k, v in sorted(mem.items(), key=lambda kv: -kv[1])[:20]],
        "top_revolving_door_members": [[k, spine[k]["name"], n] for k, n in door.most_common(20)]}


def write_sample(rows: list[dict]) -> None:
    matched = sorted((x for x in rows if x["bio"]), key=lambda x: (x["uuid"], x["item"]))
    pick = random.Random(20261113).sample(matched, min(10, len(matched)))
    SAMPLE.parent.mkdir(parents=True, exist_ok=True)
    cols = ["kind", "member", "method", "registrant", "lobbyist", "contributor", "payee", "honoree", "type",
            "amount", "date", "rows", "filing_url", "filing_uuid"]
    with open(SAMPLE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for x in pick:
            w.writerow(["matched_sample", x["bio"], x["method"], x["registrant"], x["lobbyist"], x["contributor"],
                        x["payee"], x["honoree"], x["type"], x["amount"], x["date"], 1, x["url"], x["uuid"]])
        for u in top_unmatched(rows):
            w.writerow(["unmatched_top", "", u["reason"], "", "", "", u["payee"], u["honoree"], "", u["dollars"], "",
                        u["rows"], "", ""])


def print_summary(rep: dict) -> None:
    c, r = rep["contributions"], rep["revolving_door"]
    print(f"  lda: cache cutoff {rep['cache']['latest_cutoff']} ({rep['cache']['stale_days']} days old)")
    print(f"  contributions coverage {c['coverage']}")
    print(f"  reports kept {c['reports_kept']} (superseded {c['reports_superseded']}); items {c['items_total']}; "
          f"duplicates removed {c['duplicates_removed']}; excluded {c['items_excluded']}")
    for k, v in c["match"].items():
        print(f"    {k:40} rows {v['rows']:7d} ({v['row_share']:.1%})  ${v['dollars']:>14,.0f} ({v['dollar_share']:.1%})")
    print(f"  revolving door coverage {r['coverage']}; rows {r['lobbyist_filing_rows']}; outcomes "
          f"{r['position_outcomes_by_row']}; edges {r['edges']} (weak {r['edges_weak']})")
    print(f"  outputs {rep['outputs']}")


if __name__ == "__main__":
    sys.exit(main())
