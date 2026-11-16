"""Parse cached Congress.gov responses into a member -> bill fact table (pilot; never published).

Reads the raw pages written by download.py; writes nothing. Identity rule: a row is attributed to a member only
because the request that returned it was made for that exact bioguide id, and the member record that came back
names the same id. No name is read or compared anywhere in this module. A bill id is `<congress>-<type>-<number>`
from the item's own fields, never parsed from a title.
"""
from __future__ import annotations

import json
from collections import Counter
from itertools import combinations
from typing import Any

from .download import CONGRESS, KINDS, LIST_KEY, member_dir, page_path

# Congress.gov web path segment for each bill type code; an unknown code is dropped and counted, not guessed.
WEB_TYPE = {"hr": "house-bill", "s": "senate-bill", "hres": "house-resolution", "sres": "senate-resolution",
            "hjres": "house-joint-resolution", "sjres": "senate-joint-resolution",
            "hconres": "house-concurrent-resolution", "sconres": "senate-concurrent-resolution"}
ROW_KEYS = ["member", "role", "bill_id", "congress", "bill_type", "number", "introduced", "policy_area", "title",
            "latest_action_date", "congress_url", "api_url"]


def parse_member(doc: dict[str, Any], expected: str) -> dict[str, Any]:
    """The member record, after checking it is the requested id (exact, case-insensitive: the API lower-cases ids
    in its `request` echo but not in `member.bioguideId`)."""
    m = doc["member"]
    if m["bioguideId"].upper() != expected.upper():
        raise ValueError(f"asked for {expected}, got {m['bioguideId']}")
    last = (m.get("terms") or [{}])[-1] if isinstance(m.get("terms"), list) else {}
    party = (m.get("partyHistory") or [{}])[-1].get("partyAbbreviation")
    return {"bioguide": m["bioguideId"], "current": bool(m.get("currentMember")), "party": party,
            "chamber": last.get("chamber"), "state": last.get("stateCode"), "name": m.get("directOrderName")}


def bill_row(item: dict[str, Any], member: str, role: str, congress: int) -> dict[str, Any] | None:
    """One fact row, or None when the item is from another Congress or lacks an id part."""
    if item.get("congress") != congress:
        return None
    btype, number = str(item.get("type") or "").lower(), str(item.get("number") or "")
    if btype not in WEB_TYPE or not number.isdigit():
        return None
    return {"member": member, "role": role, "bill_id": f"{congress}-{btype}-{number}", "congress": congress,
            "bill_type": btype, "number": number, "introduced": item.get("introducedDate"),
            "policy_area": (item.get("policyArea") or {}).get("name"), "title": item.get("title"),
            "latest_action_date": (item.get("latestAction") or {}).get("actionDate"),
            "congress_url": f"https://www.congress.gov/bill/{congress}th-congress/{WEB_TYPE[btype]}/{number}",
            "api_url": item.get("url")}


def read_pages(bio: str, role: str) -> list[dict[str, Any]]:
    pages, n = [], 1
    while page_path(bio, role, n).exists():
        pages.append(json.loads(page_path(bio, role, n).read_text(encoding="utf-8")))
        n += 1
    return pages


def build_facts(members: tuple[str, ...], pages: dict[tuple[str, str], list[dict[str, Any]]],
                member_docs: dict[str, dict[str, Any]], spine_ids: set[str] | None,
                congress: int = CONGRESS) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fact rows (deduplicated on member, role, bill) plus a report of every drop and anomaly."""
    rows: dict[tuple[str, str, str], dict[str, Any]] = {}
    rep: dict[str, Any] = {"members": {}, "dropped": Counter(), "duplicates": 0}
    for bio in members:
        info = parse_member(member_docs[bio], bio)
        rep["members"][bio] = {**info, "in_spine": None if spine_ids is None else bio in spine_ids}
        if not info["current"]:
            raise ValueError(f"{bio} is not a current member; the pilot set must be reviewed again")
        if spine_ids is not None and bio not in spine_ids:
            raise ValueError(f"{bio} is not in the member spine")
        for role in KINDS:
            for doc in pages.get((bio, role), []):
                for item in doc.get(LIST_KEY[role]) or []:
                    row = bill_row(item, bio, role, congress)
                    if row is None:
                        reason = ("other_congress" if item.get("congress") != congress else
                                  "amendment_not_a_bill" if item.get("amendmentNumber") else "no_exact_bill_id")
                        rep["dropped"][reason] += 1
                        continue
                    key = (bio, role, row["bill_id"])
                    rep["duplicates"] += key in rows
                    rows[key] = row
            rep["members"][bio][role] = sum(1 for k in rows if k[0] == bio and k[1] == role)
    out = sorted(rows.values(), key=lambda r: (r["member"], r["role"], r["bill_id"]))
    rep["dropped"] = dict(rep["dropped"])
    rep["rows"] = len(out)
    rep["sponsor_and_cosponsor_same_bill"] = sum(1 for (b, r, bid) in rows if r == "sponsor" and (b, "cosponsor", bid) in rows)
    rep["shared_bills_by_pair"] = shared_bills(out)
    return out, rep


def shared_bills(rows: list[dict[str, Any]]) -> dict[str, int]:
    """For each pair of pilot members, the number of bills on which both appear (either role). A count of facts
    only: it is not a tie, and no edge is built from it (see docs/SOURCE-EXPANSION.md)."""
    by_bill: dict[str, set[str]] = {}
    for r in rows:
        by_bill.setdefault(r["bill_id"], set()).add(r["member"])
    pairs: Counter[tuple[str, str]] = Counter()
    for who in by_bill.values():
        pairs.update(combinations(sorted(who), 2))
    return {f"{a}+{b}": n for (a, b), n in sorted(pairs.items())}


def load_cached(members: tuple[str, ...]) -> tuple[dict[tuple[str, str], list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    pages = {(b, r): read_pages(b, r) for b in members for r in KINDS}
    docs = {b: json.loads((member_dir(b) / "member.json").read_text(encoding="utf-8")) for b in members}
    return pages, docs
