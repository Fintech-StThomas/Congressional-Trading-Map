// Unit tests for data freshness (relative age, the 48-hour rule, banner text), the open-tab poll rules, the daily-run
// reader behind /status, and the permalink "since this snapshot" phrases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ageMs, isStale, relativeAgeText, staleBannerText, STALE_AFTER_HOURS } from "../src/lib/domain/freshness.ts";
import { readLatestRun } from "../src/lib/domain/runstatus.ts";
import { differingCounts, readCounts, snapshotParts } from "../src/lib/domain/snapshot.ts";
import { decidePoll, loadLatestRelease, MAX_CHECKS, newerDataPublished, POLL_INTERVAL_MS } from "../src/lib/data/latest.ts";
import { dailyRunApiUrl } from "../src/lib/urls.ts";

const H = 3_600_000;
const BUILT = "2026-11-10T12:00:00Z";
const at = (hours) => Date.parse(BUILT) + hours * H;

test("relative age: minutes, hours, days; never a made-up age", () => {
  assert.equal(relativeAgeText(BUILT, at(0)), "updated just now");
  assert.equal(relativeAgeText(BUILT, at(0.5)), "updated 30 minutes ago");
  assert.equal(relativeAgeText(BUILT, at(1)), "updated 1 hour ago");
  assert.equal(relativeAgeText(BUILT, at(6.9)), "updated 6 hours ago");
  assert.equal(relativeAgeText(BUILT, at(47)), "updated 47 hours ago");
  assert.equal(relativeAgeText(BUILT, at(72)), "updated 3 days ago");
  assert.equal(relativeAgeText(null, at(1)), null);
  assert.equal(relativeAgeText("not a date", at(1)), null);
  // A clock behind the build time reads as zero, not as a negative age.
  assert.equal(ageMs(BUILT, at(-5)), 0);
  assert.equal(relativeAgeText(BUILT, at(-5)), "updated just now");
});

test("stale rule: only strictly over 48 hours, and only when the age is known", () => {
  assert.equal(STALE_AFTER_HOURS, 48);
  assert.equal(isStale(BUILT, at(47.9)), false);
  assert.equal(isStale(BUILT, at(48)), false);
  assert.equal(isStale(BUILT, at(48.1)), true);
  assert.equal(isStale(null, at(500)), false);
  assert.equal(isStale("garbage", at(500)), false);
  assert.equal(staleBannerText(BUILT, at(30)), null);
  assert.equal(staleBannerText(null, at(500)), null);
});

test("stale banner text: date, whole days, the daily update may have failed", () => {
  assert.equal(
    staleBannerText(BUILT, at(24 * 3 + 5)),
    "This data was last updated 10 Nov 2026 (3 days ago). The daily update may have failed; figures may be out of date.",
  );
  assert.match(staleBannerText(BUILT, at(24 * 2 + 1)), /\(2 days ago\)/);
  assert.doesNotMatch(staleBannerText(BUILT, at(24 * 9)), /corrupt|wrongdoing|fraud/i);
});

test("poll rules: 30 minutes apart, never while hidden, 12 checks at most", () => {
  const s = { now: 0, lastCheck: 0, checks: 0, visible: true };
  assert.equal(POLL_INTERVAL_MS, 30 * 60 * 1000);
  assert.equal(decidePoll({ ...s, now: POLL_INTERVAL_MS - 1 }), "wait");
  assert.equal(decidePoll({ ...s, now: POLL_INTERVAL_MS }), "check");
  assert.equal(decidePoll({ ...s, now: POLL_INTERVAL_MS * 5, visible: false }), "wait");
  assert.equal(decidePoll({ ...s, now: POLL_INTERVAL_MS * 99, checks: MAX_CHECKS - 1 }), "check");
  assert.equal(decidePoll({ ...s, now: POLL_INTERVAL_MS * 99, checks: MAX_CHECKS }), "stop");
  assert.equal(MAX_CHECKS, 12);
});

const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json });
const bad = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const ID_A = "a".repeat(64), ID_B = "b".repeat(64);
const pointer = (id) => ({ schema_version: 1, release_id: id, manifest_sha256: "c".repeat(64) });

test("newer data: build time in unpinned mode, release id in pinned mode, never a guess", async () => {
  const meta = (built) => ok({ build: { time: built } });
  assert.equal(await newerDataPublished({ release: null, built: BUILT }, "/data/meta.json", meta(BUILT)), false);
  assert.equal(await newerDataPublished({ release: null, built: BUILT }, "/data/meta.json", meta("2026-11-11T12:00:00Z")), true);
  assert.equal(await newerDataPublished({ release: null, built: BUILT }, "/data/meta.json", ok({})), false, "unreadable build time is not newer");
  let asked = false;
  assert.equal(await newerDataPublished({ release: null, built: null }, "/data/meta.json", async () => { asked = true; return ok({})(); }), false);
  assert.equal(asked, false, "unknown baseline: nothing fetched");
  await assert.rejects(newerDataPublished({ release: null, built: BUILT }, "/data/meta.json", bad(500)));
  assert.equal(await newerDataPublished({ release: ID_A, built: BUILT }, "/data/meta.json", ok(pointer(ID_A))), false);
  assert.equal(await newerDataPublished({ release: ID_A, built: BUILT }, "/data/meta.json", ok(pointer(ID_B))), true);
  assert.equal(await loadLatestRelease(ok(pointer(ID_B))), ID_B);
  await assert.rejects(loadLatestRelease(ok({ release_id: "nope" })));
  await assert.rejects(loadLatestRelease(bad(404)));
});

