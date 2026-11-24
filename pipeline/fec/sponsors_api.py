"""Leadership-PAC sponsors from OpenFEC, matched to members by exact FEC candidate id.

`/v1/committees/?designation=D` lists every leadership PAC with `sponsor_candidate_ids`, the candidate ids the PAC's own
filings name as its sponsor. A PAC is linked to a member when one of those ids is one of the member's FEC candidate ids
(refs.Members.cand_to_bio), exactly; no name is compared. Two different members behind one PAC: the link is dropped and
reported. Only the committee id, its name, sponsor ids and cycles are kept (the API's treasurer and agent address fields
are not read into the cache).

Cache: pipeline/.cache/fec/api/leadership_committees.json, refetched after 7 days; PT_CACHE_ONLY=1 uses it as it is. If the
key is missing or the API fails, the cache (any age) is used and the report says so; with no cache the result is None
and the existing bulk-file linkage stands alone. Nothing here raises into the pipeline.
"""
from __future__ import annotations

import re
import time
from typing import Any

from ..config import DAY
from ..util import cache_only, utc_now
from . import api as fecapi

CACHE_NAME = "leadership_committees.json"
REFRESH_SECONDS = 7 * DAY
METHOD = "fec_api_sponsor_id"
COMMITTEE_ID = re.compile(r"^C\d{8}$")


def _trim(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict) or not isinstance(row.get("committee_id"), str) \
            or not COMMITTEE_ID.match(row["committee_id"]):
        return None
    ids = row.get("sponsor_candidate_ids") or []
    cycles = row.get("cycles") or []
    if not isinstance(ids, list) or not isinstance(cycles, list):
        return None
    return {"committee_id": row["committee_id"], "name": str(row.get("name") or ""),
            "sponsor_candidate_ids": sorted({i for i in ids if isinstance(i, str)}),
            "cycles": sorted({c for c in cycles if isinstance(c, int)})}


def fetch_committees(client: fecapi.FecApi) -> list[dict[str, Any]]:
    """Every designation-D committee, trimmed, unique by id, sorted by id. Raises ApiError."""
    rows = client.pages("/committees/", {"designation": "D", "sort": "committee_id"})
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        t = _trim(r)
        if t is None:
            raise fecapi.ApiError("a committee row has no valid committee_id or sponsor list")
        out[t["committee_id"]] = t
    if not out:
        raise fecapi.ApiError("no leadership committees returned")
    return [out[k] for k in sorted(out)]


def load_committees(client: fecapi.FecApi | None = None, now: float | None = None
                    ) -> tuple[list[dict[str, Any]] | None, dict[str, Any]]:
    """(committees or None, report). Never raises."""
    client = client or fecapi.default()
    now = time.time() if now is None else now
    rep: dict[str, Any] = {"source": "OpenFEC /v1/committees/?designation=D", "requests": 0, "status": None}
    cached = fecapi.cache_read(CACHE_NAME)
    cached_ok = cached is not None and isinstance(cached.get("committees"), list)
    if cached_ok and (cache_only() or fecapi.age_seconds(cached, now) < REFRESH_SECONDS):
        rep.update(status="cache", retrieved=cached.get("retrieved"))
        return cached["committees"], rep
    reason = None
    if cache_only():
        reason = "PT_CACHE_ONLY=1 and no cached sponsor list"
    elif not client.enabled:
        reason = "FEC_API_KEY is not set" if not client.key else "the OpenFEC client stopped after an earlier failure"
    else:
        before = client.requests
        try:
            committees = fetch_committees(client)
        except fecapi.ApiError as e:
            reason = f"OpenFEC request failed: {e}"
        else:
            rep.update(status="fetched", retrieved=utc_now(), requests=client.requests - before)
            fecapi.cache_write(CACHE_NAME, {"retrieved": rep["retrieved"], "committees": committees})
            return committees, rep
        rep["requests"] = client.requests - before
    if cached_ok:
        rep.update(status="stale_cache", retrieved=cached.get("retrieved"), warning=reason)
        print(f"  WARNING sponsor list from OpenFEC not refreshed ({reason}); using the cached copy", flush=True)
        return cached["committees"], rep
    rep.update(status="unavailable", warning=reason)
    print(f"  WARNING OpenFEC sponsor linkage skipped ({reason}); using the bulk-file linkage only", flush=True)
    return None, rep


def link_by_ids(committees: list[dict[str, Any]], cand_to_bio: dict[str, str]
                ) -> tuple[list[tuple[str, str, str]], dict[str, Any]]:
    """Link rows (committee, bioguide, METHOD) by exact candidate id, and a report."""
    rows: list[tuple[str, str, str]] = []
    two: list[dict[str, Any]] = []
    with_ids = 0
    for c in sorted(committees, key=lambda c: c["committee_id"]):
        ids = c.get("sponsor_candidate_ids") or []
        with_ids += bool(ids)
        bios = sorted({cand_to_bio[i] for i in ids if i in cand_to_bio})
        if len(bios) == 1:
            rows.append((c["committee_id"], bios[0], METHOD))
        elif len(bios) > 1:
            two.append({"committee": c["committee_id"], "members": bios})
    return rows, {"committees_listed": len(committees), "committees_with_sponsor_ids": with_ids,
                  "linked_to_a_member": len(rows), "sponsor_ids_name_two_members_dropped": two}


def rows_for(cand_to_bio: dict[str, str], client: fecapi.FecApi | None = None
             ) -> tuple[list[tuple[str, str, str]], dict[str, Any]]:
    """Link rows for build._leadership and the `openfec_sponsors` report section; ([], report) when unavailable."""
    committees, rep = load_committees(client)
    if committees is None:
        return [], rep
    rows, link_rep = link_by_ids(committees, cand_to_bio)
    return rows, {**rep, **link_rep}
