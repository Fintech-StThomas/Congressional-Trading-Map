"""Write the assembled tree into a staging directory and swap it into web/public/data/.

Why a swap: the site (and anyone serving the folder) must never see a half-written tree. The staging directory is
a sibling of the output, so both renames stay on one filesystem; between them the output path is absent for a moment
but never partial. Files that other stages write beside the assembled tree (config CARRIED_OVER) are moved across.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from ..util import OUT, ROOT

CARRIED_OVER = ("holdings", "holdings-index.json")  # written by the holdings stage, not by the assembler


def staging_dir() -> Path:
    staging = OUT.with_name(OUT.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    return staging


def swap_into_place(staging: Path) -> None:
    old = OUT.with_name(OUT.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if OUT.exists():
        for name in CARRIED_OVER:
            src = OUT / name
            if src.exists() and not (staging / name).exists():
                src.rename(staging / name)
        OUT.rename(old)
    staging.rename(OUT)
    if old.exists():
        shutil.rmtree(old)


def git_commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None
