"""FEC committee totals per leadership-PAC cycle (money in, total disbursements, contributions to other committees, cash on
hand, coverage end date), from OpenFEC `/v1/totals/pac/`. Contract and rules: docs/leadership-pac-totals.md.

This is the same data as `/v1/committee/{id}/totals/` (same row, same field names, checked live) but takes any number of
`committee_id` filters plus a `cycle`, so one request returns up to 100 committees for one cycle instead of one request per
committee: about 10 requests per cycle instead of about 1,000 for a full refresh. The endpoint serves committee types
N, Q, O, V and W (every PAC type a leadership PAC has); a committee of another type simply has no row.

Result per (cycle, committee): a `totals` dict (see `_totals`), or None when there is nothing to publish: not fetched (no
key, API failure, cache-only without a cached answer), no row for that committee-cycle, a row for another cycle, an
unreadable coverage date, a coverage date outside the cycle's two years (reported) or no figure at all. Never zeros for missing: a missing figure is None, a negative figure is None and
is listed in the report (the FEC's receipts, disbursements, contribution, operating and cash figures are not negative as
filed in the rows read; a negative one is a filing correction and is not published as a total). A batch is stored and used
only if every page was read and the rows add up to the API's count.

Cache: pipeline/.cache/fec/api/totals_<cycle>.json = {retrieved, committees: {id: totals or null}}. The two latest cycles
are refetched after 12 hours, older ones after 7 days; a committee missing from the cache is fetched at once. PT_CACHE_ONLY=1
uses the cache only. When a refresh fails the cached figures are kept (reported as stale). Nothing raises into the pipeline.
Requests are sequential: a normal day is a few dozen batched requests, far below the API's 1,000 an hour, so concurrency
would add risk (a shared request counter and rate limit) for no gain.
"""
from __future__ import annotations

import re
import time
from datetime import date
from typing import Any

from ..config import DAY
from ..util import cache_only, utc_now
from . import api as fecapi
from . import download

PATH = "/totals/pac/"
BATCH = 100
RECENT_SECONDS = 12 * 3600.0
OLDER_SECONDS = 7 * DAY
# published key -> OpenFEC field (docs/leadership-pac-totals.md says what each is)
FIELDS = (("receipts", "receipts"), ("disbursements", "disbursements"),
          ("contributions_to_committees", "fed_candidate_committee_contributions"),
          ("operating_expenditures", "operating_expenditures"), ("contribution_refunds", "contribution_refunds"),
          ("other_disbursements", "other_disbursements"), ("cash_on_hand", "last_cash_on_hand_end_period"))
KEYS = tuple(k for k, _ in FIELDS) + ("coverage_end_date",)
SOURCE = "OpenFEC /v1/totals/pac/ (https://api.open.fec.gov/developers/), the FEC's committee summary"
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:T00:00:00)?$")


def _money(v: Any) -> float | None:
    return None if isinstance(v, bool) or not isinstance(v, (int, float)) else round(float(v), 2)


def _day(v: Any) -> str | None:
    """YYYY-MM-DD from the FEC's `2026-10-14T00:00:00`, None if absent or not a real date."""
    m = DATE.match(v) if isinstance(v, str) else None
    try:
        return date.fromisoformat(m.group(1)).isoformat() if m else None
    except ValueError:
        return None


def _totals(row: dict[str, Any], where: str, neg: list[dict[str, Any]], cycle: int,
            outside: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """The published totals of one API row: figures to the cent, None for a blank or negative figure; None for the whole row
    when it has no valid coverage end date, one outside the cycle's two years (listed in `outside`; the validator rejects
    such a date, so it is never published) or no figure at all."""
    end = _day(row.get("coverage_end_date"))
    if end is not None and int(end[:4]) not in (cycle - 1, cycle):
        if outside is not None:
            outside.append({"where": where, "coverage_end_date": end})
        return None
    out: dict[str, Any] = {}
    for key, field in FIELDS:
        v = _money(row.get(field))
        if v is not None and v < 0:
            neg.append({"where": where, "field": field, "value": v})
            v = None
        out[key] = v
    if end is None or all(out[k] is None for k, _ in FIELDS):
        return None
    out["coverage_end_date"] = end
    return out


def fetch_batch(client: fecapi.FecApi, cycle: int, ids: list[str], neg: list[dict[str, Any]] | None = None,
                outside: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any] | None]:
    """{committee: totals or None} for every id. Raises ApiError (a repeated committee-cycle with different figures, a
    malformed row, or a failed page)."""
    neg = neg if neg is not None else []
    wanted = set(ids)
    seen: dict[str, dict[str, Any]] = {}
    for row in client.pages(PATH, {"committee_id": list(ids), "cycle": cycle, "sort": "committee_id"}):
        if not isinstance(row, dict) or row.get("committee_id") not in wanted:
            continue
        if row.get("cycle") != cycle:
            continue                                  # a row of another cycle is never used for this one
        cid = row["committee_id"]
        if cid in seen and {k: seen[cid].get(k) for k in [f for _, f in FIELDS] + ["coverage_end_date"]} != \
                {k: row.get(k) for k in [f for _, f in FIELDS] + ["coverage_end_date"]}:
            raise fecapi.ApiError("a committee-cycle came twice with different figures")
        seen[cid] = row
    return {i: (_totals(seen[i], f"{i} {cycle}", neg, cycle, outside) if i in seen else None) for i in ids}


