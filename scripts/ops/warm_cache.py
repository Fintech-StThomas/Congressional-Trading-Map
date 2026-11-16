"""Request a fixed list of site URLs after a data publish so the first real visitors hit a warm cache.

    python scripts/ops/warm_cache.py --site-url "$SITE_URL" --members web/public/data/members.json

The list is the home page, /wall, /cases, /delays, /orgs, /feed/trades.xml and the member pages of the 10 members
with the most trades. Requests are sequential with a short timeout. This script never fails the job: it logs each
status code and always exits 0. With no site URL it prints a notice and does nothing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

FIXED_PATHS = ("/", "/wall", "/cases", "/delays", "/orgs", "/feed/trades.xml")
TOP_MEMBERS = 10
TIMEOUT_SECONDS = 20
MEMBER_ID = re.compile(r"[A-Za-z0-9_-]{1,40}")
USER_AGENT = "paper-trail-cache-warm/1"


def top_member_ids(members: object, count: int = TOP_MEMBERS) -> list[str]:
    """Ids of the members with the most trades (ties by id), skipping rows that are not usable."""
    rows = []
    if isinstance(members, list):
        for row in members:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not MEMBER_ID.fullmatch(row["id"]):
                continue
            counts = row.get("counts")
            trades = counts.get("trades") if isinstance(counts, dict) else None
            if isinstance(trades, int) and not isinstance(trades, bool) and trades > 0:
                rows.append((-trades, row["id"]))
    return [member_id for _, member_id in sorted(rows)[:count]]


def build_urls(site_url: str, members: object) -> list[str]:
    """Absolute URLs to request; raises ValueError for a site URL that is not http(s)."""
    base = site_url.strip().rstrip("/")
    if not re.fullmatch(r"https?://[^\s/?#]+", base):
        raise ValueError("site URL must look like https://host")
    return [base + path for path in FIXED_PATHS] + [f"{base}/m/{member_id}" for member_id in top_member_ids(members)]


def fetch_status(url: str, timeout: float = TIMEOUT_SECONDS) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - scheme checked in build_urls
            response.read(1024)
            return str(response.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception as exc:  # noqa: BLE001 - only the exception type is logged
        return type(exc).__name__


def warm(urls: list[str], fetch: Callable[[str], str] | None = None, log: Callable[[str], None] = print) -> dict[str, str]:
    fetch = fetch or fetch_status
    results = {}
    for url in urls:
        results[url] = fetch(url)
        log(f"{results[url]} {url}")
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site-url", default="")
    parser.add_argument("--members", type=Path, default=Path("web/public/data/members.json"))
    args = parser.parse_args(argv)
    if not args.site_url.strip():
        print("::notice::SITE_URL is not set; skipping cache warming")
        return 0
    try:
        members = json.loads(args.members.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        members = []
        print("::notice::members.json not readable; warming the fixed pages only")
    try:
        urls = build_urls(args.site_url, members)
    except ValueError as exc:
        print(f"::notice::cache warming skipped: {exc}")
        return 0
    results = warm(urls)
    failed = [url for url, code in results.items() if not code.startswith(("2", "3"))]
    print(f"warmed {len(results) - len(failed)} of {len(results)} URLs" + (f"; {len(failed)} did not answer 2xx/3xx" if failed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
