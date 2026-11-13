"""Member spine from unitedstates/congress-legislators.

Writes pipeline/build/spine.json: bioguide -> member record (name, party, terms, committees,
fec_ids, ...) and pipeline/build/committees.json: committee id -> name, url and roster.
"""
from __future__ import annotations

import subprocess
from collections import Counter
from typing import Any

from .util import BUILD, CACHE, DAY, fetch, print_table, read_json, write_json, write_source_meta

BASE = "https://unitedstates.github.io/congress-legislators"
REPO = "https://github.com/unitedstates/congress-legislators"
FILES = ["legislators-current.json", "legislators-historical.json",
         "committees-current.json", "committee-membership-current.json"]
CUTOFF = "2000-01-01"
SOURCE_ID = "legislators"


def upstream_commit() -> str | None:
    """SHA of the gh-pages branch, which is what unitedstates.github.io serves."""
    try:
        out = subprocess.run(["git", "ls-remote", REPO, "refs/heads/gh-pages"], capture_output=True,
                             text=True, timeout=60, check=True).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    return out.split()[0] if out.strip() else None


def party_code(party: str | None) -> str:
    return {"Democrat": "D", "Republican": "R"}.get(party or "", "I")


def make_term(t: dict[str, Any]) -> dict[str, Any]:
    chamber = "sen" if t["type"] == "sen" else "rep"
    return {"chamber": chamber, "start": t["start"], "end": t["end"], "state": t["state"],
            "district": t.get("district") if chamber == "rep" else None, "party": party_code(t.get("party"))}


def make_member(p: dict[str, Any], current: bool) -> dict[str, Any]:
    terms = sorted((make_term(t) for t in p["terms"]), key=lambda t: t["start"])
    last = terms[-1]
    name = p["name"]
    display = name.get("official_full") or " ".join(x for x in (name.get("first"), name.get("last")) if x)
    return {
        "name": display, "first": name.get("first", ""), "last": name.get("last", ""),
        "party": last["party"], "state": last["state"], "chamber": last["chamber"], "district": last["district"],
        "current": current, "served": [terms[0]["start"], None if current else last["end"]],
        "terms": terms, "fec_ids": sorted(set(p["id"].get("fec", []))), "committees": [],
    }


def build_committees(committees: list[dict[str, Any]], membership: dict[str, list[dict[str, Any]]],
                     spine: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], int]:
    """Attach current committee assignments to members; return committee table and unknown-member count."""
    names: dict[str, dict[str, Any]] = {}
    for c in committees:
        names[c["thomas_id"]] = {"name": c["name"], "url": c.get("url"), "type": c["type"], "parent": None}
        for s in c.get("subcommittees", []):
            names[c["thomas_id"] + s["thomas_id"]] = {
                "name": f"{c['name']}: {s['name']}", "url": c.get("url"), "type": c["type"], "parent": c["thomas_id"]}
    table: dict[str, Any] = {}
    unknown = 0
    for cid in sorted(membership):
        info = names.get(cid)
        if info is None:
            continue
        roster = []
        for m in membership[cid]:
            bio = m.get("bioguide")
            if bio not in spine:
                unknown += 1
                continue
            role = m.get("title")
            roster.append({"id": bio, "role": role})
            spine[bio]["committees"].append({"id": f"cmte:{cid}", "name": info["name"], "role": role, "current": True})
        table[cid] = {**info, "members": sorted(roster, key=lambda r: r["id"])}
    for m in spine.values():
        m["committees"].sort(key=lambda c: c["id"])
    return table, unknown


def run() -> None:
    metas = {f: fetch(f"{BASE}/{f}", CACHE / "legislators" / f, max_age=DAY) for f in FILES}
    current = read_json(CACHE / "legislators" / "legislators-current.json")
    historical = read_json(CACHE / "legislators" / "legislators-historical.json")
    spine: dict[str, dict[str, Any]] = {}
    dropped = 0
    for people, is_current in ((historical, False), (current, True)):
        for p in people:
            if not any(t["end"] >= CUTOFF for t in p["terms"]):
                dropped += 1
                continue
            spine[p["id"]["bioguide"]] = make_member(p, is_current)
    table, unknown = build_committees(read_json(CACHE / "legislators" / "committees-current.json"),
                                      read_json(CACHE / "legislators" / "committee-membership-current.json"), spine)
    write_json(BUILD / "spine.json", spine)
    write_json(BUILD / "committees.json", table)

    n_current = sum(m["current"] for m in spine.values())
    parties = Counter((m["party"], m["chamber"]) for m in spine.values() if m["current"])
    print(f"spine: {len(spine)} people kept ({n_current} current), {dropped} historical people end before {CUTOFF}")
    print_table("current members by party and chamber", sorted((p, c, n) for (p, c), n in parties.items()),
                ("party", "chamber", "n"))
    sha = upstream_commit()
    write_source_meta(SOURCE_ID, {SOURCE_ID: {
        "name": "unitedstates/congress-legislators", "url": REPO, "revision": sha,
        "retrieved": min(m["retrieved"] for m in metas.values()), "licence": "CC0-1.0 (public domain)",
        "files": [{"path": f, "bytes": m["bytes"], "sha256": m["sha256"], "url": m["url"],
                   "last_modified": m["last_modified"]} for f, m in metas.items()],
    }}, {
        "people_kept": len(spine), "people_current": n_current, "people_dropped_before_cutoff": dropped,
        "committees": len(table), "committee_rows_unknown_member": unknown,
        "notes": ["Committee assignments exist only for the current Congress; historical assignments are not loaded.",
                  "Party is the party of the most recent term; anything other than Democrat or Republican maps to I."],
    })
