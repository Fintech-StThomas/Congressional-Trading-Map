// Unit tests for the research export (src/lib/domain/export.ts): schema, rows copied unmodified, release vs no release,
// the use notice, hashes of bytes, missing files, and kind handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EXPORT_SCHEMA, buildExport, exportFilename, exportJson, kindPath, normalizeKinds, sha256Hex } from "../src/lib/domain/export.ts";
import { METHOD_VERSION } from "../src/lib/method.ts";
import { USE_NOTICE, SITE } from "../src/lib/copy.ts";

const REL = "ef".repeat(32);
const member = { id: "M000001", name: "Jane Q. Doe" };
const memberFile = {
  member: { id: "M000001" },
  edges: [{ id: "e1", amount: { low: 15001, high: 50000, exact: null }, evidence: [{ label: "x", url: "javascript:alert(1)" }], extra_field: { keep: "me" } }],
  ledger: { cols: ["type"], rows: [["pac_money"]] },
  ledger_totals: { pac_money: { edges: 1 } },
  nodes: {},
};
const tradeFile = { cols: ["id", "low", "high"], rows: [["T1", 1001, 15000], ["T2", null, null]], filings: { D1: "https://x.test/d1.pdf" } };
const fetched = (kind, json) => ({ kind, json, sha256: json ? "a".repeat(64) : null, bytes: json ? 10 : null });
const input = (o = {}) => ({
  member, kinds: ["ties", "trades"], files: [fetched("ties", memberFile), fetched("trades", tradeFile)], release: null, built: "2026-11-13T04:00:00Z",
  exportedAt: "2026-11-16T10:00:00.000Z", sources: [{ id: "ptr", name: "Periodic transaction reports", url: "https://x.test", revision: "r1", retrieved: "2026-11-01" }], ...o,
});

test("schema and the fixed fields", () => {
  const b = buildExport(input());
  assert.equal(b.schema, "paper-trail-export/1");
  assert.equal(EXPORT_SCHEMA, b.schema);
  assert.equal(b.method_version, METHOD_VERSION);
  assert.equal(b.data_build, "2026-11-13T04:00:00Z");
  assert.equal(b.exported_at, "2026-11-16T10:00:00.000Z");
  assert.deepEqual(b.site, { name: SITE.name, url: SITE.url });
  assert.deepEqual(b.query, { member, kinds: ["ties", "trades"], filters: {} });
  for (const k of ["files", "records", "attribution", "notice", "citation", "release"]) assert.ok(k in b, k);
  assert.match(b.attribution, /Paper Trail, data release not recorded, built 13 Nov 2026, retrieved 16 Nov 2026\./);
});

test("rows are exactly the published rows: deep-equal to the input, unsafe URLs and unknown fields untouched", () => {
  const b = buildExport(input());
  assert.deepEqual(b.records.ties.edges, memberFile.edges);
  assert.deepEqual(b.records.ties.ledger, memberFile.ledger);
  assert.deepEqual(b.records.ties.ledger_totals, memberFile.ledger_totals);
  assert.deepEqual(b.records.trades, tradeFile);
  assert.equal(b.records.trades.rows[1][1], null); // a missing amount stays null, never 0
  assert.equal(b.records.ties.edges[0].evidence[0].url, "javascript:alert(1)"); // data is carried verbatim; consumers must treat it as text
  assert.deepEqual(JSON.parse(exportJson(b)).records, JSON.parse(JSON.stringify(b.records)));
});

test("with a release: each file has its data path and the permanent /releases/<id>/<path> URL, and the release id is recorded", () => {
  const b = buildExport(input({ release: REL }));
  assert.equal(b.release, REL);
  assert.equal(b.permanence_note, null);
  assert.deepEqual(b.files.map((f) => f.path), ["members/M000001.json", "trades/M000001.json"]);
  for (const f of b.files) {
    assert.equal(f.permanent_url, `${SITE.url}/releases/${REL}/${f.path}`);
    assert.equal(f.url, f.permanent_url);
    assert.equal(f.sha256.length, 64);
  }
  assert.match(b.attribution, /data release efefefefefef,/);
  assert.equal(b.citation.data.release, REL);
  assert.ok(b.citation.links.permanent);
});

test("without a release: release is null, no permanent URL, the file URL is the latest data's, and the note says so", () => {
  const b = buildExport(input());
  assert.equal(b.release, null);
  for (const f of b.files) {
    assert.equal(f.permanent_url, null);
    assert.ok(f.url.endsWith(`/${f.path}`) && !f.url.includes("/releases/"));
  }
  assert.match(b.permanence_note, /not served from an archived data release/);
  assert.equal(b.citation.links.permanent, null);
  assert.equal(buildExport(input({ release: "not-a-release" })).release, null);
});

test("the use notice (5 U.S.C. 13107(c)), the disclaimer and the hash caveat are present", () => {
  const b = buildExport(input());
  assert.equal(b.notice, USE_NOTICE);
  assert.match(b.notice, /13107\(c\)/);
  assert.equal(b.disclaimer, SITE.disclaimer);
  assert.match(b.hash_note, /identifies the bytes this page downloaded, not whether the filing is accurate/);
  assert.match(b.rows_note, /nothing is recomputed/);
});

test("a kind with no published file is recorded as not published (null, not empty or zero)", () => {
  const b = buildExport(input({ kinds: ["trades", "holdings"], files: [fetched("trades", tradeFile), fetched("holdings", null)] }));
  assert.equal(b.records.holdings, null);
  assert.deepEqual(b.not_published, ["holdings"]);
  const h = b.files.find((f) => f.kind === "holdings");
  assert.equal(h.published, false);
  assert.equal(h.sha256, null);
  assert.equal(b.citation.counts.holdings, null);
  assert.equal(b.citation.counts.trades, 2);
});

test("kinds are canonical and validated; a bad member or no kind throws", () => {
  assert.deepEqual(normalizeKinds(["holdings", "ties", "ties", "bogus"]), ["ties", "holdings"]);
  assert.equal(kindPath("ties", "M000001"), "members/M000001.json");
  assert.equal(kindPath("holdings", "M000001"), "holdings/M000001.json");
  assert.throws(() => buildExport(input({ kinds: ["bogus"] })), /no record kind/);
  assert.throws(() => buildExport(input({ member: { id: "../x", name: "x" } })), /member id/);
});

test("sha256Hex matches node's SHA-256 of the same bytes, and the filename carries member and date", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(tradeFile));
  assert.equal(await sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(await sha256Hex(bytes.buffer), await sha256Hex(bytes));
  assert.equal(exportFilename(buildExport(input())), "paper-trail-export-M000001-2026-11-16.json");
});

test("the citation is the shared packet for the member's full file", () => {
  const c = buildExport(input({ release: REL })).citation;
  assert.equal(c.schema, "paper-trail.citation/1");
  assert.equal(c.kind, "records");
  assert.deepEqual(c.subject.members, [member]);
  assert.equal(c.retrieved, "2026-11-16T10:00:00.000Z");
});
