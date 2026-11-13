"""FEC campaign-finance module: python -m pipeline.fec.run [--cycles 2022,2024] [--min-total N]

Writes
  pipeline/build/edges/fec_pac_money.jsonl, fec_outside_spending.jsonl, fec_funds.jsonl,
  fec_fundraises_with.jsonl   (contract Edge without id)
  pipeline/build/orgs/fec.jsonl (contract OrgSummary without degree)
  pipeline/build/sources/fec.json (source metadata + audit report, merged into meta.json)
and prints the audit and sanity checks.
"""
from __future__ import annotations

import argparse
import heapq
import json
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import build, download, load, refs
from .load import q

BUILD = refs.BUILD
EDGE_FILES = {t: BUILD / "edges" / f"fec_{t}.jsonl"
              for t in ("pac_money", "outside_spending", "funds", "fundraises_with")}
ORG_FILE = BUILD / "orgs" / "fec.jsonl"
SOURCE_FILE = BUILD / "sources" / "fec.json"
SIZE_WARN = 150 * 1024 * 1024
ALL_CYCLES = list(range(2000, 2027, 2))

# Five well-known members across parties and both chambers for the weball check.
SANITY_MEMBERS = ["P000197", "S000148", "M000355", "O000172", "J000289", "C001098"]


def dumps(o) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def write_jsonl(path: Path, rows: list[dict]) -> tuple[int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = sorted(dumps(r) for r in rows)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")
    os.replace(tmp, path)
    return len(lines), path.stat().st_size


class Summary:
    """Small running summaries so edges never have to be held in memory."""

    def __init__(self) -> None:
        self.by_type: Counter = Counter()
        self.pm_sizes: list[tuple[float, int, bool]] = []   # pac_money (exact, bytes, to current member)
        self.top: dict[str, list] = {"org": [], "pac_money": [], "funds": []}

    def _push(self, name: str, amt: float, e: dict) -> None:
        h = self.top[name]
        item = (amt, e["type"], e["from"]["id"], e["to"]["id"], (e.get("via") or {}).get("id") or "")
        if len(h) < 20:
            heapq.heappush(h, (item, _slim(e)))
        elif item > h[0][0]:
            heapq.heapreplace(h, (item, _slim(e)))

    def add(self, e: dict, nbytes: int, current: set[str]) -> None:
        self.by_type[e["type"]] += 1
        amt = e["amount"]["exact"]
        if e["type"] == "pac_money":
            self.pm_sizes.append((amt, nbytes, e["to"]["id"] in current))
            self._push("pac_money", amt, e)
        if e["from"]["kind"] == "org" and amt is not None:
            self._push("org", amt, e)
        if e["type"] == "funds":
            self._push("funds", amt, e)

    def tops(self, name: str) -> list[dict]:
        return [e for _, e in sorted(self.top[name], key=lambda x: x[0], reverse=True)]


def _slim(e: dict) -> dict:
    return {"type": e["type"], "from": e["from"], "to": e["to"], "via": e["via"], "amount": e["amount"],
            "count": e["count"]}


def write_jsonl_stream(path: Path, rows, summ: "Summary", current: set[str]) -> tuple[int, int]:
    """Write rows (already in deterministic order) one per line; key-sorted JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    n = 0
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            line = dumps(r)
            f.write(line + "\n")
            summ.add(r, len(line.encode("utf-8")) + 1, current)
            n += 1
    os.replace(tmp, path)
    return n, path.stat().st_size


def table(title: str, headers: tuple, rows: list[tuple]) -> None:
    rows = [tuple("" if v is None else (f"{v:,.0f}" if isinstance(v, float) else
                                         (f"{v:,}" if isinstance(v, int) else str(v))) for v in r) for r in rows]
    w = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]
    print(f"\n{title}")
    print("  " + "  ".join(h.ljust(x) for h, x in zip(headers, w)))
    for r in rows:
        print("  " + "  ".join(v.rjust(x) if v[:1].isdigit() or v[:1] in "-$" else v.ljust(x)
                               for v, x in zip(r, w)))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cycles", help="comma-separated election cycles (even years); default 2000-2026")
    ap.add_argument("--min-total", type=float, default=0.0,
                    help="drop pac_money/outside_spending/funds edges whose net total is below this (default 0: keep all)")
    ap.add_argument("--no-shared", action="store_true",
                    help="ignore pipeline/build/spine.json and company_names.json; use the upstream fallbacks")
    ap.add_argument("--out-dir", help="write outputs under this directory instead of pipeline/build (for tests)")
    args = ap.parse_args(argv)
    cycles = sorted({int(c) for c in args.cycles.split(",")}) if args.cycles else ALL_CYCLES
    bad = [c for c in cycles if c % 2 or c < 2000 or c > 2026]
    if bad:
        ap.error(f"cycles must be even years 2000-2026: {bad}")
    global EDGE_FILES, ORG_FILE, SOURCE_FILE
    if args.out_dir:
        base = Path(args.out_dir)
        EDGE_FILES = {t: base / "edges" / p.name for t, p in EDGE_FILES.items()}
        ORG_FILE, SOURCE_FILE = base / "orgs" / "fec.jsonl", base / "sources" / "fec.json"

    t0 = time.monotonic()
    report: dict = {"cycles": cycles, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    members = refs.load_members(prefer_shared=not args.no_shared)
    companies = refs.load_companies(prefer_shared=not args.no_shared)
    overrides = refs.load_overrides()
    report["inputs"] = {"members": members.source, "members_n": len(members.info),
                        "candidate_ids_mapped": len(members.cand_to_bio),
                        "candidate_ids_conflicting": members.conflicts,
                        "companies": companies.source, "company_names_unique": len(companies.index),
                        "override_rows": overrides.rows, "override_rows_not_fec_or_unreviewed": overrides.ignored}
    print(f"members: {len(members.info):,} from {members.source}; {len(members.cand_to_bio):,} FEC candidate ids")
    print(f"companies: {len(companies.index):,} unique normalised names from {companies.source}")
    no_fec = sorted(b for b, m in members.info.items() if not m.get("fec_ids"))
    report["members_without_fec_id"] = {
        "count": len(no_fec),
        "current": sorted(f"{b} {members.info[b]['name']}" for b in no_fec if members.info[b].get("current")),
        "all": no_fec}

    con = load.connect()
    audit: dict = {}
    print("loading bulk files ...", flush=True)
    load.load_all(con, cycles, audit)
    report["files"] = audit["files"]

    build.prepare_reference_tables(con, members, cycles, report)
    build.classify_rows(con, cycles, build.today_iso())
    build.resolve_orgs(con, companies, overrides, report)
    build.edge_inputs(con)
    member_names = {b: m["name"] for b, m in members.info.items()}
    current = {b for b, m in members.info.items() if m.get("current")}
    summ = Summary()
    stats: dict = {}
    used_orgs: set[str] = set()
    below = 0
    sizes = {}

    def checked(edges):
        nonlocal below
        for e in edges:
            # Contract checks the assembler also enforces.
            assert e["evidence"], e
            assert sum(y["n"] for y in e["by_year"]) == e["count"], e
            if e["amount"]["exact"] is not None:
                assert abs(sum(y["exact"] for y in e["by_year"]) - e["amount"]["exact"]) < 0.005, e
                if e["amount"]["exact"] < args.min_total:
                    below += 1
                    continue
            for end in (e["from"], e["to"]):
                if end["kind"] == "member":
                    assert end["id"] in members.info, end
                else:
                    used_orgs.add(end["id"])
            yield e

    for t, path in EDGE_FILES.items():
        if t == "fundraises_with":
            src = iter(build.fundraises_with(con, members, cycles, report))
        else:
            src = build.aggregate(con, member_names, t, stats)
        n, size = write_jsonl_stream(path, checked(src), summ, current)
        sizes[path.name] = {"edges": n, "bytes": size}
        print(f"  wrote {path.name}: {n:,} edges, {size / 2**20:,.1f} MiB", flush=True)
    report.update(stats)
    if args.min_total > 0:
        report["min_total_threshold"] = {"value": args.min_total, "edges_dropped": below}

    orgs = build.org_records(con, used_orgs, refs.sec_company_info(), report)
    lacking = used_orgs - {o["id"] for o in orgs}
    if lacking:
        raise SystemExit(f"self-check failed: {len(lacking)} edge org endpoints lack an org record")
    n, size = write_jsonl(ORG_FILE, orgs)
    sizes[ORG_FILE.name] = {"orgs": n, "bytes": size}
    report["outputs"] = sizes
    print(f"self-check: all {len(used_orgs):,} org endpoints have an org record")

    _audit_tables(con, report)
    _sanity(con, members, report, summ, sizes)
    _write_sources(report)
    print(f"\ndone in {time.monotonic() - t0:.0f}s")
    return 0


def _audit_tables(con, report: dict) -> None:
    rows = q(con, """SELECT cycle, rule, count(*), coalesce(sum(amt), 0) FROM p_rules GROUP BY ALL ORDER BY 1, 2""")
    per_cycle: dict = {}
    for cyc, rule, n, s in rows:
        per_cycle.setdefault(str(cyc), {})[rule] = {"rows": n, "dollars": round(float(s), 2)}
    report["pas2_rules_by_cycle"] = per_cycle
    tot = q(con, """SELECT rule, count(*), coalesce(sum(amt), 0) FROM p_rules GROUP BY 1 ORDER BY 1""")
    report["pas2_rules_total"] = {r: {"rows": n, "dollars": round(float(s), 2)} for r, n, s in tot}
    table("pas2 rows by rule, all cycles", ("rule", "rows", "dollars"), [(r, n, float(s)) for r, n, s in tot])
    table("files read (lines = rows parsed)", ("file", "cycle", "rows"),
          [(v["file"], v["cycle"], v["rows_loaded"]) for k, v in sorted(report["files"].items(),
                                                                       key=lambda kv: (kv[1]["file"], kv[1]["cycle"]))])
    # undated independent expenditures: the biggest spenders, for human review
    und = q(con, """SELECT r.CMTE_ID, any_value(c.CMTE_NM), count(*), sum(amt) FROM p_rules r
                    LEFT JOIN cm_latest c USING (CMTE_ID) WHERE rule='drop:date_missing_or_invalid'
                    GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 15""")
    report["undated_top_filers"] = [{"committee": c, "name": nm, "rows": n, "dollars": round(float(s or 0), 2)}
                                    for c, nm, n, s in und]
    earm = q(con, """SELECT r.CMTE_ID, any_value(c.CMTE_NM), count(*), sum(amt) FROM p_rules r
                     LEFT JOIN cm_latest c USING (CMTE_ID) WHERE rule='drop:earmarked_via_conduit'
                     GROUP BY 1 ORDER BY 4 DESC LIMIT 15""")
    report["earmarked_top_conduits"] = [{"committee": c, "name": nm, "rows": n, "dollars": round(float(s), 2)}
                                        for c, nm, n, s in earm]
    big = q(con, """SELECT r.cycle, r.CMTE_ID, c.CMTE_NM, r.from_member, r.to_member, r.NAME, r.dt, r.amt,
                           r.ENTITY_TP, r.IMAGE_NUM FROM p_rules r LEFT JOIN cm_latest c USING (CMTE_ID)
                    WHERE r.rule = 'keep:funds' AND r.amt > 10000 ORDER BY r.amt DESC, r.SUB_ID""")
    report["review_large_funds_rows"] = [
        {"cycle": cy, "committee": c, "committee_name": nm, "from": f, "to": t, "payee_as_filed": pn,
         "date": d.isoformat(), "amount": float(a), "entity_type": et,
         "url": f"https://docquery.fec.gov/cgi-bin/fecimg/?{img}" if img else None}
        for cy, c, nm, f, t, pn, d, a, et, img in big]
    print(f"\nfunds rows over $10,000 from one committee in one transaction (kept, listed for review): {len(big)}")
    for r in report["review_large_funds_rows"][:12]:
        print(f"  {r['date']} {r['committee']} {r['committee_name'][:34]:34} -> {r['to']} payee={r['payee_as_filed'][:30]!s:30} "
              f"${r['amount']:,.0f}")
    table("earmarked contributions forwarded by conduits (excluded), top 15", ("committee", "name", "rows", "dollars"),
          [(c, (nm or "")[:60], n, float(s)) for c, nm, n, s in earm])


def _sanity(con, members: refs.Members, report: dict, summ: Summary, sizes: dict) -> None:
    names = {b: m["name"] for b, m in members.info.items()}
    current = {b for b, m in members.info.items() if m.get("current")}

    # edges by type
    ct = summ.by_type
    table("edges by type", ("type", "edges"), sorted(ct.items()))
    report["edges_by_type"] = dict(sorted(ct.items()))
    table("output files", ("file", "rows", "bytes"),
          [(k, v.get("edges", v.get("orgs")), v["bytes"]) for k, v in sorted(sizes.items())])
    big = [k for k, v in sizes.items() if v["bytes"] > SIZE_WARN]
    if big:
        print(f"\nWARNING: over 150 MB: {big}. Nothing was truncated; consider --min-total.")
        # what a threshold would do
        pm = summ.pm_sizes
        report["size_options_pac_money"] = []
        for thr in (0, 1000, 2500, 5000, 10000):
            keep = [x for x in pm if x[0] >= thr]
            cur_b = sum(x[1] for x in keep if x[2])
            row = {"min_total": thr, "edges": len(keep), "bytes": sum(x[1] for x in keep),
                   "edges_current_members_only": sum(1 for x in keep if x[2]), "bytes_current_members_only": cur_b}
            report["size_options_pac_money"].append(row)
            print(f"  pac_money --min-total {thr}: {row['edges']:,} edges, {row['bytes'] / 2**20:,.0f} MiB; "
                  f"current members only: {row['edges_current_members_only']:,} edges, {cur_b / 2**20:,.0f} MiB")
    report["size_warning"] = big

    # match rate for pac_money by dollars and committees
    rows = q(con, """SELECT g.how, count(DISTINCT r.CMTE_ID), sum(r.amt) FROM p_rules r JOIN giver_org g USING (CMTE_ID)
                     WHERE r.rule = 'keep:pac_money' GROUP BY 1 ORDER BY 1""")
    tot_d = sum(float(s) for _, _, s in rows) or 1
    tot_c = sum(c for _, c, _ in rows) or 1
    table("pac_money org identity (committees, dollars)", ("method", "committees", "pct_cmte", "dollars", "pct_$"),
          [(h, c, f"{100 * c / tot_c:.1f}%", float(s), f"{100 * float(s) / tot_d:.1f}%") for h, c, s in rows])
    with_conn = q(con, """SELECT count(DISTINCT r.CMTE_ID), sum(r.amt) FROM p_rules r JOIN giver_org g USING (CMTE_ID)
                          WHERE r.rule='keep:pac_money' AND g.connected IS NOT NULL""")[0]
    matched = q(con, """SELECT count(DISTINCT r.CMTE_ID), coalesce(sum(r.amt),0) FROM p_rules r JOIN giver_org g USING (CMTE_ID)
                        WHERE r.rule='keep:pac_money' AND g.company IS NOT NULL""")[0]
    report["pac_money_match"] = {
        "committees": tot_c, "dollars": round(tot_d, 2),
        "committees_with_connected_org": with_conn[0], "dollars_with_connected_org": round(float(with_conn[1] or 0), 2),
        "committees_matched_to_company": matched[0], "dollars_matched_to_company": round(float(matched[1]), 2),
        "by_method": {h: {"committees": c, "dollars": round(float(s), 2)} for h, c, s in rows}}
    print(f"\nmatched to a company: {matched[0]:,} of {tot_c:,} committees ({100 * matched[0] / tot_c:.1f}%), "
          f"${float(matched[1]):,.0f} of ${tot_d:,.0f} ({100 * float(matched[1]) / tot_d:.1f}%); "
          f"{with_conn[0]:,} committees name a connected organisation")
    un = q(con, """SELECT g.connected, count(DISTINCT r.CMTE_ID), sum(r.amt),
                          string_agg(DISTINCT r.CMTE_ID, ' ' ORDER BY r.CMTE_ID)
                   FROM p_rules r JOIN giver_org g USING (CMTE_ID)
                   WHERE r.rule='keep:pac_money' AND g.company IS NULL AND g.connected IS NOT NULL
                   GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 50""")
    report["top_unmatched_connected_orgs"] = [
        {"connected_org": c, "normalised": refs.normalise_name(c), "committees": n, "dollars": round(float(s), 2),
         "committee_ids": ids.split()} for c, n, s, ids in un]
    table("top 50 unmatched connected organisations by pac_money dollars",
          ("connected_org", "normalised", "cmtes", "dollars"),
          [(c[:55], refs.normalise_name(c)[:45], n, float(s)) for c, n, s, _ in un])

    # PAC contributions to current members by cycle (all kept pac_money rows)
    cur = ",".join(f"'{b}'" for b in sorted(current))
    rows = q(con, f"""SELECT cycle, count(*), sum(amt) FROM p_rules WHERE rule='keep:pac_money' AND to_member IN ({cur})
                      GROUP BY 1 ORDER BY 1""")
    table("pac_money to current members, by file cycle", ("cycle", "rows", "dollars"),
          [(c, n, float(s)) for c, n, s in rows])
    report["pac_money_current_members_by_cycle"] = {str(c): {"rows": n, "dollars": round(float(s), 2)} for c, n, s in rows}

    # weball comparison
    out = []
    for bio in SANITY_MEMBERS:
        if bio not in members.info:
            continue
        ids = members.info[bio].get("fec_ids") or []
        idl = ",".join(f"'{i}'" for i in ids)
        if not idl:
            continue
        wb = q(con, f"""SELECT cycle, sum(try_cast(OTHER_POL_CMTE_CONTRIB AS DOUBLE)), sum(try_cast(POL_PTY_CONTRIB AS DOUBLE))
                        FROM weball WHERE CAND_ID IN ({idl}) GROUP BY 1 ORDER BY 1""")
        for cyc, other, party in wb:
            if cyc not in (2018, 2020, 2022, 2024):
                continue
            mine = q(con, f"""SELECT
                    sum(amt) FILTER (WHERE rule='keep:pac_money' AND g.kind <> 'party'),
                    sum(amt) FILTER (WHERE rule='keep:funds'),
                    sum(amt) FILTER (WHERE rule='drop:giver_campaign_of_non_member'),
                    sum(amt) FILTER (WHERE rule='keep:pac_money' AND g.kind = 'party')
                  FROM p_rules r LEFT JOIN giver_org g USING (CMTE_ID)
                  WHERE to_member = '{bio}' AND dt BETWEEN DATE '{cyc - 1}-01-01' AND DATE '{cyc}-12-31'""")[0]
            pac, funds, nonmem, pty = (float(x or 0) for x in mine)
            ours = pac + funds + nonmem
            out.append({"member": bio, "name": names[bio], "cycle": cyc, "weball_other_committees": other,
                        "ours_pac_money_nonparty": pac, "ours_funds_in": funds, "ours_nonmember_campaigns": nonmem,
                        "ours_total_comparable": ours, "diff": ours - float(other or 0),
                        "diff_pct": (100 * (ours - float(other)) / float(other)) if other else None,
                        "weball_party": party, "ours_party": pty})
    report["weball_check"] = out
    table("weball check: contributions from other committees (cycle = Jan odd year .. Dec even year by txn date)",
          ("member", "cycle", "weball_other", "ours", "diff", "diff%", "weball_party", "ours_party"),
          [(f"{o['member']} {o['name'][:22]}", o["cycle"], float(o["weball_other_committees"] or 0),
            o["ours_total_comparable"], o["diff"], "" if o["diff_pct"] is None else f"{o['diff_pct']:.1f}%",
            float(o["weball_party"] or 0), o["ours_party"]) for o in out])

    # top edges
    def label(ref):
        return names.get(ref["id"], ref["id"]) if ref["kind"] == "member" else ref["id"]
    orgnames = dict(q(con, "SELECT pac_id, name FROM giver_org"))
    def olabel(ref):
        return orgnames.get(ref["id"], ref["id"])
    om = summ.tops("org")
    report["top_org_member_edges"] = [{"type": e["type"], "from": e["from"]["id"], "via": e["via"], "to": e["to"]["id"],
                                       "exact": e["amount"]["exact"], "count": e["count"]} for e in om]
    table("top 20 org -> member edges by dollars", ("type", "from", "via", "to", "dollars", "n"),
          [(e["type"], f"{e['from']['id']} {olabel(e['from'])[:30]}", (e["via"] or {}).get("name", "")[:34],
            label(e["to"])[:22], float(e["amount"]["exact"]), e["count"]) for e in om])
    om2 = summ.tops("pac_money")
    report["top_pac_money_edges"] = [{"from": e["from"]["id"], "via": e["via"], "to": e["to"]["id"],
                                      "exact": e["amount"]["exact"], "count": e["count"]} for e in om2]
    table("top 20 pac_money edges by dollars", ("from", "via", "to", "dollars", "n"),
          [(f"{e['from']['id']} {olabel(e['from'])[:34]}", (e["via"] or {}).get("name", "")[:34],
            label(e["to"])[:22], float(e["amount"]["exact"]), e["count"]) for e in om2])
    fm = summ.tops("funds")
    report["top_funds_edges"] = [{"from": e["from"]["id"], "via": e["via"], "to": e["to"]["id"],
                                  "exact": e["amount"]["exact"], "count": e["count"]} for e in fm]
    table("top 20 member -> member funds edges by dollars", ("from", "via", "to", "dollars", "n"),
          [(label(e["from"])[:24], e["via"]["name"][:40], label(e["to"])[:24], float(e["amount"]["exact"]), e["count"])
           for e in fm])

    nf = report["members_without_fec_id"]
    print(f"\nmembers in scope without an FEC candidate id: {nf['count']} ({len(nf['current'])} current)")
    for x in nf["current"]:
        print("  ", x)


def _write_sources(report: dict) -> None:
    files = []
    revisions = []
    for k, v in sorted(report["files"].items(), key=lambda kv: (kv[1]["file"], kv[1]["cycle"])):
        files.append({"path": f"{v['cycle']}/{k}.zip", "url": v["url"], "rows": v["rows_loaded"],
                      "sha256": v["zip_sha256"], "last_modified": v["last_modified"]})
        if v.get("last_modified"):
            revisions.append(datetime.strptime(v["last_modified"], "%a, %d %b %Y %H:%M:%S %Z"))
    for c in report["cycles"]:
        p = download.CACHE / str(c) / f"leadership{c}.csv"
        m = download.source_meta(p)
        if m:
            with open(p, encoding="utf-8", errors="replace") as f:
                n = sum(1 for _ in f) - 1
            files.append({"path": f"{c}/leadership{c}.csv", "url": m["url"], "rows": n, "sha256": m["sha256"],
                          "last_modified": m.get("last_modified")})
    retrieved = sorted(v["retrieved"] for v in report["files"].values() if v.get("retrieved"))
    src = {"fec": {
        "name": "Federal Election Commission bulk data (candidate master, committee master, candidate-committee "
                "linkage, contributions from committees to candidates and independent expenditures, all-candidates "
                "summary, leadership PACs and sponsors)",
        "url": "https://www.fec.gov/data/browse-data/?tab=bulk-data",
        "revision": max(revisions).strftime("%Y-%m-%dT%H:%M:%SZ") if revisions else None,
        "retrieved": retrieved[0] if retrieved else None,
        "licence": "Public domain (US federal government work). Committee-level data only; no individual "
                   "contributor records are used (52 U.S.C. 30111(a)(4) sale-and-use restriction).",
        "files": files,
    }}
    SOURCE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SOURCE_FILE.with_name(SOURCE_FILE.name + ".tmp")
    tmp.write_text(json.dumps({"sources": src, "report": report}, indent=1, sort_keys=True, default=str) + "\n")
    os.replace(tmp, SOURCE_FILE)


if __name__ == "__main__":
    sys.exit(main())
