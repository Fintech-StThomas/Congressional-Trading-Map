"""Shared paths, cached HTTP downloads, deterministic JSON writing and small helpers."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import requests

ROOT = Path(__file__).resolve().parents[1]
PIPE = ROOT / "pipeline"
CACHE = PIPE / ".cache"
BUILD = PIPE / "build"
EDGES_DIR = BUILD / "edges"
ORGS_DIR = BUILD / "orgs"
SOURCES_DIR = BUILD / "sources"
OUT = ROOT / "web" / "public" / "data"
PORTRAITS = ROOT / "web" / "public" / "portraits"
CROSSWALK = PIPE / "crosswalk"

DEFAULT_UA = "congressional-trading-map-class-project research@example.org"
DAY = 86400.0


def user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT") or DEFAULT_UA


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class RateLimiter:
    """Allow at most `per_second` calls per second across threads."""

    def __init__(self, per_second: float) -> None:
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            delay = self.next_at - now
            self.next_at = max(now, self.next_at) + self.interval
        if delay > 0:
            time.sleep(delay)


_session = requests.Session()


def fetch(url: str, dest: Path, *, max_age: float | None = None, headers: dict[str, str] | None = None,
          limiter: RateLimiter | None = None, retries: int = 4) -> dict[str, Any]:
    """Download url to dest unless a cached copy younger than max_age seconds exists.

    max_age=None means the cached file never expires (use for content-addressed URLs).
    Returns the sidecar metadata (url, retrieved, bytes, sha256, etag, last_modified).
    Raises requests.HTTPError for 4xx answers so callers can treat 404 as "absent".
    """
    meta_path = dest.with_name(dest.name + ".meta.json")
    if dest.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if max_age is None or time.time() - dest.stat().st_mtime < max_age:
            return meta
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    last_err: Exception | None = None
    for attempt in range(retries):
        if limiter:
            limiter.wait()
        try:
            with _session.get(url, headers={"User-Agent": user_agent(), **(headers or {})},
                              stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tmp, "wb") as out:
                    for chunk in r.iter_content(1 << 20):
                        out.write(chunk)
                os.replace(tmp, dest)
                meta = {"url": url, "retrieved": utc_now(), "bytes": dest.stat().st_size,
                        "sha256": sha256_file(dest), "etag": r.headers.get("ETag"),
                        "last_modified": r.headers.get("Last-Modified")}
                meta_path.write_text(json.dumps(meta, indent=1, sort_keys=True))
                return meta
        except requests.HTTPError as e:
            if e.response is not None and 400 <= e.response.status_code < 500 and e.response.status_code != 429:
                raise
            last_err = e
        except (requests.ConnectionError, requests.Timeout, OSError) as e:
            last_err = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"download failed after {retries} attempts: {url}: {last_err}")


def dumps(obj: Any) -> str:
    """Minified, key-sorted JSON so daily diffs stay small."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def write_json(path: Path, obj: Any, *, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False) if pretty else dumps(obj)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text + ("\n" if pretty else ""), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = sorted(dumps(r) for r in rows)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    os.replace(tmp, path)
    return len(lines)


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def write_source_meta(name: str, sources: dict[str, dict[str, Any]], report: dict[str, Any]) -> None:
    """Plug-in source metadata, merged by the assembler into meta.json."""
    write_json(SOURCES_DIR / f"{name}.json", {"sources": sources, "report": report}, pretty=True)


SUFFIXES = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LLC", "LTD", "PLC", "HOLDINGS", "GROUP", "THE"}


def normalise_name(name: str) -> str:
    """Uppercase; delete periods and apostrophes; other punctuation becomes a space;
    drop trailing corporate suffixes repeatedly, and a leading THE. Documented in the contract."""
    words = re.sub(r"[^A-Z0-9]+", " ", re.sub(r"[.'’]", "", name.upper())).split()
    while words and words[-1] in SUFFIXES:
        words.pop()
    if words and words[0] == "THE":
        words = words[1:]
    return " ".join(words)


def clean_sec_name(name: str) -> str:
    """Drop the state-of-incorporation or status tag EDGAR appends to some registrant
    names (e.g. "MASCO CORP /DE/", "KEYCORP /NEW/"); it is not part of the company's name."""
    return re.sub(r"\s*[/\\][A-Za-z]{2,4}[/\\]?\s*$", "", name).strip()


def normalise_ticker(ticker: str) -> str:
    """Uppercase and unify share-class punctuation: BRK/B, BRK-B, BRK B -> BRK.B."""
    return re.sub(r"[\s/\-_.]+", ".", ticker.strip().upper()).strip(".")


def print_table(title: str, rows: Iterable[tuple[Any, ...]], headers: tuple[str, ...]) -> None:
    rows = [tuple("" if v is None else str(v) for v in r) for r in rows]
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]
    print(f"\n{title}")
    print("  " + "  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    for r in rows:
        print("  " + "  ".join(v.ljust(w) for v, w in zip(r, widths)))
