"""FEC disbursement purpose groups per leadership-PAC cycle, from OpenFEC `/v1/schedules/schedule_b/by_purpose/`.

The FEC groups ALL Schedule B disbursements of a committee in a two-year cycle (contributions to candidates, refunds,
transfers, operating expenses ...) under its own labels (ADMINISTRATIVE, CONTRIBUTIONS, REFUNDS, OTHER ...). Labels,
`total` and `count` are published exactly as the API gives them; the memo fields are not read. A negative total is not
published (null) and is listed in the report, as for loans.

Requests: one request lists up to 100 result rows and takes any number of `committee_id` filters, so a cycle costs about
(committees x groups per committee / 100) requests, in batches of 100 committee ids sorted by id. Only committee-cycles
that have operating-expenditure rows are asked for.

Result per (cycle, committee): a list of groups (sorted by total descending, then label), `[]` when the batch completed
and the API returned no group for that committee (the FEC's answer; not a zero amount), or None when it was not
fetched (no key, API failure, cache-only without a cached answer). A batch is stored and used only if every page was
read and the rows add up to the API's count.

Cache: pipeline/.cache/fec/api/purposes_<cycle>.json = {retrieved, committees: {id: groups}}. The two latest cycles are
refetched after 12 hours, older ones after 7 days; a committee missing from the cache is fetched at once. PT_CACHE_ONLY=1
uses the cache only. When a refresh fails the cached groups are kept (reported as stale). Nothing raises into the pipeline.
"""
from __future__ import annotations

import re
import time
from typing import Any

from ..config import DAY
from ..util import cache_only, utc_now
from . import api as fecapi
from . import download

PATH = "/schedules/schedule_b/by_purpose/"
BATCH = 100
RECENT_SECONDS = 12 * 3600.0
OLDER_SECONDS = 7 * DAY
COMMITTEE_ID = re.compile(r"^C\d{8}$")
SOURCE = "OpenFEC /v1/schedules/schedule_b/by_purpose/ (https://api.open.fec.gov/developers/), the FEC's own groupings"


def _group(row: Any, cycle: int, wanted: set[str]) -> tuple[str, dict[str, Any]] | None:
    """(committee, {purpose, total, count}) for a row of a requested committee-cycle; None for a row to ignore.
    Raises ApiError for a row of a requested committee that cannot be read."""
    if not isinstance(row, dict) or row.get("committee_id") not in wanted or row.get("cycle") != cycle:
        return None
    p, t, n = row.get("purpose"), row.get("total"), row.get("count")
    if not isinstance(p, str) or not p.strip() or isinstance(t, bool) or not isinstance(t, (int, float)) \
            or isinstance(n, bool) or not isinstance(n, int) or n < 0:
        raise fecapi.ApiError("a purpose row is malformed")
    return row["committee_id"], {"purpose": p.strip(), "total": round(float(t), 2), "count": n}


def fetch_batch(client: fecapi.FecApi, cycle: int, ids: list[str], dup_rows: list[int] | None = None
                ) -> dict[str, list[dict[str, Any]]]:
    """{committee: groups} for every id (a committee without rows maps to []). Raises ApiError.
    `dup_rows[0]` counts identical group rows the API listed twice (verified live: same figures, counted once)."""
    dup_rows = dup_rows if dup_rows is not None else [0]
    wanted = set(ids)
    out: dict[str, dict[str, dict[str, Any]]] = {i: {} for i in ids}
    params = {"committee_id": list(ids), "cycle": cycle, "sort": ["committee_id", "purpose"]}
    for row in client.pages(PATH, params):
        g = _group(row, cycle, wanted)
        if g is None:
            continue
        seen = out[g[0]].get(g[1]["purpose"])
        if seen is not None and seen != g[1]:
            raise fecapi.ApiError("a purpose group came twice with different figures")
        if seen is not None:
            dup_rows[0] += 1             # the API lists some identical group rows twice; counted once
        out[g[0]][g[1]["purpose"]] = g[1]
    return {c: sort_groups(list(v.values())) for c, v in out.items()}


def sort_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(groups, key=lambda g: (-g["total"], g["purpose"]))


