"""FEC spending and loans (data dictionary: "Campaign finance block"). Step 4 of the FEC module, after the reference
tables exist: builds `campaign_finance` for each member from two bulk files and writes
  pipeline/build/campaign_finance.json   {"members": {bioguide: block}, "links": {committee: {member, method}}}
  pipeline/build/sources/fec_spending.json  (source metadata, coverage per cycle and an audit report)

1. Loans. `weball<yy>` (all-candidates summary, already loaded into DuckDB by load.py) has one row per candidate id and
   cycle. A row belongs to a member only if its CAND_ID is one of the member's FEC ids (the exact id linkage in
   refs.Members.cand_to_bio). Figures are copied as the FEC summarises them; a blank is null, never zero, and a
   negative figure (80 figures in 44,913 rows, cycles 2000-2026) is not published (null) and is listed in the report.
2. Leadership PAC spending. `oppexp<yy>` (operating expenditures) is streamed (spending_oppexp.py) for the committee
   ids in the `lpac` table (committee -> sponsoring member, built by build._leadership from FEC candidate ids and the
   FEC leadership-PAC sponsor list, exact names only) and summed by the FEC category code. Payees are never read.
Members with neither a candidacy row nor a leadership-PAC row get no entry (the assembler publishes null).
"""
from __future__ import annotations

import os
import resource
import time
from collections import defaultdict
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import duckdb

from ..util import dumps
from . import download, refs
from .load import q
from .spending_oppexp import CATEGORY_LABELS, FIRST_OPPEXP_CYCLE, LayoutChanged, aggregate, iter_rows

OFFICE = {"H": "house", "S": "senate", "P": "president"}   # first character of a FEC candidate id
NO_CATEGORY = "No FEC category on the filing"
LOAN_FIELDS = (("candidate_loans", "CAND_LOANS"), ("other_loans", "OTHER_LOANS"),
               ("candidate_loan_repayments", "CAND_LOAN_REPAY"), ("other_loan_repayments", "OTHER_LOAN_REPAY"),
               ("debts_owed_by", "DEBTS_OWED_BY"))
NOTE_NO_PAC = ("No leadership PAC is linked to this member by an FEC committee id or by the FEC's leadership PAC "
               "sponsor list (exact name), or none reported operating expenditures in the loaded files.")


def _money(x: Any) -> float | int | None:
    if x is None:
        return None
    f = round(float(x), 2)
    return int(f) if f == int(f) else f


