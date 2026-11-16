"""Entry point of the Congress.gov pilot: python -m pipeline.congress.run [--download] [--sample].

Off unless PT_ENABLE_CONGRESS=1 (then it prints one line and does nothing: no network, no files). Writes only under
pipeline/build/congress/ (member_bills.jsonl, report.json, and with --sample congress-sample.csv) and, once, the
review template docs/validation/congress-sample.csv when none exists. It writes no file under build/edges, build/orgs
or build/sources, so the assembler never sees it and nothing reaches web/public/data.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from pathlib import Path
from typing import Any

from ..util import BUILD, dumps
from . import download as dl
from .facts import build_facts, load_cached

OUT = BUILD / "congress"
SAMPLE = OUT / "congress-sample.csv"
REVIEWED_SAMPLE = dl.REPO / "docs" / "validation" / "congress-sample.csv"
SAMPLE_PER_GROUP, SAMPLE_SEED = 3, 20261116
REVIEW_COLS = ["checked_by", "matches_source", "comment"]
SAMPLE_COLS = ["member", "role", "bill_id", "introduced", "policy_area", "title", "congress_url", "api_url"]
SOURCE = {"name": "Congress.gov API v3 (Library of Congress): member sponsored and cosponsored legislation",
          "url": "https://api.congress.gov/v3/", "licence": "US government public data; terms at "
          "https://api.congress.gov/ (not re-verified this session)"}


def enabled() -> bool:
    return os.environ.get("PT_ENABLE_CONGRESS") == "1"


def spine_ids() -> set[str] | None:
    path = BUILD / "spine.json"
    return set(json.loads(path.read_text())) if path.exists() else None


def write_sample(rows: list[dict[str, Any]], path: Path | None = None, template: Path | None = None) -> None:
    """Up to SAMPLE_PER_GROUP rows per member and role, fixed seed. Reviewer columns stay empty: a person fills
    them in. The template copy is made only when none exists, so a reviewed copy is never overwritten."""
    path, template = path or SAMPLE, template or REVIEWED_SAMPLE
    rng, pick = random.Random(SAMPLE_SEED), []
    for key in sorted({(r["member"], r["role"]) for r in rows}):
        group = [r for r in rows if (r["member"], r["role"]) == key]
        pick += rng.sample(group, min(SAMPLE_PER_GROUP, len(group)))
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(SAMPLE_COLS + REVIEW_COLS)
        for r in pick:
            w.writerow([r[c] for c in SAMPLE_COLS] + [""] * len(REVIEW_COLS))
    if not template.exists():
        template.parent.mkdir(parents=True, exist_ok=True)
        template.write_bytes(path.read_bytes())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--download", action="store_true", help="fetch missing pages (about 25 requests for the pilot set)")
    ap.add_argument("--refresh", action="store_true", help="with --download: refetch even cached pages")
    ap.add_argument("--sample", action="store_true", help="also write the human-review CSV")
    a = ap.parse_args(argv)
    if not enabled():
        print("  congress: skipped (set PT_ENABLE_CONGRESS=1 to enable; unreviewed pilot, never published)")
        return 0
    report: dict[str, Any] = {"source": SOURCE, "congress": dl.CONGRESS, "pilot_members": list(dl.PILOT_MEMBERS)}
    if a.download:
        client = dl.Client()
        report["download"] = dl.download(client, refresh=a.refresh)
        report["requests_made"] = client.requests_made
    try:
        pages, docs = load_cached(dl.PILOT_MEMBERS)
    except FileNotFoundError:
        print("  congress: no cached pages; run python -m pipeline.congress.run --download")
        return 0
    rows, rep = build_facts(dl.PILOT_MEMBERS, pages, docs, spine_ids())
    report.update(rep)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "member_bills.jsonl").write_text("".join(dumps(r) + "\n" for r in rows), encoding="utf-8")
    (OUT / "report.json").write_text(json.dumps(report, indent=1, sort_keys=True), encoding="utf-8")
    if a.sample:
        write_sample(rows)
    print(f"  congress: {len(rows)} member-bill facts for {len(dl.PILOT_MEMBERS)} members "
          f"(unreviewed, unpublished) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
