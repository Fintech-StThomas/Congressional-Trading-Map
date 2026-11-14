"""Cached downloads of FEC bulk files (step 1 of the FEC module: download/cache).

Everything lands under pipeline/.cache/fec/ through the shared `pipeline.util.fetch` (temporary name, rename on
success, retries, a `.meta.json` sidecar with url, retrieval time, size, sha256 and Last-Modified).

Refresh rule (why: the daily workflow restores pipeline/.cache from the previous run, so a file that is never
refetched would freeze FEC money at the day the cache was first saved): files of the current and previous cycle are
refetched after config.FEC_RECENT_CYCLES_MAX_AGE, older cycles after config.FEC_OLDER_CYCLES_MAX_AGE.
PT_CACHE_ONLY=1 reuses whatever is cached (reproducible rebuilds).
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import requests

from ..config import FEC_OLDER_CYCLES_MAX_AGE, FEC_RECENT_CYCLES_MAX_AGE
from ..util import CACHE as PIPELINE_CACHE
from ..util import ROOT, fetch as _fetch

REPO_ROOT = ROOT
CACHE = PIPELINE_CACHE / "fec"
FEC_BULK = "https://www.fec.gov/files/bulk-downloads"


class NotFound(Exception):
    """The source answered 404: the file does not exist for that cycle."""


def current_cycle(today: date | None = None) -> int:
    y = (today or date.today()).year
    return y + (y % 2)


def max_age(cycle: int, today: date | None = None) -> float:
    return FEC_RECENT_CYCLES_MAX_AGE if cycle >= current_cycle(today) - 2 else FEC_OLDER_CYCLES_MAX_AGE


def fetch(url: str, dest: Path, age: float | None = None) -> Path:
    """Download url to dest (cached; `age` None = never refetch). Raises NotFound on HTTP 404."""
    try:
        _fetch(url, dest, max_age=age)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            raise NotFound(url) from e
        raise
    return dest


def source_meta(path: Path) -> dict[str, Any] | None:
    from ..util import read_json
    meta_path = path.with_name(path.name + ".meta.json")
    return read_json(meta_path) if meta_path.exists() else None


def bulk_zip(name: str, cycle: int) -> Path:
    """FEC bulk zip, e.g. bulk_zip('pas2', 2024) -> .../2024/pas224.zip."""
    fname = f"{name}{cycle % 100:02d}.zip"
    return fetch(f"{FEC_BULK}/{cycle}/{fname}", CACHE / str(cycle) / fname, max_age(cycle))


def leadership_csv(cycle: int) -> Path:
    """Leadership PACs and sponsors file (2010 cycle onward)."""
    fname = f"leadership{cycle}.csv"
    return fetch(f"{FEC_BULK}/data.fec.gov/{fname}", CACHE / str(cycle) / fname, max_age(cycle))


def generic(url: str, name: str, headers: dict[str, str] | None = None) -> Path:
    """Fallback reference files (congress-legislators, SEC company names) for a standalone run; refetched daily."""
    from ..config import DAY
    _fetch(url, CACHE / "ext" / name, max_age=DAY, headers=headers)
    return CACHE / "ext" / name
