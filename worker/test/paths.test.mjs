// Path and id validation: the Worker's rules must equal pipeline/release_manifest.py (shared case table).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodePath, isHex64, isSafePath } from "../src/paths.js";
import { contentTypeFor } from "../src/types.js";

const table = JSON.parse(readFileSync(new URL("./path-cases.json", import.meta.url), "utf8"));

test("isSafePath agrees with the shared case table", () => {
  for (const { path, valid } of table.cases) assert.equal(isSafePath(path), valid, JSON.stringify(path));
});

test("isHex64 agrees with the shared id table", () => {
  for (const { id, valid } of table.ids) assert.equal(isHex64(id), valid, id);
  assert.equal(isHex64(undefined), false);
  assert.equal(isHex64(5), false);
});

test("the legacy data tree may serve _manifest.json but never unsafe paths", () => {
  assert.equal(isSafePath("_manifest.json", { allowReserved: true }), true);
  assert.equal(isSafePath("../x", { allowReserved: true }), false);
});

test("decodePath rejects malformed percent-encoding", () => {
  assert.equal(decodePath("a%20b.json"), "a b.json");
  assert.equal(decodePath("%E0%A4%A"), null);
  assert.equal(isSafePath(decodePath("a%2F..%2Fb")), false);
  assert.equal(isSafePath(decodePath("a%5Cb")), false);
  assert.equal(isSafePath(decodePath("a%00b")), false);
});

test("content type follows the extension", () => {
  assert.equal(contentTypeFor("members/A1.json"), "application/json");
  assert.equal(contentTypeFor("feed/trades.xml"), "application/xml");
  assert.equal(contentTypeFor("x/README"), "application/octet-stream");
  assert.equal(contentTypeFor(".json"), "application/octet-stream");
});
