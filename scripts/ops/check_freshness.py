"""Fail loudly when the published data is stale or unreachable (run on a schedule by .github/workflows/freshness.yml).

    DATA_PUBLIC_URL=https://host python scripts/ops/check_freshness.py [--max-hours 48]

Fetches <base>/data/meta.json, reads build.time and compares its age with the limit. The base comes from
DATA_PUBLIC_URL, else R2_PUBLIC_URL (used only as a URL). The URL is never printed. Exit 1 with a GitHub `::error::`
line when the data is older than the limit, unreachable or unreadable; exit 0 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Callable

MAX_HOURS = 48.0
TIMEOUT_SECONDS = 30
MAX_BYTES = 8 * 1024 * 1024


def meta_url(base: str) -> str:
    base = base.strip().rstrip("/")
    if not re.fullmatch(r"https?://[^\s?#]+", base):
        raise ValueError("the public data URL is missing or is not an http(s) URL")
    return base + ("/meta.json" if base.endswith("/data") else "/data/meta.json")


def parse_time(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("build.time is missing")
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("build.time is not an ISO timestamp") from None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def fetch_meta(url: str) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": "paper-trail-freshness/1", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - scheme checked in meta_url
        return json.loads(response.read(MAX_BYTES))


def check(base: str, max_hours: float = MAX_HOURS, *, fetch: Callable[[str], object] = fetch_meta,
          now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> tuple[bool, str]:
    """(ok, message). Messages never contain the URL or exception text."""
    try:
        url = meta_url(base)
    except ValueError as exc:
        return False, str(exc)
    try:
        meta = fetch(url)
    except Exception as exc:  # noqa: BLE001 - the URL can appear in exception text; report the type only
        return False, f"the published data could not be fetched or parsed ({type(exc).__name__})"
    build = meta.get("build") if isinstance(meta, dict) else None
    try:
        built = parse_time(build.get("time") if isinstance(build, dict) else None)
    except ValueError as exc:
        return False, f"meta.json is unusable: {exc}"
    age = (now() - built).total_seconds() / 3600
    if age > max_hours:
        return False, f"the published data is {age:.1f} hours old (build time {built:%Y-%m-%dT%H:%M:%SZ}); limit {max_hours:g} hours"
    return True, f"the published data is {max(age, 0):.1f} hours old (limit {max_hours:g})"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--max-hours", type=float, default=MAX_HOURS)
    args = parser.parse_args(argv)
    base = os.environ.get("DATA_PUBLIC_URL", "").strip() or os.environ.get("R2_PUBLIC_URL", "").strip()
    ok, message = check(base, args.max_hours)
    print(message if ok else f"::error::Stale or unreachable data: {message}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
