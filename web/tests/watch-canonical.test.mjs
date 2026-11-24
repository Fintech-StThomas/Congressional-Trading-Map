// The watchlist feed answers any non-canonical spelling of a valid list with a redirect target (canonicalWatchRedirect),
// and release.ts's listedReleaseIds, the allow-list behind /r/<release id>/... permalinks. Pure: no server, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalWatchRedirect, parseWatchlist, watchlistFeedHref } from "../src/lib/domain/watchlist.ts";
import { listedReleaseIds, releaseIndexUrl } from "../src/lib/data/release.ts";

const CANON = "/feed/w.xml?m=A000001,B000002&o=co%3A123,tk%3AZZZ";

test("the canonical spelling is not redirected", () => {
  assert.equal(canonicalWatchRedirect(CANON.slice(CANON.indexOf("?"))), null);
  assert.equal(canonicalWatchRedirect(CANON.slice(CANON.indexOf("?") + 1)), null);
});

test("any other spelling of the same list points at the one canonical address", () => {
  for (const q of [
    "?m=B000002,A000001&o=co%3A123,tk%3AZZZ",
    "?o=co%3A123,tk%3AZZZ&m=A000001,B000002",
    "?m=A000001,B000002,A000001&o=tk%3AZZZ,co%3A123",
    "?m=A000001%2CB000002&o=co:123,tk:ZZZ",
  ]) assert.equal(canonicalWatchRedirect(q), CANON, q);
});

test("the redirect target is itself canonical and parses to the same list (no loop)", () => {
  const to = canonicalWatchRedirect("?o=tk%3AZZZ&m=B000002,A000001");
  assert.equal(canonicalWatchRedirect(to.slice(to.indexOf("?"))), null);
  assert.deepEqual(parseWatchlist(to.slice(to.indexOf("?"))).list, parseWatchlist("?m=A000001,B000002&o=tk%3AZZZ").list);
  assert.equal(watchlistFeedHref(parseWatchlist(to.slice(to.indexOf("?"))).list), to);
});

test("invalid queries are not redirected (they stay 400)", () => {
  for (const q of ["", "?", "?m=bad", "?m=A000001&x=1", "?m=A000001&m=B000002"]) assert.equal(canonicalWatchRedirect(q), null, q);
});

const id = (n) => n.toString(16).padStart(64, "0");
const entry = (n) => ({ release_id: id(n), build_time: "t", activated_at: "2026-11-16T07:00:00Z" });

test("release list: every listed id is accepted, including the oldest of a full 400-entry list", () => {
  const releases = Array.from({ length: 400 }, (_, i) => entry(400 - i)); // newest first, oldest last
  const ids = listedReleaseIds({ schema_version: 1, releases });
  assert.equal(ids.size, 400);
  assert.ok(ids.has(id(1)) && ids.has(id(400)));
  assert.ok(!ids.has("a".repeat(64)));
});

test("release list: malformed lists throw (fail closed), an empty list lists nothing", () => {
  assert.equal(listedReleaseIds({ schema_version: 1, releases: [] }).size, 0);
  for (const bad of [null, [], "x", {}, { schema_version: 2, releases: [] }, { schema_version: 1 }, { schema_version: 1, releases: [{}] }, { schema_version: 1, releases: [{ release_id: "A".repeat(64) }] }, { schema_version: 1, releases: [null] }])
    assert.throws(() => listedReleaseIds(bad), /release index/, JSON.stringify(bad));
});

test("the release list URL sits beside the pointer", () => {
  assert.equal(releaseIndexUrl("https://w.example/releases"), "https://w.example/releases/index.json");
});
