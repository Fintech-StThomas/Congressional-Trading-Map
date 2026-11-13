"""`sits_with` context edges: members who currently sit on the same full committee.

One edge per member pair (never one per committee), with the shared committees in `note` and up to
five committee pages as evidence. Writes pipeline/build/edges/committees.jsonl.
"""
from __future__ import annotations

from collections import defaultdict
from email.utils import parsedate_to_datetime
from itertools import combinations

from .edges import make_edge, node, top_evidence
from .spine import SOURCE_ID
from .util import BUILD, EDGES_DIR, read_json, write_jsonl


def roster_date() -> str:
    """Date the committee roster last changed upstream (Last-Modified), so unchanged rosters give identical edges."""
    source = read_json(BUILD / "sources" / "legislators.json")["sources"][SOURCE_ID]
    f = next(f for f in source["files"] if f["path"] == "committee-membership-current.json")
    return parsedate_to_datetime(f["last_modified"]).date().isoformat() if f.get("last_modified") else source["retrieved"][:10]


def run() -> None:
    committees = read_json(BUILD / "committees.json")
    as_of = roster_date()
    shared: dict[tuple[str, str], list[str]] = defaultdict(list)
    for cid, c in sorted(committees.items()):
        if c["parent"] is not None:
            continue
        for a, b in combinations(sorted({m["id"] for m in c["members"]}), 2):
            shared[(a, b)].append(cid)
    edges = []
    for (a, b), cids in sorted(shared.items()):
        evidence = top_evidence([{"label": committees[c]["name"], "date": as_of,
                                  "url": committees[c]["url"], "source": SOURCE_ID, "record": f"cmte:{c}"} for c in cids])
        edges.append(make_edge(
            "sits_with", node("member", a), node("member", b), directed=False, basis="filed",
            years=[{"y": int(as_of[:4]), "n": len(cids), "low": None, "high": None, "exact": None}],
            first=as_of, last=as_of, evidence=evidence, evidence_total=len(cids),
            note="; ".join(committees[c]["name"] for c in cids)))
    n = write_jsonl(EDGES_DIR / "committees.jsonl", edges)
    print(f"sits_with edges: {n} member pairs across {sum(c['parent'] is None for c in committees.values())} full committees")
