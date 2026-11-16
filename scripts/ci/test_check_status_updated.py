"""Exercise the status policy against real temporary Git histories, including deletions and diverged bases."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from check_status_updated import check, needs_status


class PolicyTests(unittest.TestCase):
    def test_docs_exemption_and_operational_changes(self):
        self.assertFalse(needs_status(["README.md", "docs/diagram.svg", "web/README.md", "LICENSE"]))
        for path in ["web/src/page.tsx", "pipeline/tests/test_x.py", ".github/workflows/checks.yml",
                     "web/package-lock.json", "web/public/icon.svg", "scripts/ci/check_status_updated.py"]:
            with self.subTest(path=path):
                self.assertTrue(needs_status([path]))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = Path.cwd()
        os.chdir(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(os.chdir, self.old)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Policy test")
        self.git("config", "user.email", "policy@example.invalid")
        self.write("STATUS.md", "Initial status\n")
        self.write("app.py", "initial\n")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", *args], stderr=subprocess.PIPE, text=True)

    def write(self, path, body):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(body)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "test change")

    def test_code_requires_changed_status(self):
        self.write("app.py", "changed\n")
        self.commit()
        self.assertFalse(check(self.base))
        self.write("STATUS.md", "Describes the change\n")
        self.commit()
        self.assertTrue(check(self.base))

    def test_deleted_status_does_not_satisfy_policy(self):
        Path("STATUS.md").unlink()
        self.write("app.py", "changed\n")
        self.commit()
        self.assertFalse(check(self.base))

    def test_deleted_code_still_requires_status(self):
        Path("app.py").unlink()
        self.commit()
        self.assertFalse(check(self.base))

    def test_rename_to_documentation_cannot_bypass_policy(self):
        Path("app.py").rename("app.md")
        self.commit()
        self.assertFalse(check(self.base))

    def test_docs_only_passes(self):
        self.write("docs/plan.md", "Plan\n")
        self.commit()
        self.assertTrue(check(self.base))

    def test_base_only_code_change_is_not_part_of_pr(self):
        self.git("checkout", "-qb", "feature")
        self.write("README.md", "Docs\n")
        self.commit()
        self.git("checkout", "-q", "main")
        self.write("app.py", "base-only change\n")
        self.commit()
        self.git("checkout", "-q", "feature")
        self.assertTrue(check("main"))


if __name__ == "__main__":
    unittest.main()
