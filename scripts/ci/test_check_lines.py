"""Exercise the line-cap check against small throwaway git repositories."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.ci.check_lines import allow_text, failures, read_allow, tracked_counts


def make_repo(files: dict[str, int], allow: str = "") -> Path:
    root = Path(tempfile.mkdtemp())
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    for name, lines in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("x\n" * lines)
    (root / ".linecap-allow").write_text(allow)
    subprocess.run(["git", "add", "--", *files, ".linecap-allow"], cwd=root, check=True)
    return root


def run_check(files: dict[str, int], allow: str = "") -> list[str]:
    root = make_repo(files, allow)
    return failures(tracked_counts(root), read_allow(root))


class LineCapTests(unittest.TestCase):
    def test_over_cap_fails(self):
        self.assertEqual(run_check({"src/big.py": 301}), ["src/big.py: 301 lines (limit 300)"])

    def test_at_cap_passes(self):
        self.assertEqual(run_check({"src/ok.py": 300}), [])

    def test_allow_listed_passes_at_count_and_fails_above(self):
        allow = "# header\n# header\n350 src/old.py\n"
        self.assertEqual(run_check({"src/old.py": 350}, allow), [])
        self.assertEqual(run_check({"src/old.py": 351}, allow), ["src/old.py: 351 lines (limit 350)"])

    def test_excluded_paths_are_ignored(self):
        files = {".agents/skills/x/run.js": 900, "web/node_modules/a/b.js": 900, "web/fixtures/data/s.md": 900,
                 "web/package-lock.json": 900, "web/app.min.js": 900, "web/data.json": 900}
        self.assertEqual(run_check(files), [])

    def test_allow_file_is_generated_sorted_by_count(self):
        root = make_repo({"a.py": 310, "b.py": 400, "c.py": 20})
        lines = allow_text(tracked_counts(root)).splitlines()
        self.assertEqual(lines[:2], [line for line in lines if line.startswith("#")])
        self.assertEqual(lines[2:], ["400 b.py", "310 a.py"])


if __name__ == "__main__":
    unittest.main()
