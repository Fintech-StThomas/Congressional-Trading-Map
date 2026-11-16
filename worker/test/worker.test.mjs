// Worker routes against a fake bucket and fake Cache API: pointers, release files, 304, tombstones, corruption, data
// pass-through, methods and the rule that the bucket is never listed.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createHandler } from "../src/index.js";
import { Lru, parseDescriptor } from "../src/descriptors.js";
import { fakeBucket, fakeCaches } from "./fakes.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const ID = "a".repeat(64);
const META = '{"build":{"time":"t1"}}';
const MEMBER = '{"a":1}';

function descriptor(files, id = ID) {
  return JSON.stringify({ files, release_id: id, schema_version: 1 });
}

function setup(extra = {}) {
  const files = {
    "meta.json": { sha256: sha(META), bytes: META.length },
    "members/A1.json": { sha256: sha(MEMBER), bytes: MEMBER.length },
    "notes.txt": { sha256: sha(MEMBER), bytes: MEMBER.length },
  };
  const bucket = fakeBucket({
    "releases/current.json": '{"release_id":"x"}',
    "releases/index.json": '{"releases":[]}',
    [`releases/${ID}/release.json`]: descriptor(files),
    [`releases/blobs/${sha(META)}`]: META,
    [`releases/blobs/${sha(MEMBER)}`]: { body: MEMBER, type: "application/octet-stream" },
    "data/meta.json": { body: "{}", type: "application/json" },
    "data/members/A1.json": "{}",
    "data/_manifest.json": "{}",
    ...extra,
  });
  const caches = fakeCaches();
  let clock = 1_000_000;
  const handle = createHandler({ caches, now: () => clock });
  const call = (path, init = {}) => handle(new Request(`https://w.example${path}`, init), { BUCKET: bucket });
  return { bucket, caches, call, tick: (ms) => { clock += ms; } };
}

