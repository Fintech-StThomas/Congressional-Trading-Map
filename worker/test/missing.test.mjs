// Worker: a made-up release id costs the bucket one descriptor read per window (negative cache), errors are never
// cacheable, and only a 200 carries the immutable policy. Uses the fakes in fakes.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/index.js";
import { MISSING_TTL_MS } from "../src/descriptors.js";
import { fakeBucket, fakeCaches } from "./fakes.mjs";

const GHOST = "b".repeat(64);

function setup() {
  const bucket = fakeBucket({});
  const caches = fakeCaches();
  let clock = 1_000_000;
  const handle = createHandler({ caches, now: () => clock });
  const call = (path) => handle(new Request(`https://w.example${path}`), { BUCKET: bucket });
  return { bucket, caches, call, tick: (ms) => { clock += ms; }, handle, env: { BUCKET: bucket } };
}

const descriptorReads = (bucket) => bucket.calls.filter(([, key]) => key.endsWith("release.json")).length;

test("a missing descriptor is read once per window, whatever the path", async () => {
  const { call, bucket, tick } = setup();
  for (const path of ["meta.json", "members/A1.json", "meta.json", "x/y.json"]) {
    const res = await call(`/releases/${GHOST}/${path}`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(descriptorReads(bucket), 1);
  assert.equal(bucket.calls.filter(([op, key]) => op === "head" && key.includes("withdrawn")).length, 1);
  tick(MISSING_TTL_MS + 1000);
  await call(`/releases/${GHOST}/meta.json`);
  assert.equal(descriptorReads(bucket), 2);
});

test("the negative answer is shared through the Cache API with a new isolate", async () => {
  const { handle, bucket, caches, env } = setup();
  await handle(new Request(`https://w.example/releases/${GHOST}/meta.json`), env);
  assert.ok(caches.log.some(([op, url]) => op === "put" && url.endsWith(`/__missing/${GHOST}`)));
  bucket.calls.length = 0;
  const second = createHandler({ caches });
  assert.equal((await second(new Request(`https://w.example/releases/${GHOST}/meta.json`), env)).status, 404);
  assert.equal(bucket.calls.length, 0);
});

test("only 200 responses are immutable: 404 and 502 are no-store", async () => {
  const { call, bucket } = setup();
  bucket.set(`releases/${"c".repeat(64)}/release.json`, "not json");
  const corrupt = await call(`/releases/${"c".repeat(64)}/meta.json`);
  assert.equal(corrupt.status, 502);
  assert.equal(corrupt.headers.get("cache-control"), "no-store");
  assert.doesNotMatch((await call(`/releases/${GHOST}/meta.json`)).headers.get("cache-control"), /immutable/);
});