def fetch_cycle(client: fecapi.FecApi, cycle: int, ids: list[str], now: float, recent: bool, rep: dict[str, Any],
                neg: list[dict[str, Any]], outside: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any] | None]:
    """{committee: totals or None} for the wanted committees of one cycle, using and updating the cache."""
    name = f"totals_{cycle}.json"
    cached = fecapi.cache_read(name) or {}
    have = cached.get("committees") if isinstance(cached.get("committees"), dict) else {}
    limit = RECENT_SECONDS if recent else OLDER_SECONDS
    stale = not cache_only() and fecapi.age_seconds(cached, now) >= limit
    need = sorted(ids) if stale else sorted(i for i in ids if i not in have)
    stamp = cached.get("retrieved") if have else None
    if need and not cache_only() and client.enabled:
        done: dict[str, Any] = {}
        for k in range(0, len(need), BATCH):
            try:
                done.update(fetch_batch(client, cycle, need[k:k + BATCH], neg, outside))
            except fecapi.ApiError as e:
                rep.setdefault("batches_failed", []).append({"cycle": cycle, "committees": len(need[k:k + BATCH]),
                                                             "reason": str(e)})
                print(f"  WARNING committee totals cycle {cycle}: batch failed ({e})", flush=True)
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
    return {i: (have[i] if isinstance(have.get(i), dict) and set(have[i]) == set(KEYS) else None) for i in ids}


def fetch_all(wanted: dict[int, list[str]], client: fecapi.FecApi | None = None, now: float | None = None,
              today_cycle: int | None = None) -> tuple[dict[tuple[int, str], dict | None], dict[str, Any]]:
    """({(cycle, committee): totals or None}, report). `wanted` = {cycle: committee ids with oppexp rows}."""
    client = client or fecapi.default()
    now = time.time() if now is None else now
    top = download.current_cycle() if today_cycle is None else today_cycle
    rep: dict[str, Any] = {"endpoint": PATH, "requests": 0}
    before = client.requests
    neg: list[dict[str, Any]] = []
    outside: list[dict[str, Any]] = []
    out: dict[tuple[int, str], dict | None] = {}
    got_cycles: list[int] = []
    for cycle in sorted(wanted):
        ids = sorted(set(wanted[cycle]))
        res = fetch_cycle(client, cycle, ids, now, cycle >= top - 2, rep, neg, outside)
        for cmte in ids:
            out[(cycle, cmte)] = res[cmte]
        if any(v is not None for v in res.values()):
            got_cycles.append(cycle)
    # published as the FEC summarises them; listed so a reader can see the filings whose parts exceed their total (12 of 6,323 live)
    exceed = [{"where": f"{c} {k}", "disbursements": t["disbursements"], "part": f}
              for (k, c), t in sorted(out.items()) if t and t["disbursements"] is not None
              for f in ("contributions_to_committees", "operating_expenditures") if (t[f] or 0) > t["disbursements"] + 1]
    future = [{"where": f"{c} {k}", "coverage_end_date": t["coverage_end_date"]} for (k, c), t in sorted(out.items())
              if t and t["coverage_end_date"] > date.today().isoformat()]     # kept: the FEC reports a date after the build day
    rep.update(coverage_date_outside_cycle=outside, coverage_date_after_build_day=future, requests=client.requests - before, cycles=got_cycles, negative_figures_not_published=neg, parts_exceed_disbursements=exceed,
               committee_cycles_asked=len(out), committee_cycles_without_totals=sum(v is None for v in out.values()))
    if not client.key and not got_cycles:
        rep["warning"] = "FEC_API_KEY is not set and nothing is cached: published without committee totals"
        print(f"  WARNING {rep['warning']}", flush=True)
    return out, rep


def coverage(rep: dict[str, Any], today: str) -> tuple[list[int], str]:
    """(totals_cycles, totals_source note) for the block's coverage."""
    cycles = rep.get("cycles") or []
    if not cycles:
        return [], f"{SOURCE}: not available in this build ({rep.get('warning') or 'no answer from the API'})"
    stamps = sorted((rep.get("retrieved_by_cycle") or {}).get(str(c), "") for c in cycles)
    date_ = (stamps[0] or today)[:10]
    return cycles, f"{SOURCE}; summary per committee and cycle up to its coverage end date; accessed {date_}"