test("pointer and index: bodies, revalidation headers, HEAD without body", async () => {
  const { call } = setup();
  for (const name of ["current", "index"]) {
    const res = await call(`/releases/${name}.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.ok((await res.text()).length > 0);
    const head = await call(`/releases/${name}.json`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});

test("pointer missing is 404", async () => {
  const { call, bucket } = setup();
  bucket.delete("releases/current.json");
  assert.equal((await call("/releases/current.json")).status, 404);
});

test("release file: bytes, type from the path, immutable cache, strong ETag", async () => {
  const { call } = setup();
  const res = await call(`/releases/${ID}/members/A1.json`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), MEMBER);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400, s-maxage=31536000, immutable");
  assert.equal(res.headers.get("etag"), `"${sha(MEMBER)}"`);
  assert.equal(res.headers.get("content-length"), String(MEMBER.length));
  const shared = await call(`/releases/${ID}/notes.txt`);  // same blob, different path type
  assert.equal(shared.headers.get("content-type"), "text/plain");
  assert.equal(await shared.text(), MEMBER);
});

test("HEAD on a release file returns headers and no body", async () => {
  const { call } = setup();
  const res = await call(`/releases/${ID}/meta.json`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("etag"), `"${sha(META)}"`);
  assert.equal(res.headers.get("content-length"), String(META.length));
});

test("If-None-Match gives 304 without reading the blob (strong, weak, list and star)", async () => {
  const { call, bucket } = setup();
  const etag = `"${sha(MEMBER)}"`;
  for (const value of [etag, `W/${etag}`, `"zzz", ${etag}`, "*"]) {
    bucket.calls.length = 0;
    const res = await call(`/releases/${ID}/members/A1.json`, { headers: { "If-None-Match": value } });
    assert.equal(res.status, 304, value);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("etag"), etag);
    assert.ok(!bucket.calls.some(([, key]) => key.startsWith("releases/blobs/")));
  }
  const other = await call(`/releases/${ID}/members/A1.json`, { headers: { "If-None-Match": '"nope"' } });
  assert.equal(other.status, 200);
});

test("path not in the descriptor, unsafe paths and reserved names are 404", async () => {
  const { call } = setup();
  for (const path of ["missing.json", "members/", "release.json", "_manifest.json", "a%2F..%2Fmeta.json",
    "members%5CA1.json", "%E0%A4%A", "meta.json%00"]) {
    assert.equal((await call(`/releases/${ID}/${path}`)).status, 404, path);
  }
});

test("invalid release ids are 404 and never touch the bucket", async () => {
  const { call, bucket } = setup();
  bucket.calls.length = 0;
  for (const id of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "blobs", "withdrawn"]) {
    assert.equal((await call(`/releases/${id}/meta.json`)).status, 404, id);
  }
  assert.equal(bucket.calls.length, 0);
});

test("a release without a descriptor is 404", async () => {
  const { call } = setup();
  assert.equal((await call(`/releases/${"b".repeat(64)}/meta.json`)).status, 404);
});

test("a tombstone makes every file of the release 404, even with the descriptor cached", async () => {
  const { call, bucket, tick } = setup();
  assert.equal((await call(`/releases/${ID}/meta.json`)).status, 200);  // descriptor now cached everywhere
  bucket.set(`releases/withdrawn/${ID}.json`, "{}");
  tick(31_000);  // the "not withdrawn" answer is trusted for 30 seconds
  assert.equal((await call(`/releases/${ID}/meta.json`)).status, 404);
  assert.equal((await call(`/releases/${ID}/meta.json`, { headers: { "If-None-Match": "*" } })).status, 404);
  bucket.delete(`releases/withdrawn/${ID}.json`);
  assert.equal((await call(`/releases/${ID}/meta.json`)).status, 404);  // a withdrawal is remembered
});

test("a missing blob is a short 502 that leaks nothing", async () => {
  const { call, bucket } = setup();
  bucket.delete(`releases/blobs/${sha(MEMBER)}`);
  for (const method of ["GET", "HEAD"]) {
    const res = await call(`/releases/${ID}/members/A1.json`, { method });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("cache-control"), "no-store");
    if (method === "GET") {
      const text = await res.text();
      assert.equal(text, "Release data is unavailable.");
      assert.ok(!text.includes(sha(MEMBER)) && !text.includes("releases/"));
    }
  }
});

test("a blob whose size differs from the descriptor is 502", async () => {
  const { call } = setup({ [`releases/blobs/${sha(META)}`]: { body: META, size: META.length + 1 } });
  assert.equal((await call(`/releases/${ID}/meta.json`)).status, 502);
});

test("a corrupt descriptor is 502", async () => {
  for (const text of ["not json", descriptor({ "meta.json": { sha256: "xyz", bytes: 1 } }),
    descriptor({ "../x": { sha256: sha(META), bytes: 1 } }), descriptor({}, "c".repeat(64))]) {
    const { call: fresh } = setup({ [`releases/${ID}/release.json`]: text });
    assert.equal((await fresh(`/releases/${ID}/meta.json`)).status, 502, text);
  }
});

test("descriptors are cached by release id: second request reads no descriptor", async () => {
  const { call, bucket, caches } = setup();
  await call(`/releases/${ID}/meta.json`);
  await call(`/releases/${ID}/members/A1.json`);
  const reads = bucket.calls.filter(([, key]) => key.endsWith("release.json"));
  assert.equal(reads.length, 1);
  assert.ok(caches.log.some(([op, url]) => op === "put" && url.endsWith(`/__descriptor/${ID}`)));
});

test("the Workers Cache API is used when the in-memory copy is gone", async () => {
  const { bucket, caches } = setup();
  const env = { BUCKET: bucket };
  const first = createHandler({ caches });
  await first(new Request(`https://w.example/releases/${ID}/meta.json`), env);
  bucket.calls.length = 0;
  const second = createHandler({ caches });  // a new isolate: empty memory, shared cache
  const res = await second(new Request(`https://w.example/releases/${ID}/meta.json`), env);
  assert.equal(res.status, 200);
  assert.ok(!bucket.calls.some(([, key]) => key.endsWith("release.json")));
});

test("legacy data pass-through: type, short cache, 404, unsafe paths", async () => {
  const { call } = setup();
  const res = await call("/data/members/A1.json");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal((await call("/data/meta.json", { method: "HEAD" })).status, 200);
  assert.equal((await call("/data/_manifest.json")).status, 200);
  for (const path of ["/data/", "/data/nope.json", "/data/a%2F..%2Fb", "/data/a%5Cb"]) {
    assert.equal((await call(path)).status, 404, path);
  }
});

test("everything else is 404", async () => {
  const { call } = setup();
  for (const path of ["/", "/releases", "/releases/", "/releases/blobs/" + sha(META), `/releases/withdrawn/${ID}.json`,
    `/releases/${ID}`, `/releases/${ID}/`, "/releases/current.json/x", "/other", "/datax/meta.json"]) {
    assert.equal((await call(path)).status, 404, path);
  }
});

test("only GET and HEAD: everything else is 405 with Allow", async () => {
  const { call } = setup();
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const res = await call("/releases/current.json", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
});

test("the bucket is never listed", async () => {
  const { call, bucket } = setup();
  for (const path of ["/releases/current.json", `/releases/${ID}/meta.json`, "/data/meta.json", "/nothing"]) {
    await call(path);
  }
  assert.ok(bucket.calls.every(([op]) => op === "get" || op === "head"));
});

test("unexpected storage errors become a short 502 through the default export", async () => {
  const { default: worker } = await import("../src/index.js");
  const broken = { get: async () => { throw new Error("secret endpoint"); }, head: async () => { throw new Error("secret"); } };
  const res = await worker.fetch(new Request("https://w.example/releases/current.json"), { BUCKET: broken });
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes("secret"));
});

test("Lru keeps the most recently used entries within its bound", () => {
  const lru = new Lru(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a");
  lru.set("c", 3);
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), 1);
  assert.equal(lru.get("c"), 3);
});

test("parseDescriptor rejects wrong ids, schemas and entries", () => {
  assert.ok(parseDescriptor(descriptor({ "meta.json": { sha256: sha(META), bytes: 1 } }), ID));
  assert.equal(parseDescriptor(descriptor({}, "d".repeat(64)), ID), null);
  assert.equal(parseDescriptor('{"files":{},"release_id":"' + ID + '","schema_version":2}', ID), null);
  assert.equal(parseDescriptor(descriptor({ "meta.json": { sha256: sha(META), bytes: -1 } }), ID), null);
  assert.equal(parseDescriptor(descriptor({ "release.json": { sha256: sha(META), bytes: 1 } }), ID), null);
});
