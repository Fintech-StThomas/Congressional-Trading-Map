"""Require STATUS.md in a change that edits application, pipeline or automation code."""
from __future__ import annotations

import argparse
import subprocess
from pathlib import PurePosixPath

CODE_ROOTS = ("web/", "pipeline/", "scripts/", ".github/workflows/")
DOC_SUFFIXES = {".md"}


def requires_status(paths: list[str]) -> bool:
    """Documentation-only changes do not require a project-status edit."""
    return any(p.startswith(CODE_ROOTS) and PurePosixPath(p).suffix not in DOC_SUFFIXES for p in paths)


def check(paths: list[str]) -> bool:
    return not requires_status(paths) or "STATUS.md" in paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="base commit/ref (merge-base comparison)")
    parser.add_argument("head", nargs="?", default="HEAD")
    args = parser.parse_args()
    result = subprocess.run(["git", "diff", "--name-only", "-z", f"{args.base}...{args.head}"],
                            check=True, stdout=subprocess.PIPE)
    paths = result.stdout.decode().rstrip("\0").split("\0") if result.stdout else []
    if not check(paths):
        print("Code changed without STATUS.md. Update the shared project status in this pull request.")
        return 1
    print("STATUS.md check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
