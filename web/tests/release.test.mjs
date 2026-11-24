// Release-pinned data (lib/data/release.ts, pin.ts, recent.ts) and the URL helpers that depend on it
// (lib/urls.ts dataUrl / routeDataUrl, the permalink hrefs). Pure: no server, no network.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_ID,
  RELEASE_ID_PATTERN,
  isReleaseId,
  isReleasePath,
  isSafeRel,
  parsePointer,
  releaseBase,
  releaseFileUrl,
  releasePointerUrl,
  releaseRewrite,
} from "../src/lib/data/release.ts";
import { clientRelease, setClientRelease } from "../src/lib/data/pin.ts";
import { RecentStore } from "../src/lib/data/recent.ts";
import { REVALIDATE_SECONDS } from "../src/lib/data/remote.ts";
import { dataUrl, releaseMemberHref, releaseRecordsHref, routeDataUrl } from "../src/lib/urls.ts";
import { releaseShort } from "../src/lib/format.ts";

const A = "a".repeat(64);
const B = "0123456789abcdef".repeat(4);
const BASE = "https://pub-x.r2.dev/releases";

afterEach(() => setClientRelease(null));

test("release ids: 64 lowercase hex only", () => {
  assert.ok(isReleaseId(A) && isReleaseId(B));
  for (const bad of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), `${A}\n`, ` ${A}`, `../${"a".repeat(61)}`, `${"a".repeat(32)}/../x`, null, 7, undefined])
    assert.ok(!isReleaseId(bad), String(bad));
  assert.ok(RELEASE_ID.test(A));
  assert.ok(new RegExp(`^(?:${RELEASE_ID_PATTERN})$`).test(A) && !new RegExp(`^(?:${RELEASE_ID_PATTERN})$`).test(`${A}0`));
});

test("release base: same rules as DATA_BASE_URL, named in the error", () => {
  assert.equal(releaseBase(undefined), null);
  assert.equal(releaseBase("  "), null);
  assert.equal(releaseBase(`${BASE}/`), BASE);
  assert.equal(releaseBase(` ${BASE}// `), BASE);
  assert.throws(() => releaseBase("not a url"), /RELEASE_BASE_URL is not a URL/);
  assert.throws(() => releaseBase("ftp://x/releases"), /RELEASE_BASE_URL must be http\(s\)/);
  assert.throws(() => releaseBase(`${BASE}?x=1`), /RELEASE_BASE_URL must not carry a query or fragment/);
  assert.throws(() => releaseBase(`${BASE}#top`), /RELEASE_BASE_URL must not carry/);
});

test("URL builders: pointer, release files, unsafe input refused", () => {
  assert.equal(releasePointerUrl(BASE), `${BASE}/current.json`);
  assert.equal(releaseFileUrl(BASE, A, "members/X000001.json"), `${BASE}/${A}/members/X000001.json`);
  assert.equal(releaseFileUrl(BASE, A, "holdings/positions/X000001.json"), `${BASE}/${A}/holdings/positions/X000001.json`);
  assert.throws(() => releaseFileUrl(BASE, "current", "meta.json"), /not a release id/);
  assert.throws(() => releaseFileUrl(BASE, A.toUpperCase(), "meta.json"), /not a release id/);
  for (const rel of ["../current.json", "members/../../x", "/meta.json", "a//b", "a\\b", "a:b", "a?b", "a#b", "a%2e%2e/b", "", ".", "..", "a/./b", "a b"])
    assert.throws(() => releaseFileUrl(BASE, A, rel), /not a safe data path/, JSON.stringify(rel));
  assert.ok(isSafeRel("orgs/ab.json") && !isSafeRel("orgs/../ab.json"));
});

test("pointer: strict, fails closed", () => {
  const ok = { schema_version: 1, release_id: A, manifest_sha256: B };
  assert.deepEqual(parsePointer(ok), { release_id: A, manifest_sha256: B });
  const bad = [
    null, [], "x", 1,
    { ...ok, schema_version: 2 },
    { ...ok, schema_version: "1" },
    { ...ok, extra: 1 },
    { schema_version: 1, release_id: A },
    { schema_version: 1, manifest_sha256: B },
    { ...ok, release_id: A.toUpperCase() },
    { ...ok, release_id: "../" + "a".repeat(61) },
    { ...ok, release_id: `${A}/x` },
    { ...ok, manifest_sha256: "abc" },
    { ...ok, manifest_sha256: null },
  ];
  for (const b of bad) assert.throws(() => parsePointer(b), Error, JSON.stringify(b));
});

