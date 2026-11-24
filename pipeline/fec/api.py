"""Small OpenFEC (api.open.fec.gov) client shared by the sponsor and purpose-group modules, plus their JSON cache.

The key is read from the environment variable FEC_API_KEY (the repository secret in the daily job) and is never printed,
stored in a cache file or put into an error message: requests errors carry the full URL, so every failure is re-raised
as `ApiError` with only the status code or the exception type. Without a key `FecApi.enabled` is False and callers fall
back to cached data or to the existing bulk-file linkage; nothing here ever raises into the pipeline except ApiError,
which callers catch.

Politeness: a run makes a few hundred requests at most (hard stop at MAX_REQUESTS, the OpenFEC limit with a key is
1,000 an hour); 5xx answers and connection errors are retried twice with a short pause, a 429 twice after the
Retry-After wait (default a minute), any other 4xx is not retried.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Iterator

import requests

from ..util import dumps, read_json, user_agent
from . import download

BASE = "https://api.open.fec.gov/v1"
MAX_REQUESTS = 400        # hard stop per run (the daily budget is well under this; see pipeline/fec/README.md)
MAX_PAGES = 200


class ApiError(Exception):
    """An OpenFEC request failed or answered something unusable. The message never contains the URL or the key."""


def _retry_after(r: Any) -> float:
    """Seconds to wait after a 429: the Retry-After header if it is a number, else a minute; at most two minutes."""
    try:
        return min(max(float(r.headers.get("Retry-After", 60)), 1.0), 120.0)
    except (TypeError, ValueError):
        return 60.0


class FecApi:
    def __init__(self, key: str | None = None, session: Any = None, sleep: Callable[[float], None] = time.sleep,
                 max_requests: int = MAX_REQUESTS) -> None:
        self.key = key if key is not None else os.environ.get("FEC_API_KEY", "").strip()
        self.session = session or requests.Session()
        self.sleep = sleep
        self.max_requests = max_requests
        self.requests = 0
        self.failed = False        # after a failure that is not about one request, stop calling for the rest of the run

    @property
    def enabled(self) -> bool:
        return bool(self.key) and not self.failed

    def get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.key:
            raise ApiError("FEC_API_KEY is not set")
        last = "no attempt"
        for attempt in range(3):
            if self.requests >= self.max_requests:
                raise ApiError(f"request budget of {self.max_requests} per run used up")
            self.requests += 1
            try:
                r = self.session.get(BASE + path, params={**params, "api_key": self.key}, timeout=60,
                                     headers={"User-Agent": user_agent()})
            except requests.RequestException as e:
                last = f"network error ({type(e).__name__})"
            else:
                if r.status_code == 429:
                    last = "HTTP 429: rate limit reached"
                    if attempt < 2:
                        self.sleep(_retry_after(r))
                        continue
                    break
                if 400 <= r.status_code < 500:
                    raise ApiError(f"HTTP {r.status_code}")
                if r.status_code >= 500:
                    last = f"HTTP {r.status_code}"
                else:
                    try:
                        body = r.json()
                    except ValueError:
                        raise ApiError("answer is not JSON") from None
                    if not isinstance(body, dict) or not isinstance(body.get("results"), list) \
                            or not isinstance(body.get("pagination"), dict):
                        raise ApiError("answer lacks results or pagination")
                    return body
            if attempt < 2:
                self.sleep(2.0 * (attempt + 1))
        self.failed = True
        raise ApiError(last)

    def pages(self, path: str, params: dict[str, Any]) -> Iterator[dict[str, Any]]:
        """Yield every result row of a paged listing; ApiError if the rows do not add up to the stated count."""
        got = page = 0
        while True:
            page += 1
            body = self.get(path, {**params, "per_page": 100, "page": page})
            yield from body["results"]
            got += len(body["results"])
            pg = body["pagination"]
            try:
                last = page >= int(pg.get("pages") or 0)
            except (TypeError, ValueError):
                raise ApiError("pagination is not numeric") from None
            if last:
                break
            if page >= MAX_PAGES:
                raise ApiError("too many pages")
        if pg.get("count") is not None and got != pg["count"]:
            raise ApiError(f"{got} rows read but the API counts {pg['count']}")


_DEFAULT: FecApi | None = None


def default() -> FecApi:
    """The client of this run (created on first use, so one request counter covers every module)."""
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = FecApi()
    return _DEFAULT


def cache_dir() -> Path:
    return download.CACHE / "api"


def cache_read(name: str) -> dict[str, Any] | None:
    """The cached JSON object, or None if absent, unreadable or not an object."""
    p = cache_dir() / name
    try:
        obj = read_json(p) if p.exists() else None
    except (OSError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


def cache_write(name: str, obj: dict[str, Any]) -> None:
    p = cache_dir() / name
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".part")
    tmp.write_text(dumps(obj) + "\n", encoding="utf-8")
    os.replace(tmp, p)


def age_seconds(obj: dict[str, Any], now: float) -> float:
    """Seconds since the cache object's `retrieved` stamp (infinite if it has none)."""
    s = obj.get("retrieved")
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", s):
        return float("inf")
    import calendar
    return now - calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))
