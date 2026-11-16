"""Exercise the status requirement with representative pull-request file sets."""
import unittest

from scripts.ci.check_status import check


class StatusCheckTests(unittest.TestCase):
    def test_code_requires_status(self):
        for path in ["web/src/app/page.tsx", "pipeline/run.py", "pipeline/crosswalk/org_overrides.csv", ".github/workflows/data.yml", "scripts/ci/check_status.py"]:
            with self.subTest(path=path):
                self.assertFalse(check([path]))
                self.assertTrue(check([path, "STATUS.md"]))

    def test_documentation_only(self):
        for paths in [[], ["README.md"], ["web/README.md", "pipeline/README.md"], ["docs/validation/trade-sample.csv"]]:
            self.assertTrue(check(paths))

    def test_deleted_and_renamed_code_are_still_code(self):
        self.assertFalse(check(["web/src/lib/old.ts", "web/src/lib/new.ts"]))


if __name__ == "__main__":
    unittest.main()
