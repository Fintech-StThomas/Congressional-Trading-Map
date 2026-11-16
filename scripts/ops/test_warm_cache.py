"""URL list building and the never-fail behaviour of the cache warmer."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from scripts.ops import warm_cache


def member(member_id, trades):
    return {"id": member_id, "counts": {"trades": trades, "orgs": 0, "members": 0, "cases": 0}}


class BuildUrlsTests(unittest.TestCase):
    def test_fixed_pages_then_top_ten_members_by_trades(self):
        members = [member(f"M{n:02d}", n) for n in range(1, 16)]
        urls = warm_cache.build_urls("https://site.example/", members)
        self.assertEqual(urls[:6], [f"https://site.example{p}" for p in
                                    ("/", "/wall", "/cases", "/delays", "/orgs", "/feed/trades.xml")])
        self.assertEqual(urls[6:], [f"https://site.example/m/M{n:02d}" for n in range(15, 5, -1)])

    def test_ties_break_by_id_and_zero_or_bad_rows_are_skipped(self):
        members = [member("B", 5), member("A", 5), member("Z", 0), {"id": "../x", "counts": {"trades": 99}},
                   {"id": "C"}, {"id": "D", "counts": {"trades": True}}, "junk", member("E", 7)]
        self.assertEqual(warm_cache.top_member_ids(members), ["E", "A", "B"])

    def test_fewer_than_ten_members_and_non_list_input(self):
        self.assertEqual(len(warm_cache.build_urls("http://localhost:3000", [member("A", 1)])), 7)
        self.assertEqual(len(warm_cache.build_urls("http://localhost:3000", {"not": "a list"})), 6)

    def test_site_url_must_be_http_origin(self):
        for bad in ("", "ftp://x", "site.example", "https://a b", "javascript:alert(1)"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                warm_cache.build_urls(bad, [])


class WarmTests(unittest.TestCase):
    def test_sequential_and_logs_statuses_even_when_fetch_reports_errors(self):
        seen, lines = [], []
        results = warm_cache.warm(["https://s/a", "https://s/b"], fetch=lambda url: (seen.append(url), "503")[1], log=lines.append)
        self.assertEqual(seen, ["https://s/a", "https://s/b"])
        self.assertEqual(results["https://s/b"], "503")
        self.assertEqual(lines, ["503 https://s/a", "503 https://s/b"])

    def test_main_skips_without_site_url_and_never_fails(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(warm_cache.main(["--site-url", ""]), 0)
        self.assertIn("SITE_URL is not set", out.getvalue())

    def test_main_never_fails_on_missing_members_or_bad_url(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(warm_cache.main(["--site-url", "nonsense", "--members", "/nonexistent.json"]), 0)
        self.assertIn("skipped", out.getvalue())

    def test_main_warms_with_injected_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "members.json"
            path.write_text(json.dumps([member("A", 3)]))
            original = warm_cache.fetch_status
            warm_cache.fetch_status = lambda url, timeout=0: "200"
            try:
                out = io.StringIO()
                with redirect_stdout(out):
                    self.assertEqual(warm_cache.main(["--site-url", "http://127.0.0.1:9", "--members", str(path)]), 0)
            finally:
                warm_cache.fetch_status = original
        self.assertIn("200 http://127.0.0.1:9/m/A", out.getvalue())
        self.assertIn("warmed 7 of 7 URLs", out.getvalue())


if __name__ == "__main__":
    unittest.main()
