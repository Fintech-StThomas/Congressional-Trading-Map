// Unit tests for watchlists without accounts (src/lib/domain/watchlist.ts, watch-storage.ts): parsing and refusing
// bad feed queries, normalising so equivalent URLs are identical, limits, follow/unfollow, boards and feed merging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteFeedUrl, boardWatchlist, emptyWatchlist, follow, isFollowing, mergeItems, mergeWatchlists, normaliseWatchlist, parseWatchlist, unfollow, watchlistFeedHref, WATCH_MEMBERS_MAX, WATCH_ORGS_MAX } from "../src/lib/domain/watchlist.ts";
import { loadWatch, saveWatch, WATCH_KEY } from "../src/lib/domain/watch-storage.ts";

const ids = (n, p = "A") => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(6, "0")}`);

test("parse: ids are validated, deduped and sorted so equivalent URLs are identical", () => {
  const a = parseWatchlist("?m=B000002,A000001,B000002&o=tk%3AZZZ,co%3A123");
  assert.equal(a.ok, true);
  assert.deepEqual(a.list, { members: ["A000001", "B000002"], orgs: ["co:123", "tk:ZZZ"] });
  const b = parseWatchlist("o=co:123,tk:ZZZ&m=A000001,B000002");
  assert.deepEqual(b.list, a.list);
  assert.equal(watchlistFeedHref(a.list), watchlistFeedHref(b.list));
  assert.equal(watchlistFeedHref(a.list), "/feed/w.xml?m=A000001,B000002&o=co%3A123,tk%3AZZZ");
});

test("parse: refuses bad ids, unknown or repeated parameters, empty lists and over-long queries", () => {
  for (const q of ["m=bad", "m=A000001,", "m=,A000001", "o=nope:1", "m=A000001&x=1", "m=A000001&m=B000002", "", "m=", "o=", "m=a000001", `m=${"A".repeat(3000)}`]) {
    assert.equal(parseWatchlist(q).ok, false, q);
  }
  assert.match(parseWatchlist("m=bad").error, /member id/);
});

test("parse: limits of 25 members and 25 organisations are refused, not trimmed", () => {
  assert.equal(parseWatchlist(`m=${ids(WATCH_MEMBERS_MAX).join(",")}`).ok, true);
  assert.equal(parseWatchlist(`m=${ids(WATCH_MEMBERS_MAX + 1).join(",")}`).ok, false);
  const orgs = Array.from({ length: WATCH_ORGS_MAX + 1 }, (_, i) => `co:${i + 1}`);
  assert.equal(parseWatchlist(`o=${orgs.slice(0, WATCH_ORGS_MAX).join(",")}`).ok, true);
  assert.equal(parseWatchlist(`o=${orgs.join(",")}`).ok, false);
  assert.equal(parseWatchlist(new URLSearchParams("m=A000001")).ok, true);
});

test("href: empty is null, ids past the limit are left out, normalised first", () => {
  assert.equal(watchlistFeedHref(emptyWatchlist()), null);
  assert.equal(watchlistFeedHref({ members: ["B000002", "A000001", "A000001", "junk"] }), "/feed/w.xml?m=A000001,B000002");
  assert.equal(watchlistFeedHref({ members: ids(30) }).split("=")[1].split(",").length, WATCH_MEMBERS_MAX);
  assert.equal(absoluteFeedUrl("https://x.test/", "/feed/w.xml?m=A000001"), "https://x.test/feed/w.xml?m=A000001");
});

test("follow / unfollow: idempotent, limited, invalid refused", () => {
  let l = emptyWatchlist();
  const r = follow(l, "member", "K000389");
  assert.equal(r.ok && r.changed, true);
  l = r.list;
  assert.equal(isFollowing(l, "member", "K000389"), true);
  assert.equal(follow(l, "member", "K000389").changed, false);
  assert.deepEqual(follow(l, "org", "nope"), { ok: false, reason: "invalid" });
  assert.deepEqual(unfollow(l, "member", "K000389"), emptyWatchlist());
  const full = { members: ids(WATCH_MEMBERS_MAX), orgs: [] };
  assert.deepEqual(follow(full, "member", "Z000001"), { ok: false, reason: "limit" });
});

test("board to list and merge: members and orgs of every item kind; ids that do not fit are counted", () => {
  const board = { items: [{ member: "A000001" }, { org: "co:1" }, { member: "A000001", org: "co:1" }, { member: "bad" }] };
  assert.deepEqual(boardWatchlist(board), { members: ["A000001"], orgs: ["co:1"] });
  const r = mergeWatchlists({ members: ids(24, "B"), orgs: [] }, { members: ["A000001", "A000002", "A000003"], orgs: ["co:1"] });
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.list.members.length, 25);
  assert.deepEqual(r.list.orgs, ["co:1"]);
});

test("merge items: duplicates once, newest first, at most the limit", () => {
  const it = (guid, pubDate) => ({ title: guid, link: "l", guid, pubDate, description: "d" });
  const out = mergeItems([[it("a", "2026-11-01"), it("b", "2026-11-03")], [it("a", "2026-11-01"), it("c", "2026-11-03T10:00:00Z")]], 3);
  assert.deepEqual(out.map((x) => x.guid), ["b", "c", "a"]);
  assert.equal(mergeItems([Array.from({ length: 150 }, (_, i) => it(`g${i}`, "2026-11-01"))]).length, 100);
});

test("normalise: invalid ids dropped, sorted, deduped", () => {
  assert.deepEqual(normaliseWatchlist({ members: ["B000001", "x", "A000001", "A000001"], orgs: ["tk:A", 5] }), { members: ["A000001", "B000001"], orgs: ["tk:A"] });
  assert.deepEqual(normaliseWatchlist({}), emptyWatchlist());
});

test("storage: round trip, blocked storage, unreadable data", () => {
  const mem = new Map();
  const kv = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  assert.equal(loadWatch(kv).status, "empty");
  assert.equal(saveWatch(kv, { members: ["A000001"], orgs: [] }).ok, true);
  assert.deepEqual(loadWatch(kv), { list: { members: ["A000001"], orgs: [] }, status: "ok" });
  mem.set(WATCH_KEY, "{not json");
  assert.equal(loadWatch(kv).status, "corrupt");
  mem.set(WATCH_KEY, JSON.stringify({ schema: "other", members: [], orgs: [] }));
  assert.equal(loadWatch(kv).status, "corrupt");
  assert.equal(loadWatch(null).status, "unavailable");
  assert.equal(saveWatch(null, emptyWatchlist()).ok, false);
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() {} };
  assert.equal(loadWatch(throwing).status, "unavailable");
  assert.equal(saveWatch(throwing, emptyWatchlist()).ok, false);
});
