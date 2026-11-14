"""Shared helpers every stage uses: paths, cached HTTP downloads with retry, deterministic JSON writing, the org
override file, and name/ticker normalisation (data dictionary: "Identifiers"). Reads and writes only what callers ask.

Environment: PT_OUT_DIR (publish somewhere other than web/public/data), PT_CACHE_ONLY=1 (reuse every cached download),
SEC_USER_AGENT (User-Agent for every request).
"""
from __future__ import annotations

import csv
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

from .config import DAY

ROOT = Path(__file__).resolve().parents[1]
PIPE = ROOT / "pipeline"
CACHE = PIPE / ".cache"
BUILD = PIPE / "build"
EDGES_DIR = BUILD / "edges"
ORGS_DIR = BUILD / "orgs"
SOURCES_DIR = BUILD / "sources"
# PT_OUT_DIR redirects the published tree (tests, dry runs); the default is the folder the site reads.
OUT = Path(os.environ["PT_OUT_DIR"]).resolve() if os.environ.get("PT_OUT_DIR") else ROOT / "web" / "public" / "data"
PORTRAITS = ROOT / "web" / "public" / "portraits"
CROSSWALK = PIPE / "crosswalk"

DEFAULT_UA = "congressional-trading-map-class-project research@example.org"


def user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT") or DEFAULT_UA


def cache_only() -> bool:
    """PT_CACHE_ONLY=1: reuse every cached download regardless of age (reproducible rebuilds, offline work)."""
    return os.environ.get("PT_CACHE_ONLY") == "1"


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
        if max_age is None or cache_only() or time.time() - dest.stat().st_mtime < max_age:
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
                expected = r.headers.get("Content-Length")
                # A server that closes early leaves a short file; never cache it (only for unencoded bodies,
                # where Content-Length is the byte count on disk).
                if expected and not r.headers.get("Content-Encoding") and tmp.stat().st_size != int(expected):
                    raise requests.ConnectionError(f"short read: {tmp.stat().st_size} of {expected} bytes")
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
        except (requests.RequestException, OSError) as e:  # includes ChunkedEncodingError and short reads
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


def read_overrides(sources: set[str]) -> tuple[list[dict[str, str]], int]:
    """Hand-reviewed org matches from pipeline/crosswalk/org_overrides.csv (data dictionary: "Org overrides").

    Returns (rows whose `source` (case-insensitive) is in `sources` and that have a key, an org id and a reviewer,
    with those fields stripped and `source` lower-cased; number of rows in the file). Unreviewed rows are ignored,
    never applied: a match nobody checked is not evidence."""
    path = CROSSWALK / "org_overrides.csv"
    if not path.exists():
        return [], 0
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        r = {k: (v or "").strip() for k, v in r.items() if k}
        r["source"] = r.get("source", "").lower()
        if r["source"] in sources and r.get("source_id_or_name") and r.get("org_id") and r.get("reviewed_by"):
            out.append(r)
    return out, len(rows)


def print_table(title: str, rows: Iterable[tuple[Any, ...]], headers: tuple[str, ...]) -> None:
    rows = [tuple("" if v is None else str(v) for v in r) for r in rows]
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]
    print(f"\n{title}")
    print("  " + "  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    for r in rows:
        print("  " + "  ".join(v.ljust(w) for v, w in zip(r, widths)))


# ------------------------------------------------------------------------------------------ payee names
# Private individuals who are not the subject of the site are never named. A payee (FEC independent expenditure
# vendor, consultant, ...) is published only when it is clearly an organisation: the FEC entity type is not an
# individual's (IND, CAN) AND the name carries an organisational marker. Anything else is dropped (when unsure, drop).
INDIVIDUAL_ENTITY_TYPES = {"IND", "CAN"}
ORG_MARKER_WORDS = {
    "LLC", "LLP", "PLLC", "LP", "LTD", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COMPANIES",
    "PLC", "MEDIA", "GROUP", "PARTNERS", "PARTNERSHIP", "STRATEGIES", "STRATEGY", "STRATEGIC", "CONSULTING",
    "CONSULTANTS", "COMMUNICATIONS", "COMMUNICATION", "PRODUCTIONS", "PRODUCTION", "ASSOCIATES", "USPS", "POSTMASTER",
    "POSTAL", "PRINTING", "PRINTERS", "MAILING", "MARKETING", "ADVERTISING", "ADVERTISEMENTS", "DIGITAL", "RESEARCH",
    "SOLUTIONS", "SERVICES", "AGENCY", "ENTERPRISES", "INTERNATIONAL", "WORLDWIDE", "NETWORK", "NETWORKS",
    "BROADCASTING", "TELEVISION", "RADIO", "NEWSPAPER", "PUBLISHING", "BANK", "COMMITTEE", "PAC", "PARTY",
    "FUND", "FOUNDATION", "ASSOCIATION", "UNION", "COUNCIL", "INSTITUTE", "COALITION", "FEDERATION", "SOCIETY",
    "CAMPAIGN", "CAMPAIGNS", "POLLING", "ANALYTICS", "TECHNOLOGIES", "TECHNOLOGY", "SYSTEMS",
    "AMERICA", "AMERICANS", "FACEBOOK", "GOOGLE", "META",
    "TWITTER", "YAHOO", "COMCAST", "VERIZON", "UPS", "FEDEX", "STAPLES", "AMAZON", "PAYPAL", "STRIPE", "ACTBLUE",
    "WINRED", "DSCC", "DCCC", "NRCC", "NRSC", "RNC", "DNC", "AFL", "CIO", "AFSCME", "USA", "DBA", "CLUB", "SUITES",
    "INN", "HOTEL", "HOTELS", "MOTEL", "RENTAL", "RENTALS", "APARTMENTS", "AIRLINES", "TRAVEL", "ACTION", "INTERACTIVE",
    "MAILERS", "NEWS", "LISTS", "SOLIDARITY"}
ORG_MARKER_PHRASES = ("FRIENDS OF ", " FOR CONGRESS", " FOR SENATE", " FOR AMERICA", " FOR PRESIDENT")
ORG_MARKER_SUBSTRINGS = (".COM", ".NET", ".ORG", ".IO", ".CO ", "WWW.")


def has_org_marker(name: str | None) -> bool:
    """True when the name carries a clear organisational marker (LLC, INC, MEDIA, GROUP, ".com", ...)."""
    if not name:
        return False
    up = f" {name.upper().strip()} "
    if any(s in up for s in ORG_MARKER_SUBSTRINGS) or any(p in up for p in ORG_MARKER_PHRASES):
        return True
    words = re.sub(r"[^A-Z0-9]+", " ", re.sub(r"[.'\u2019]", "", up)).split()
    return any(w in ORG_MARKER_WORDS for w in words)


def public_payee(name: str | None, entity_type: str | None = None) -> str | None:
    """The payee name as published, or None when it is (or might be) a private individual."""
    if not name or not name.strip():
        return None
    if (entity_type or "").strip().upper() in INDIVIDUAL_ENTITY_TYPES:
        return None
    return " ".join(name.split()) if has_org_marker(name) else None
