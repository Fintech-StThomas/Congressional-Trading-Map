"""Pinned download of the Hugging Face dataset ZipLime/congress-trading (holdings, liabilities, filings)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import requests

from ..util import CACHE, fetch

DATASET = "ZipLime/congress-trading"
API = f"https://huggingface.co/api/datasets/{DATASET}"
SOURCE_ID = "hf_holdings"
# Only what this stage reads, plus the documentation and the extraction/audit code for the record.
FILES = (
    "README.md", "PIPELINE.md", "manifest.json", "data/quality_report.json",
    "data/holdings/holdings-house.parquet", "data/liabilities/liabilities-house.parquet",
    "data/filings/filings.parquet", "data/reference/legislators.parquet",
    "recipe/house_annual_parser.py", "recipe/step_03_house_annual.py", "recipe/audit_extraction.py",
)


def pinned_revision() -> str:
    """HF_HOLDINGS_REVISION env var if set, else the dataset's current commit SHA."""
    if os.environ.get("HF_HOLDINGS_REVISION"):
        return os.environ["HF_HOLDINGS_REVISION"]
    r = requests.get(API, timeout=60)
    r.raise_for_status()
    return r.json()["sha"]


def download(revision: str) -> tuple[Path, list[dict[str, Any]], list[str]]:
    """Fetch FILES for a revision into the cache (content-addressed by revision, never re-fetched).

    Returns the cache root, per-file metadata (path, bytes, sha256, retrieved) and the full list of
    files the revision contains (so the report shows which holdings/liabilities splits exist)."""
    root = CACHE / "hf" / f"ziplime-{revision}"
    tree = requests.get(f"{API}/revision/{revision}", timeout=60)
    tree.raise_for_status()
    listed = sorted(s["rfilename"] for s in tree.json()["siblings"])
    base = f"https://huggingface.co/datasets/{DATASET}/resolve/{revision}"
    files = []
    for p in FILES:
        if p not in listed:
            raise RuntimeError(f"{p} not in {DATASET}@{revision}")
        meta = fetch(f"{base}/{p}", root / p)
        files.append({"path": p, "bytes": meta["bytes"], "sha256": meta["sha256"], "retrieved": meta["retrieved"]})
    return root, files, listed
