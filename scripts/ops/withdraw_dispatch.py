"""Turn the `withdraw` inputs of the "Release staging and rollback" workflow into one pipeline.withdraw_release call.

    RELEASE_IDS="<id> <id> ..." REASON=privacy CONFIRM=<first id> EXPOSED_PATHS_FILE=docs/withdrawals/<name>.txt \
        DRY_RUN=1 python -m scripts.ops.withdraw_dispatch        (from the repository root, with the R2_* variables)

The inputs arrive as environment variables only. Every value is checked before anything touches the bucket: each id is
64 lowercase hexadecimal characters, CONFIRM equals the first id (which becomes --release; the others --also-withdraw),
REASON is one of the three words, and EXPOSED_PATHS_FILE is a committed, regular .txt file directly under
docs/withdrawals/ whose lines are release paths (blank lines and # comments allowed). It is a dry run unless DRY_RUN is
exactly "0". A rejected input is never echoed. Exit code 2 for a rejected input, otherwise the command's own.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Callable, Mapping

RELEASE_ID = re.compile(r"[0-9a-f]{64}")
REASONS = ("privacy", "legal", "other")
PATHS_FILE = re.compile(r"docs/withdrawals/[A-Za-z0-9][A-Za-z0-9._-]*\.txt")
RELEASE_PATH = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*(?:/[A-Za-z0-9_-][A-Za-z0-9._-]*)*")
MAX_RELEASES = 100
ROOT = Path(__file__).resolve().parents[2]


class BadInput(ValueError):
    pass


def listed_paths(path: Path) -> list[str]:
    """The release paths in a record file; raises BadInput when a line is not a plain relative path."""
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    paths = [line for line in lines if line and not line.startswith("#")]
    bad = [n for n, line in enumerate(lines, 1) if line and not line.startswith("#") and not RELEASE_PATH.fullmatch(line)]
    if bad:
        raise BadInput(f"the exposed-paths file has a line that is not a release path (line {bad[0]})")
    if not paths or len(set(paths)) != len(paths):
        raise BadInput("the exposed-paths file must list at least one path and no path twice")
    return paths


def build_argv(env: Mapping[str, str], root: Path = ROOT) -> list[str]:
    ids = env.get("RELEASE_IDS", "").split()
    if not ids or len(ids) > MAX_RELEASES or not all(RELEASE_ID.fullmatch(item) for item in ids):
        raise BadInput("release_ids must be 1 to 100 release IDs of 64 lowercase hexadecimal characters, space-separated")
    if len(set(ids)) != len(ids):
        raise BadInput("release_ids names a release twice")
    if env.get("CONFIRM", "").strip() != ids[0]:
        raise BadInput("confirm must equal the first release ID")
    reason = env.get("REASON", "")
    if reason not in REASONS:
        raise BadInput("reason must be privacy, legal or other")
    argv = ["--release", ids[0], "--reason", reason, "--confirm", ids[0]]
    if len(ids) > 1:
        argv += ["--also-withdraw", *ids[1:]]
    name = env.get("EXPOSED_PATHS_FILE", "").strip()
    if name:
        path = root / name
        if not PATHS_FILE.fullmatch(name) or path.is_symlink() or not path.is_file():
            raise BadInput("exposed_paths_file must be a committed .txt file directly under docs/withdrawals/")
        listed_paths(path)
        argv += ["--exposed-paths-file", str(path)]
    if env.get("DRY_RUN", "") != "0":
        argv.append("--dry-run")
    return argv


def main(env: Mapping[str, str] | None = None, run: Callable[[list[str]], int] | None = None) -> int:
    try:
        argv = build_argv(os.environ if env is None else env)
    except (BadInput, OSError, UnicodeDecodeError) as exc:
        print(f"::error::withdraw: {exc if isinstance(exc, BadInput) else 'the exposed-paths file cannot be read'}")
        return 2
    named = sum(1 for item in argv if RELEASE_ID.fullmatch(item)) - 1  # --release and --confirm repeat the first id
    print(f"withdraw: reason {argv[3]}, {named} release(s) named, " + ("DRY RUN" if "--dry-run" in argv else "REAL RUN"),
          flush=True)
    if run is None:
        from pipeline.withdraw_release import main as run
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