def publishable(groups: list[dict[str, Any]], where: str, neg: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Groups as published: a negative total becomes null and is listed in `neg`; order total desc (null last), label."""
    out = []
    for g in groups:
        if g["total"] < 0:
            neg.append({"where": where, "purpose": g["purpose"], "value": g["total"]})
            out.append({**g, "total": None})
        else:
            out.append(dict(g))
    return sorted(out, key=lambda g: (g["total"] is None, -(g["total"] or 0), g["purpose"]))


def fetch_cycle(client: fecapi.FecApi, cycle: int, ids: list[str], now: float, recent: bool, rep: dict[str, Any]
                ) -> dict[str, list[dict[str, Any]] | None]:
    """{committee: groups or None} for the wanted committees of one cycle, using and updating the cache."""
    name = f"purposes_{cycle}.json"
    cached = fecapi.cache_read(name) or {}
    have = cached.get("committees") if isinstance(cached.get("committees"), dict) else {}
    limit = RECENT_SECONDS if recent else OLDER_SECONDS
    stale = not cache_only() and fecapi.age_seconds(cached, now) >= limit
    need = sorted(ids) if stale else sorted(i for i in ids if i not in have)
    stamp = cached.get("retrieved") if have else None
    if need and not cache_only() and client.enabled:
        done: dict[str, list] = {}
        for k in range(0, len(need), BATCH):
            try:
                dups = [0]
                done.update(fetch_batch(client, cycle, need[k:k + BATCH], dups))
                rep["identical_duplicate_rows_counted_once"] = rep.get("identical_duplicate_rows_counted_once", 0) + dups[0]
            except fecapi.ApiError as e:
                rep.setdefault("batches_failed", []).append({"cycle": cycle, "committees": len(need[k:k + BATCH]),
                                                             "reason": str(e)})
                print(f"  WARNING purpose groups cycle {cycle}: batch failed ({e})", flush=True)
                if client.failed:
                    break
        partial = stale and len(done) < len(need)
        if done:
            have = {**({} if stale and not partial else have), **done}
            stamp = cached.get("retrieved") if partial and have else utc_now()
            fecapi.cache_write(name, {"retrieved": stamp, "cycle": cycle, "committees": dict(sorted(have.items()))})
        if partial:
            rep.setdefault("stale_cycles", []).append(cycle)
    elif need and stale and have:
        rep.setdefault("stale_cycles", []).append(cycle)
    if stamp:
        rep.setdefault("retrieved_by_cycle", {})[str(cycle)] = stamp
    return {i: (have[i] if isinstance(have.get(i), list) else None) for i in ids}


def fetch_all(wanted: dict[int, list[str]], client: fecapi.FecApi | None = None, now: float | None = None,
              today_cycle: int | None = None) -> tuple[dict[tuple[int, str], list | None], dict[str, Any]]:
    """({(cycle, committee): published groups or None}, report). `wanted` = {cycle: committee ids with oppexp rows}."""
    client = client or fecapi.default()
    now = time.time() if now is None else now
    top = download.current_cycle() if today_cycle is None else today_cycle
    rep: dict[str, Any] = {"endpoint": PATH, "requests": 0}
    before = client.requests
    neg: list[dict[str, Any]] = []
    out: dict[tuple[int, str], list | None] = {}
    got_cycles: list[int] = []
    for cycle in sorted(wanted):
        ids = sorted(set(wanted[cycle]))
        res = fetch_cycle(client, cycle, ids, now, cycle >= top - 2, rep)
        for cmte in ids:
            g = res[cmte]
            out[(cycle, cmte)] = None if g is None else publishable(g, f"{cmte} {cycle}", neg)
        if any(v is not None for v in res.values()):
            got_cycles.append(cycle)
    rep.update(requests=client.requests - before, cycles=got_cycles, negative_totals_not_published=neg,
               committee_cycles_asked=len(out), committee_cycles_without_answer=sum(v is None for v in out.values()))
    if not client.key and not got_cycles:
        rep["warning"] = "FEC_API_KEY is not set and nothing is cached: published without purpose groups"
        print(f"  WARNING {rep['warning']}", flush=True)
    return out, rep


def coverage(rep: dict[str, Any], today: str) -> tuple[list[int], str]:
    """(purposes_cycles, purposes_source note) for the block's coverage."""
    cycles = rep.get("cycles") or []
    if not cycles:
        return [], f"{SOURCE}: not available in this build ({rep.get('warning') or 'no answer from the API'})"
    stamps = sorted((rep.get("retrieved_by_cycle") or {}).get(str(c), "") for c in cycles)
    date = (stamps[0] or today)[:10]
    return cycles, f"{SOURCE}; groups of all disbursements of the committee in the cycle; accessed {date}"
