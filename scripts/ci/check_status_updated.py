"""Require a STATUS.md update for non-documentation changes in a pull request."""
from __future__ import annotations

import argparse
from pathlib import PurePosixPath
import subprocess
import sys


def needs_status(paths: list[str]) -> bool:
    """Documentation-only changes are exempt; code, tests, assets and workflow changes are not."""
    return any(
        path != "STATUS.md"
        and not path.startswith("docs/")
        and PurePosixPath(path).suffix.lower() != ".md"
        and PurePosixPath(path).name not in {"LICENSE", "NOTICE"}
        for path in paths
    )


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def check(base: str, head: str = "HEAD") -> bool:
    """Compare the branch's changes since its merge base, including deleted/renamed code."""
    start = git("merge-base", base, head).decode().strip()
    paths = git("diff", "--no-renames", "--name-only", "-z", start, head, "--").decode().split("\0")
    paths = [path for path in paths if path]
    if not needs_status(paths):
        return True
    updated = git("diff", "--diff-filter=AM", "--name-only", "-z", start, head, "--", "STATUS.md")
    return b"STATUS.md\0" in updated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="base commit SHA or local ref (history must be fetched)")
    parser.add_argument("--head", default="HEAD", help="head commit SHA or local ref")
    args = parser.parse_args(argv)
    try:
        if check(args.base, args.head):
            print("STATUS policy passed: documentation-only change or STATUS.md updated.")
            return 0
    except subprocess.CalledProcessError:
        print("Cannot compare commits. Fetch the base/head history before running this check.", file=sys.stderr)
        return 2
    print("Update STATUS.md to describe the code, test, asset or workflow changes in this PR.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