test("daily run: reads the newest run; anything else is no run; only web links are kept", () => {
  const run = { status: "completed", conclusion: "success", run_started_at: "2026-11-16T06:00:00Z", created_at: "2026-11-16T05:59:00Z", html_url: "https://github.com/o/r/actions/runs/1" };
  assert.deepEqual(readLatestRun({ workflow_runs: [run, { ...run, conclusion: "failure" }] }), { status: "completed", conclusion: "success", when: "2026-11-16T06:00:00Z", url: run.html_url });
  assert.equal(readLatestRun({ workflow_runs: [{ ...run, html_url: "javascript:alert(1)" }] }).url, null);
  assert.equal(readLatestRun({ workflow_runs: [{ status: "in_progress", conclusion: null, created_at: "2026-11-16T06:00:00Z" }] }).conclusion, null);
  for (const junk of [null, {}, { workflow_runs: [] }, { workflow_runs: [null] }, { workflow_runs: [{}] }, "x"]) assert.equal(readLatestRun(junk), null);
  assert.match(dailyRunApiUrl(), /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/actions\/workflows\/data\.yml\/runs\?branch=main&per_page=1$/);
});

const result = (t = {}, e = {}, h = {}) => ({
  summary: {
    trades: { amended_filing: 0, changed_same_version: 0, added: 0, removed: 0, unchanged: 5, ...t },
    edges: { added: 0, removed: 0, changed: 0, unchanged: 3, ...e },
    holdings: { doc_changed: 0, net_worth_changed: 0, year_added: 0, year_removed: 0, unchanged: 2, ...h },
    changed: 0,
  },
});

test("since this snapshot: phrases name each kind of difference; nothing changed is an empty list", () => {
  assert.deepEqual(snapshotParts(result()), []);
  const parts = snapshotParts(result({ amended_filing: 3, removed: 1, added: 1, changed_same_version: 2 }, { changed: 2, removed: 1 }, { doc_changed: 1, year_added: 1 }));
  assert.deepEqual(parts, [
    "3 trades with a newer filing version",
    "2 trades changed in the source data or our extraction",
    "1 trade added to the data",
    "1 trade no longer in the data",
    "2 ties changed",
    "1 tie no longer in the data",
    "2 holdings or net worth years changed",
  ]);
  assert.ok(parts.every((p) => !/sold|sale|wrongdoing/i.test(p)), "a removed record is never a sale");
});

test("header counts: shown only when the latest file has them and they differ", () => {
  const snap = { trades: 186, orgs: 42, members: 5 };
  assert.deepEqual(readCounts({ counts: { trades: 1, orgs: 2, members: 3, cases: 0 } }), { trades: 1, orgs: 2, members: 3 });
  assert.equal(readCounts({ counts: { trades: 1 } }), null);
  assert.equal(readCounts(undefined), null);
  assert.deepEqual(differingCounts(snap, { trades: 188, orgs: 42, members: 4 }), { trades: 188, members: 4 });
  assert.deepEqual(differingCounts(snap, { ...snap }), {});
  assert.deepEqual(differingCounts(snap, null), {}, "an unknown latest count is never shown as a difference");
});

test("the stale banner judges by the build time published now when a cached page is older", async () => {
  const { publishedBuilt, laterBuilt } = await import("../src/lib/data/latest.ts");
  const R = "c".repeat(64);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchPinned = async (u) => (u.endsWith("current.json") ? ok({ schema_version: 1, release_id: R, manifest_sha256: "d".repeat(64) }) : u === `/releases/${R}/meta.json` ? ok({ build: { time: "2026-11-23T19:34:00Z" } }) : { ok: false, status: 404, json: async () => ({}) });
  assert.equal(await publishedBuilt(true, "/data/meta.json", fetchPinned), "2026-11-23T19:34:00Z");
  assert.equal(await publishedBuilt(false, "/data/meta.json", async () => ok({ build: { time: "2026-11-22T00:00:00Z" } })), "2026-11-22T00:00:00Z");
  assert.equal(await publishedBuilt(true, "/data/meta.json", async () => { throw new Error("offline"); }), null);
  assert.equal(laterBuilt("2026-11-18T00:00:00Z", "2026-11-23T19:34:00Z"), "2026-11-23T19:34:00Z");
  assert.equal(laterBuilt("2026-11-23T00:00:00Z", null), "2026-11-23T00:00:00Z");
  assert.equal(laterBuilt(null, null), null);
});
