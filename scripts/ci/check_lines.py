"""Enforce the 300-line file cap from AGENTS.md rule 3 (repo rule: split big files so they can be read whole).

Hand-written source and docs are capped at 300 lines. Files already over the cap are listed in `.linecap-allow`
as `<count> <path>`; such a file passes only while its line count is at most its recorded count, so the
counts may only go down. `--write-allow` regenerates that file from the current tree.

Not checked, because the content is not hand-written in this repository:
  .agents/, .claude/skills/   vendored third-party agent skills
  node_modules/               third-party packages
  *lock.json, *.lock, ...     lock files written by package managers
  *.min.*, *.map, *.d.ts      minified or generated output
  web/fixtures/, tests/fixtures/   invented or captured sample data used by tests
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path, PurePosixPath

CAP = 300
SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md", ".yml", ".yaml", ".toml", ".sh", ".sql", ".html"}
SKIP_PREFIXES = (".agents/", ".claude/skills/", "web/fixtures/")
SKIP_PARTS = ("node_modules", "fixtures")
SKIP_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "uv.lock", "Cargo.lock", "skills-lock.json"}
ALLOW_FILE = ".linecap-allow"
ALLOW_HEADER = ("# Files already over the 300-line cap: `<lines> <path>`. A file may not grow past its count.\n"
                "# Counts only go down; remove a line when its file is under 300. Regenerate: check_lines.py --write-allow\n")


def is_checked(path: str) -> bool:
    """True for hand-written text files that the cap applies to."""
    p = PurePosixPath(path)
    if p.suffix not in SUFFIXES or p.name in SKIP_NAMES or p.name.endswith((".min.js", ".min.css", ".d.ts")):
        return False
    return not path.startswith(SKIP_PREFIXES) and not any(part in SKIP_PARTS for part in p.parts)


def line_count(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(1 for _ in handle)


def tracked_counts(root: Path) -> dict[str, int]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, check=True, stdout=subprocess.PIPE).stdout.decode()
    names = [n for n in out.split("\0") if n and is_checked(n) and (root / n).is_file()]
    return {n: line_count(root / n) for n in names}


def read_allow(root: Path) -> dict[str, int]:
    allow: dict[str, int] = {}
    path = root / ALLOW_FILE
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                count, _, name = line.partition(" ")
                allow[name.strip()] = int(count)
    return allow


def failures(counts: dict[str, int], allow: dict[str, int]) -> list[str]:
    return [f"{path}: {n} lines (limit {allow.get(path, CAP)})"
            for path, n in sorted(counts.items()) if n > allow.get(path, CAP)]


def allow_text(counts: dict[str, int]) -> str:
    over = sorted(((n, p) for p, n in counts.items() if n > CAP), key=lambda item: (-item[0], item[1]))
    return ALLOW_HEADER + "".join(f"{n} {p}\n" for n, p in over)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=str(Path(__file__).resolve().parents[2]), help="repository root")
    parser.add_argument("--write-allow", action="store_true", help=f"rewrite {ALLOW_FILE} from the current tree")
    args = parser.parse_args()
    root = Path(args.root)
    counts = tracked_counts(root)
    if args.write_allow:
        (root / ALLOW_FILE).write_text(allow_text(counts), encoding="utf-8")
        print(f"Wrote {ALLOW_FILE}.")
        return 0
    bad = failures(counts, read_allow(root))
    for line in bad:
        print(f"Over the {CAP}-line cap: {line}")
    if bad:
        print("Split the file, or (only for an existing file) keep it at or below its count in .linecap-allow.")
        return 1
    print(f"Line cap check passed ({len(counts)} files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
