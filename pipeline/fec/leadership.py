"""Combine the leadership-PAC sponsor sources into one committee -> member link (data dictionary: "Campaign finance block").

Rows are (committee, bioguide, method) from three exact-or-filed sources: `fec_candidate_id` (an FEC candidate id on the
committee), `fec_api_sponsor_id` (OpenFEC's `sponsor_candidate_ids`, exact id) and `leadership_file_exact_name` (the
FEC sponsor file's name equal to a candidate-master name). Rules, in order:
1. A committee whose rows name one member is linked, method = the agreeing methods sorted and joined with '+'.
2. When the API names a member and an exact candidate id names another, both are ids and neither wins: dropped, reported.
3. When the API names a member and only the name file names another, the API's exact id wins; the name-file row is
   reported in `name_file_overridden_by_api`.
4. Otherwise (no API row) rows naming different members drop the committee, as before (`conflicting_sources_dropped`).
"""
from __future__ import annotations

from typing import Any

API = "fec_api_sponsor_id"
CANDIDATE = "fec_candidate_id"


def merge(rows: list[tuple[str, str, str]]) -> tuple[list[tuple[str, str, str]], list[dict], list[dict]]:
    """(final links sorted by committee, conflicts dropped, name-file rows overridden by the API)."""
    by: dict[str, dict[str, set[str]]] = {}
    for cmte, bio, how in rows:
        by.setdefault(cmte, {}).setdefault(bio, set()).add(how)
    final: list[tuple[str, str, str]] = []
    conflicts: list[dict] = []
    overridden: list[dict] = []
    for cmte in sorted(by):
        bios = by[cmte]
        api_bios = [b for b, h in bios.items() if API in h]
        if len(bios) == 1:
            bio, hows = next(iter(bios.items()))
            final.append((cmte, bio, "+".join(sorted(hows))))
        elif len(api_bios) == 1:
            bio = api_bios[0]
            others = {b: h for b, h in bios.items() if b != bio}
            if any(CANDIDATE in h for h in others.values()):
                conflicts.append({"committee": cmte, "members": sorted(bios)})
                continue
            overridden.append({"committee": cmte, "api_member": bio, "name_file_members": sorted(others)})
            final.append((cmte, bio, "+".join(sorted(bios[bio]))))
        else:
            conflicts.append({"committee": cmte, "members": sorted(bios)})
    return final, conflicts, overridden


def combine(rows: list[tuple[str, str, str]]) -> tuple[list[tuple[str, str, str]], dict[str, Any]]:
    """Final links and the report entries that come from the merge (the caller adds the file-source counts)."""
    final, conflicts, overridden = merge(rows)
    baseline = {c for c, _, _ in merge([r for r in rows if r[2] != API])[0]}
    return final, {
        "sponsors_resolved": len(final),
        "by_method": {m: sum(1 for _, _, h in final if h == m) for m in sorted({h for _, _, h in final})},
        "linked_by_api_total": sum(1 for _, _, h in final if API in h.split("+")),
        "newly_linked_by_api": sum(1 for c, _, h in final if API in h.split("+") and c not in baseline),
        "conflicting_sources_dropped": conflicts,
        "name_file_overridden_by_api": overridden,
    }
