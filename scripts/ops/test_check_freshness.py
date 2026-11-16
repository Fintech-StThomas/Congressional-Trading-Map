"""Freshness check with an injected clock and fetcher: fresh, stale, boundary, unreachable, malformed, no URL leaks."""
import io
import os
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from unittest import mock

from scripts.ops import check_freshness as cf

NOW = datetime(2026, 11, 16, 12, 0, 0, tzinfo=timezone.utc)
BASE = "https://secret-bucket.example.com"


def at(hours):
    return (NOW - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(meta, hours=48.0, base=BASE):
    seen = []

    def fetch(url):
        seen.append(url)
        if isinstance(meta, Exception):
            raise meta
        return meta
    return cf.check(base, hours, fetch=fetch, now=lambda: NOW), seen


class CheckTests(unittest.TestCase):
    def test_fresh_and_exactly_at_the_limit_pass(self):
        (ok, message), seen = run({"build": {"time": at(5)}})
        self.assertTrue(ok)
        self.assertIn("5.0 hours", message)
        self.assertEqual(seen, [BASE + "/data/meta.json"])
        self.assertTrue(run({"build": {"time": at(48)}})[0][0])

    def test_older_than_limit_fails_with_age(self):
        (ok, message), _ = run({"build": {"time": at(48.5)}})
        self.assertFalse(ok)
        self.assertIn("48.5 hours old", message)

    def test_future_build_time_is_not_stale(self):
        self.assertTrue(run({"build": {"time": at(-3)}})[0][0])

    def test_unreachable_is_a_failure_and_never_names_the_url(self):
        (ok, message), _ = run(OSError(f"cannot reach {BASE}"))
        self.assertFalse(ok)
        self.assertNotIn("secret-bucket", message)
        self.assertIn("OSError", message)

    def test_malformed_documents_fail(self):
        for meta in ({}, {"build": {}}, {"build": {"time": ""}}, {"build": {"time": "yesterday"}}, [], None, "x"):
            with self.subTest(meta=meta):
                self.assertFalse(run(meta)[0][0])

    def test_offset_and_naive_timestamps(self):
        self.assertTrue(run({"build": {"time": (NOW - timedelta(hours=1)).isoformat()}})[0][0])
        self.assertTrue(run({"build": {"time": (NOW - timedelta(hours=1)).replace(tzinfo=None).isoformat()}})[0][0])

    def test_url_forms(self):
        self.assertEqual(cf.meta_url("https://w.example/"), "https://w.example/data/meta.json")
        self.assertEqual(cf.meta_url("https://w.example/data"), "https://w.example/data/meta.json")
        for bad in ("", "ftp://x", "bucket", "https://a b"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cf.meta_url(bad)


class MainTests(unittest.TestCase):
    def test_variable_wins_over_secret_and_error_line_has_no_url(self):
        env = {"DATA_PUBLIC_URL": "", "R2_PUBLIC_URL": BASE}
        captured = []

        def fake_check(base, hours):
            captured.append(base)
            return False, "the published data could not be fetched or parsed (URLError)"
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(cf, "check", fake_check), redirect_stdout(out):
            self.assertEqual(cf.main([]), 1)
        self.assertEqual(captured, [BASE])  # falls back to the secret, used only as a URL
        self.assertTrue(out.getvalue().startswith("::error::"))
        self.assertNotIn("secret-bucket", out.getvalue())
        with mock.patch.dict(os.environ, {"DATA_PUBLIC_URL": "https://v.example", "R2_PUBLIC_URL": BASE}), \
                mock.patch.object(cf, "check", fake_check), redirect_stdout(io.StringIO()):
            cf.main([])
        self.assertEqual(captured[-1], "https://v.example")

    def test_no_url_at_all_fails_clearly(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"DATA_PUBLIC_URL": "", "R2_PUBLIC_URL": ""}), redirect_stdout(out):
            self.assertEqual(cf.main([]), 1)
        self.assertIn("::error::", out.getvalue())


if __name__ == "__main__":
    unittest.main()