def loan_rows(con: duckdb.DuckDBPyConnection, cycles: list[int], cand_to_bio: dict[str, str],
              report: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """{bioguide: [row per (cycle, candidate id)]} from weball. Blank -> None; negative -> None (listed in report)."""
    cyc = ",".join(str(c) for c in cycles)
    num = ", ".join(f"try_cast(nullif(trim({c}), '') AS DOUBLE)" for _, c in LOAN_FIELDS)
    rows = q(con, f"""SELECT cycle, CAND_ID, {num}, try_strptime(nullif(trim(CVG_END_DT), ''), '%m/%d/%Y')
                      FROM weball WHERE cycle IN ({cyc}) ORDER BY cycle, CAND_ID, line_no""")
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    negative: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    n_member = 0
    for cycle, cand, *vals, through in rows:
        bio = cand_to_bio.get(cand)
        if bio is None or (cycle, cand) in seen:
            continue
        seen.add((cycle, cand))
        row: dict[str, Any] = {"cycle": cycle, "candidate_id": cand, "office": OFFICE.get(cand[:1])}
        for (key, col), v in zip(LOAN_FIELDS, vals):
            if v is not None and v < 0:
                negative.append({"cycle": cycle, "candidate_id": cand, "field": col, "value": _money(v)})
                v = None
            row[key] = _money(v)
        row["through"] = through.date().isoformat() if through else None
        out[bio].append(row)
        n_member += 1
    report["loans"] = {"weball_rows_read": len(rows), "rows_of_members": n_member, "members": len(out),
                       "negative_figures_not_published": negative}
    return out


def _block(loans: list[dict], pacs: list[dict], wb: list[int], op: list[int]) -> dict[str, Any]:
    return {"loans": loans, "leadership_pac": pacs,
            "coverage": {"loans_cycles": wb, "leadership_pac_cycles": op,
                         "leadership_pac_note": None if pacs else NOTE_NO_PAC}}


def pac_entry(cmte: str, cycle: int, name: str, method: str, cats: dict[str | None, list]) -> dict[str, Any]:
    """One committee-cycle: categories ordered by code (no-category last); total and count are their sums."""
    cs = [{"category": c, "label": CATEGORY_LABELS.get(c, NO_CATEGORY), "total": _money(v[0]), "count": v[1]}
          for c, v in sorted(cats.items(), key=lambda kv: (kv[0] is None, kv[0] or ""))]
    return {"committee_id": cmte, "committee_name": name, "cycle": cycle, "sponsor_link": method,
            "total": _money(sum(c["total"] for c in cs)), "count": sum(c["count"] for c in cs), "categories": cs}


def spending_by_cycle(links: dict[str, tuple[str, str]], cycles: list[int], report: dict[str, Any],
                      audit: dict[str, Any]) -> dict[int, dict[str, dict]]:
    """Stream oppexp for every cycle that exists; {cycle: aggregate()}. Records timing, memory and coverage."""
    out: dict[int, dict[str, dict]] = {}
    cov: dict[str, str] = {}
    for cycle in cycles:
        if cycle < FIRST_OPPEXP_CYCLE:
            cov[str(cycle)] = "not published by the FEC (electronic filers from the 2004 cycle)"
            continue
        try:
            zpath = download.bulk_zip("oppexp", cycle)
        except download.NotFound:
            cov[str(cycle)] = "file not found (404)"
            continue
        st: dict[str, int] = {}
        rep: dict[str, int] = {}
        t0 = time.monotonic()
        try:
            agg = aggregate(iter_rows(zpath, set(links), st), rep)
        except LayoutChanged as e:
            cov[str(cycle)] = f"skipped, layout changed: {e}"
            print(f"  WARNING oppexp{cycle % 100:02d} skipped: {e}", flush=True)
            continue
        secs = time.monotonic() - t0
        out[cycle] = agg
        cov[str(cycle)] = "loaded"
        meta = download.source_meta(zpath) or {}
        name = f"oppexp{cycle % 100:02d}"
        audit[name] = {"cycle": cycle, "file": "oppexp", "url": meta.get("url"), "zip_sha256": meta.get("sha256"),
                       "last_modified": meta.get("last_modified"), "retrieved": meta.get("retrieved"),
                       "lines": st["lines"], "rows_loaded": st["lines"], "encoding": "latin-1", "streamed": True}
        report.setdefault("oppexp_by_cycle", {})[str(cycle)] = {
            "lines_read": st["lines"], "lines_of_leadership_pacs": st["matched"], **rep,
            "committees_with_rows": len(agg), "seconds": round(secs, 1)}
        print(f"  streamed {name}: {st['lines']:,} lines, {st['matched']:,} of leadership PACs, {secs:.1f}s", flush=True)
    report["oppexp_coverage"] = cov
    report["peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
    return out


def run(con: duckdb.DuckDBPyConnection, members: refs.Members, cycles: list[int], report: dict[str, Any],
        audit_files: dict[str, Any], build_dir: Path) -> dict[str, Any]:
    """Build every member's block, write the two files, return the report section."""
    sec: dict[str, Any] = {"cycles": cycles}
    loans = loan_rows(con, cycles, members.cand_to_bio, sec)
    links = {c: (b, m) for c, b, m in q(con, "SELECT CMTE_ID, bioguide, method FROM lpac ORDER BY 1")}
    names = dict(q(con, "SELECT CMTE_ID, CMTE_NM FROM cm_latest WHERE CMTE_ID IN (SELECT CMTE_ID FROM lpac)"))
    sec["leadership_pac_committees_linked"] = len(links)
    spend = spending_by_cycle(links, cycles, sec, audit_files)
    pacs: dict[str, list[dict]] = defaultdict(list)
    for cycle in sorted(spend):
        for cmte, cats in sorted(spend[cycle].items()):
            bio, method = links[cmte]
            if cats:
                pacs[bio].append(pac_entry(cmte, cycle, names.get(cmte) or cmte, method, cats))
    op = sorted(spend)
    blocks = {bio: _block(loans.get(bio, []), pacs.get(bio, []), cycles, op)
              for bio in sorted(set(loans) | set(pacs))}
    sec["members_with_block"] = len(blocks)
    sec["members_with_leadership_pac_rows"] = len(pacs)
    write_outputs(build_dir, blocks, links, sec, [v for v in audit_files.values() if v["file"] == "oppexp"])
    report["spending"] = sec
    return sec


def _iso(http_date: str) -> str:
    return parsedate_to_datetime(http_date).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_outputs(build_dir: Path, blocks: dict[str, Any], links: dict[str, tuple[str, str]], sec: dict[str, Any],
                  files: list[dict[str, Any]]) -> None:
    doc = {"members": blocks, "links": {c: {"member": b, "method": m} for c, (b, m) in sorted(links.items())}}
    src = {"sources": {"fec_spending": {
        "name": "FEC all-candidates summary (loans) and operating expenditures of leadership PACs, aggregated by category",
        "url": "https://www.fec.gov/data/browse-data/?tab=bulk-data",
        "revision": max((_iso(f["last_modified"]) for f in files if f.get("last_modified")), default=None),
        "retrieved": min((f["retrieved"] for f in files if f.get("retrieved")), default=None),
        "licence": "Public domain (US federal government work). Aggregates only: no payee name, address or "
                   "individual-level row is read or published; not for solicitation or commercial use "
                   "(52 U.S.C. 30111(a)(4))."}},
        "report": sec}
    for path, obj in ((build_dir / "campaign_finance.json", doc), (build_dir / "sources" / "fec_spending.json", src)):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(dumps(obj) + "\n", encoding="utf-8")
        os.replace(tmp, path)
