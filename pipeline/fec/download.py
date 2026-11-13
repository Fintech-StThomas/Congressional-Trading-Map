"""Cached downloads of FEC bulk files and other public sources.

Everything lands under pipeline/.cache/fec/. A file already in the cache is
reused; pass refresh=True to fetch again. Downloads go to a temporary name and
are renamed on success, so an interrupted run never leaves a truncated file
that looks complete. A small JSON sidecar (<file>.meta.json) records the URL,
retrieval time, size, sha256 and the server's Last-Modified header so the
assembler can report source revisions in meta.json.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE = REPO_ROOT / "pipeline" / ".cache" / "fec"

FEC_BULK = "https://www.fec.gov/files/bulk-downloads"
USER_AGENT = "congressional-trading-map-class-project research@example.org"


class NotFound(Exception):
    """The source answered 404: the file does not exist for that cycle."""


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, dest: Path, refresh: bool = False, retries: int = 4,
          headers: dict | None = None) -> Path:
    """Download url to dest (cached). Raises NotFound on HTTP 404."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    meta_path = dest.with_name(dest.name + ".meta.json")
    if dest.exists() and meta_path.exists() and not refresh:
        return dest
    tmp = dest.with_name(dest.name + ".part")
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
                last_modified = resp.headers.get("Last-Modified")
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(tmp, dest)
            meta = {
                "url": url,
                "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "last_modified": last_modified,
                "bytes": dest.stat().st_size,
                "sha256": _sha256(dest),
            }
            meta_path.write_text(json.dumps(meta, indent=2) + "\n")
            return dest
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(url) from e
            last_err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last_err = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"download failed after {retries} attempts: {url}: {last_err}")


def source_meta(path: Path) -> dict | None:
    meta_path = path.with_name(path.name + ".meta.json")
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    return None


def bulk_zip(name: str, cycle: int, refresh: bool = False) -> Path:
    """FEC bulk zip, e.g. bulk_zip('pas2', 2024) -> .../2024/pas224.zip."""
    yy = f"{cycle % 100:02d}"
    fname = f"{name}{yy}.zip"
    return fetch(f"{FEC_BULK}/{cycle}/{fname}", CACHE / str(cycle) / fname, refresh)


def leadership_csv(cycle: int, refresh: bool = False) -> Path:
    """Leadership PACs and sponsors file (2010 cycle onward)."""
    fname = f"leadership{cycle}.csv"
    return fetch(f"{FEC_BULK}/data.fec.gov/{fname}", CACHE / str(cycle) / fname, refresh)


def generic(url: str, name: str, refresh: bool = False, headers: dict | None = None) -> Path:
    return fetch(url, CACHE / "ext" / name, refresh, headers=headers)