test("next.config rewrite: /releases/<64 hex>/... to the bucket", () => {
  const r = releaseRewrite(BASE);
  assert.equal(r.source, `/releases/:id(${RELEASE_ID_PATTERN})/:path*`);
  assert.equal(r.destination, `${BASE}/:id/:path*`);
  assert.match(r.source, /\{64\}/);
});

test("permalink paths are recognised for the footer", () => {
  assert.ok(isReleasePath(`/r/${A}/m/X000001`) && isReleasePath(`/r/${A}`) && isReleasePath(`/r/${A}/`));
  for (const p of ["/m/X000001", "/r/short/m/X1", `/r/${A}x/m/X1`, `/x/r/${A}`, "", null, undefined]) assert.ok(!isReleasePath(p), String(p));
});

test("client release: dataUrl and routeDataUrl with and without a pin", () => {
  assert.equal(clientRelease(), null);
  assert.equal(dataUrl("members/X000001.json"), "/data/members/X000001.json");
  assert.equal(routeDataUrl("board-data/CA"), "/board-data/CA");
  assert.equal(routeDataUrl("search-index"), "/search-index");
  setClientRelease(A);
  assert.equal(clientRelease(), A);
  assert.equal(dataUrl("members/X000001.json"), `/releases/${A}/members/X000001.json`);
  assert.equal(dataUrl("wall.json"), `/releases/${A}/wall.json`);
  assert.equal(routeDataUrl("board-data/CA"), `/r/${A}/board-data/CA`);
  assert.equal(routeDataUrl("board-member/X000001"), `/r/${A}/board-member/X000001`);
  assert.equal(routeDataUrl("search-index"), `/r/${A}/search-index`);
  setClientRelease(B);
  assert.equal(dataUrl("meta.json"), `/releases/${B}/meta.json`);
  setClientRelease(null);
  assert.equal(dataUrl("meta.json"), "/data/meta.json");
  assert.throws(() => setClientRelease("latest"), TypeError);
  assert.throws(() => setClientRelease(A.toUpperCase()), TypeError);
  assert.equal(clientRelease(), null);
});

test("permalink hrefs and the short id", () => {
  assert.equal(releaseMemberHref(A, "X000001"), `/r/${A}/m/X000001`);
  assert.equal(releaseRecordsHref(A, "X000001"), `/r/${A}/m/X000001/records`);
  assert.equal(releaseShort(B), "0123456789ab");
});

test("in-memory store keeps the 3 most recently used releases", () => {
  const s = new RecentStore(3);
  const ids = ["1", "2", "3", "4"];
  for (const id of ids.slice(0, 3)) s.set(id, "orgs.json", `orgs-${id}`);
  assert.deepEqual(s.held(), ["1", "2", "3"]);
  assert.equal(s.get("1", "orgs.json"), "orgs-1"); // touching 1 makes 2 the oldest
  s.set("4", "orgs.json", "orgs-4");
  assert.deepEqual(s.held(), ["3", "1", "4"]);
  assert.equal(s.get("2", "orgs.json"), undefined); // dropped; reading it re-creates an empty slot, not the data
  assert.equal(s.get("4", "orgs.json"), "orgs-4");
  assert.equal(s.held().length, 3);
});

test("revalidation period defaults to one hour", () => {
  if (!process.env.PT_REVALIDATE_SECONDS) assert.equal(REVALIDATE_SECONDS, 3600);
});

test("hosted builds treat RELEASE_BASE_URL as real data, like DATA_BASE_URL", async () => {
  const { sampleFallbackError } = await import("../src/lib/data/source.ts");
  assert.match(sampleFallbackError({ VERCEL: "1" }, false), /neither DATA_BASE_URL nor RELEASE_BASE_URL/);
  assert.equal(sampleFallbackError({ VERCEL: "1", RELEASE_BASE_URL: BASE }, false), null);
  assert.equal(sampleFallbackError({ CI: "1", RELEASE_BASE_URL: " " }, false) === null, false);
});

test("the release pointer refreshes within five minutes, never slower than the data", async () => {
  const { POINTER_REVALIDATE_SECONDS, REVALIDATE_SECONDS } = await import("../src/lib/data/remote.ts");
  assert.ok(POINTER_REVALIDATE_SECONDS <= 300 && POINTER_REVALIDATE_SECONDS <= REVALIDATE_SECONDS);
});
