"""Input checks of the workflow's withdraw action, and the committed exposed-path records (paths only)."""
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from scripts.ops import withdraw_dispatch as wd

A, B, C = "a" * 64, "b" * 64, "c" * 64


class BuildArgvTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "docs" / "withdrawals").mkdir(parents=True)
        self.listing = self.root / "docs" / "withdrawals" / "2026-01-01.txt"
        self.listing.write_text("# record\nholdings/X000001.json\nholdings/positions/X000001.json\n")

    def env(self, **over):
        return {"RELEASE_IDS": f"{A}  {B}\n{C}", "REASON": "privacy", "CONFIRM": A, "DRY_RUN": "0",
                "EXPOSED_PATHS_FILE": "docs/withdrawals/2026-01-01.txt", **over}

    def test_first_id_is_the_release_and_the_rest_are_also_withdrawn(self):
        self.assertEqual(wd.build_argv(self.env(), self.root), [
            "--release", A, "--reason", "privacy", "--confirm", A, "--also-withdraw", B, C,
            "--exposed-paths-file", str(self.listing)])
        self.assertEqual(wd.build_argv(self.env(RELEASE_IDS=A, EXPOSED_PATHS_FILE=""), self.root),
                         ["--release", A, "--reason", "privacy", "--confirm", A])

    def test_dry_run_unless_exactly_zero(self):
        for value in ("1", "", "false", "no", " 0"):
            self.assertEqual(wd.build_argv(self.env(DRY_RUN=value), self.root)[-1], "--dry-run")
        env = self.env()
        del env["DRY_RUN"]
        self.assertEqual(wd.build_argv(env, self.root)[-1], "--dry-run")

    def test_rejected_inputs(self):
        (self.root / "docs" / "withdrawals" / "bad.txt").write_text("holdings/X.json\n12 Some Street\n")
        (self.root / "docs" / "withdrawals" / "twice.txt").write_text("a.json\na.json\n")
        (self.root / "docs" / "withdrawals" / "none.txt").write_text("# nothing\n")
        (self.root / "docs" / "withdrawals" / "link.txt").symlink_to(self.listing)
        (self.root / "outside.txt").write_text("a.json\n")
        bad = [{"RELEASE_IDS": ""}, {"RELEASE_IDS": A.upper()}, {"RELEASE_IDS": A[:-1]}, {"RELEASE_IDS": f"{A} {A}"},
               {"RELEASE_IDS": f"{A} --release"}, {"RELEASE_IDS": f"{A};id"}, {"RELEASE_IDS": " ".join([A] * 101)},
               {"CONFIRM": B}, {"CONFIRM": ""}, {"REASON": "because"}, {"REASON": ""},
               *({"EXPOSED_PATHS_FILE": name} for name in (
                   "docs/withdrawals/missing.txt", "docs/withdrawals/../../outside.txt", "outside.txt",
                   "/etc/passwd", "docs/withdrawals/bad.txt", "docs/withdrawals/twice.txt", "docs/withdrawals/none.txt",
                   "docs/withdrawals/link.txt", "docs/withdrawals/sub/x.txt", "docs/withdrawals/2026-01-01.md"))]
        for over in bad:
            with self.subTest(over=str(over)[:60]), self.assertRaises(wd.BadInput):
                wd.build_argv(self.env(**over), self.root)

    def test_main_rejects_without_calling_the_command_or_echoing_input(self):
        calls, out = [], io.StringIO()
        with redirect_stdout(out):
            code = wd.main(self.env(RELEASE_IDS="$(evil) `x`", CONFIRM="$(evil)"), calls.append)
        self.assertEqual((code, calls), (2, []))
        self.assertTrue(out.getvalue().startswith("::error::withdraw: "))
        self.assertNotIn("evil", out.getvalue())

    def test_main_passes_the_command_result_through(self):
        calls, out = [], io.StringIO()
        with redirect_stdout(out):
            code = wd.main(self.env(RELEASE_IDS=A, EXPOSED_PATHS_FILE="", DRY_RUN="1"), lambda argv: calls.append(argv) or 7)
        self.assertEqual(code, 7)
        self.assertEqual(calls, [["--release", A, "--reason", "privacy", "--confirm", A, "--dry-run"]])
        self.assertEqual(out.getvalue(), "withdraw: reason privacy, 1 release(s) named, DRY RUN\n")


class CommittedRecordsTests(unittest.TestCase):
    def test_every_committed_listing_holds_release_paths_only(self):
        listings = sorted((wd.ROOT / "docs" / "withdrawals").glob("*.txt"))
        self.assertTrue(listings)
        for path in listings:
            with self.subTest(path=path.name):
                self.assertTrue(wd.PATHS_FILE.fullmatch(f"docs/withdrawals/{path.name}"))
                for line in wd.listed_paths(path):
                    self.assertRegex(line, r"^holdings/(positions/)?[A-Z]\d{6}\.json$")


if __name__ == "__main__":
    unittest.main()
