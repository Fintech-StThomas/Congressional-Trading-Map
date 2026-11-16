"""Rate-limited, cached client for the Congress.gov API v3 (https://api.congress.gov/v3/), pilot members only.

Facts relied on (verified with small requests on 2026-11-16; see docs/SOURCE-EXPANSION.md):
  * member/<bioguideId> returns the member record; member/<id>/sponsored-legislation and .../cosponsored-legislation
    list bills, `limit` up to 250, with `pagination.count` and `pagination.next`;
  * the lists have no Congress filter and are ordered by last update, so all pages are read (every Congress);
  * every item carries `congress`, `type`, `number`, `introducedDate`, `url`.

Cache: pipeline/.cache/congress/<bioguide>/<kind>/p00001.json holds the raw response text, one file per page, with a
state.json beside them (complete or truncated, pages, retrieved date). No key is ever stored: the key goes in the
`api_key` query parameter (or is substituted by a network proxy) and is not part of the cached text or any path.
Authentication: CONGRESS_API_KEY if set, else the literal placeholder DUMMY, which only works behind a proxy that
substitutes the real key.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
from pathlib import Path
from typing import Any, Callable

import requests

from ..util import utc_now

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "pipeline" / ".cache" / "congress"
API = "https://api.congress.gov/v3"
CONGRESS = 119                 # 2025-01-03 .. 2027-01-03 (api: congress/current, checked 2026-11-16)
PAGE_SIZE = 250                # documented maximum
MAX_PAGES = 14                 # per member and role; a larger list is marked truncated, never silently cut
SECONDS_BETWEEN_REQUESTS = 0.5
USER_AGENT = "congressional-trading-map-class-project (public records research)"
KINDS = {"sponsor": "sponsored-legislation", "cosponsor": "cosponsored-legislation"}
LIST_KEY = {"sponsor": "sponsoredLegislation", "cosponsor": "cosponsoredLegislation"}   # array name in each response

# The reviewed set: five current members, ids checked against api.congress.gov member/<id> on 2026-11-16
# (bioguideId, currentMember true, 119th Congress term): Thune (Senate, R), Johnson and Fedorchak (House, R),
# Jeffries and Walkinshaw (House, D). Senators with long histories are costly because the lists cover every Congress.
PILOT_MEMBERS = ("T000250", "J000299", "J000294", "W000831", "F000482")


def api_key() -> str:
    return os.environ.get("CONGRESS_API_KEY") or "DUMMY"


class Client:
    """GET with a fixed pause between requests, retry on 429/5xx, and a hard error on other 4xx answers."""

    def __init__(self, session: Any = None, pause: float = SECONDS_BETWEEN_REQUESTS,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.session = session or requests.Session()
        self.pause, self.sleep, self.requests_made = pause, sleep, 0

    def get(self, path: str, params: dict[str, Any] | None = None) -> str:
        query = {**(params or {}), "format": "json", "api_key": api_key()}
        last = ""
        for attempt in range(4):
            self.sleep(self.pause)
            self.requests_made += 1
            r = self.session.get(f"{API}{path}", params=query, headers={"User-Agent": USER_AGENT}, timeout=60)
            if r.status_code == 200:
                return r.text
            last = f"HTTP {r.status_code}"
            if r.status_code == 429 or r.status_code >= 500:
                self.sleep(float(r.headers.get("Retry-After") or 2 * (attempt + 1)))
                continue
            raise RuntimeError(f"Congress.gov {path}: {last}")
        raise RuntimeError(f"Congress.gov {path}: gave up after 4 attempts ({last})")


def member_dir(bio: str) -> Path:
    return CACHE / bio


def page_path(bio: str, kind: str, page: int) -> Path:
    return member_dir(bio) / kind / f"p{page:05d}.json"


def fetch_member(client: Client, bio: str, *, refresh: bool = False) -> None:
    dest = member_dir(bio) / "member.json"
    if dest.exists() and not refresh:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(client.get(f"/member/{bio}"), encoding="utf-8")


def fetch_list(client: Client, bio: str, role: str, *, congress: int = CONGRESS, max_pages: int = MAX_PAGES,
               refresh: bool = False) -> dict[str, Any]:
    """Page through one member's whole sponsored or cosponsored list, caching every page. The API lists every
    Congress, ordered by last update (not by Congress) and has no Congress filter, so the 119th is selected later,
    from each item's own `congress` field. A list longer than max_pages is recorded as truncated, never cut silently."""
    state_path = page_path(bio, role, 0).with_name("state.json")
    if state_path.exists() and not refresh:
        return json.loads(state_path.read_text())
    pages, count, complete = 0, None, False
    for n in range(1, max_pages + 1):
        text = client.get(f"/member/{bio}/{KINDS[role]}", {"limit": PAGE_SIZE, "offset": (n - 1) * PAGE_SIZE})
        dest = page_path(bio, role, n)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        doc = json.loads(text)
        pages, count = n, (doc.get("pagination") or {}).get("count")
        if not doc.get(LIST_KEY[role]) or not (doc.get("pagination") or {}).get("next"):
            complete = True
            break
    state = {"complete": complete, "pages": pages, "count_reported_all_congresses": count, "congress": congress,
             "retrieved": utc_now(), "retrieved_date": dt.date.today().isoformat()}
    state_path.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    return state


def download(client: Client, members: tuple[str, ...] | None = None, *, refresh: bool = False,
             max_pages: int = MAX_PAGES) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for bio in members or PILOT_MEMBERS:
        fetch_member(client, bio, refresh=refresh)
        out[bio] = {role: fetch_list(client, bio, role, max_pages=max_pages, refresh=refresh) for role in KINDS}
    return out
