// Unit tests for the release comparison (src/lib/domain/compare.ts, compareRows.ts): each change class, field diffs,
// missing data, holdings documents, release index validation and determinism. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedOrigin, compareEdges, compareHoldings, compareMember, compareTrades, defaultPair, releaseOptionLabel, validateReleaseIndex,
} from "../src/lib/domain/compare.ts";
import { loadMemberSide, loadReleaseIndex } from "../src/lib/data/compareLoad.ts";
import { releaseIndexRewrite } from "../src/lib/data/release.ts";
import { compareCsv, compareTables } from "../src/lib/domain/compareRows.ts";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const T = (id, o = {}) => ({
  id, version: 1, amended: false, date: "2026-01-10", available: "2026-01-20", lag_days: 10, late: false, owner: "self", action: "buy",
  partial: null, ticker: "XMPL", ticker_source: "printed", asset: "Example Inc", asset_class: "stock", low: 1001, high: 15000, org: "co:1", doc: "D1", url: null, ...o,
});
const E = (id, o = {}) => ({
  id, type: "pac_money", family: "money", basis: "filed", from: { kind: "org", id: "co:1" }, to: { kind: "member", id: "M000001" }, directed: true, via: null,
  amount: { low: null, high: null, exact: 500 }, count: 2, first: "2018-01-01", last: "2020-01-01", by_year: [], evidence: [{ label: "x", date: null, url: null, source: "s", record: "r1" }],
  evidence_total: 1, stat: null, weak: false, note: null, ...o,
});

test("trades: every class, exactly one each", () => {
  const a = [T("same"), T("amend"), T("fix"), T("gone")];
  const b = [T("same"), T("amend", { version: 2, amended: true }), T("fix", { high: 50000 }), T("new", { available: "2026-04-01" })];
  const r = compareTrades(a, b, { buildTimeA: "2026-03-01T06:00:00Z" });
  assert.deepEqual(r.counts, { amended_filing: 1, changed_same_version: 1, added: 1, removed: 1 });
  assert.equal(r.unchanged, 1);
  assert.deepEqual(r.total, { a: 4, b: 4 });
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c.cls]));
  assert.deepEqual(by, { amend: "amended_filing", fix: "changed_same_version", new: "added", gone: "removed" });
  assert.equal(r.changes.length, 4, "unchanged records are counted, not listed");
});

test("a higher version is an amended filing; same version with a differing field is not", () => {
  const r = compareTrades([T("x")], [T("x", { version: 2, amended: true, low: 15001, high: 50000 })]);
  assert.equal(r.changes[0].cls, "amended_filing");
  const labels = r.changes[0].fields.map((f) => f.label);
  assert.deepEqual(labels, ["Filing version", "Marked amended", "Amount range"]);
  const fix = compareTrades([T("x")], [T("x", { asset: "Example Incorporated" })]);
  assert.equal(fix.changes[0].cls, "changed_same_version");
});

test("changed fields carry before and after; amounts stay ranges", () => {
  const r = compareTrades([T("x")], [T("x", { low: 15001, high: 50000, ticker: null, available: "2026-02-01" })]);
  const f = Object.fromEntries(r.changes[0].fields.map((x) => [x.field, x]));
  assert.deepEqual(f.amount, { field: "amount", label: "Amount range", before: "$1,001–$15,000", after: "$15,001–$50,000" });
  assert.equal(f.ticker.before, "XMPL");
  assert.equal(f.ticker.after, "not on file");
  assert.equal(f.available.before, "20 Jan 2026");
  assert.equal(f.available.after, "1 Feb 2026");
  assert.ok(!JSON.stringify(r).includes("midpoint"));
});

test("open-ended and missing amounts are not turned into numbers", () => {
  const r = compareTrades([T("x", { high: null })], [T("x", { low: null, high: null })]);
  const f = r.changes[0].fields.find((x) => x.field === "amount");
  assert.equal(f.before, "$1,001 or more");
  assert.equal(f.after, "not disclosed");
});

test("a lower version is not called an amendment", () => {
  const r = compareTrades([T("x", { version: 3 })], [T("x", { version: 2 })]);
  assert.equal(r.changes[0].cls, "changed_same_version");
  assert.equal(r.changes[0].fields[0].before, "3");
});

test("added trades: public after, already public, unknown", () => {
  const build = "2026-03-01T06:00:00Z";
  assert.equal(addedOrigin("2026-03-02", build), "public_after");
  assert.equal(addedOrigin("2026-02-28", build), "public_before");
  assert.equal(addedOrigin("2026-03-01", build), "unknown", "same day cannot be told apart");
  assert.equal(addedOrigin(null, build), "unknown");
  assert.equal(addedOrigin("2026-03-02", null), "unknown");
  assert.equal(addedOrigin("2026-03-02", "not a date"), "unknown");
  const r = compareTrades([], [T("n1", { available: "2026-04-01" }), T("n2", { available: "2026-01-01" }), T("n3", { available: null })], { buildTimeA: build });
  assert.deepEqual(r.origins, { public_after: 1, public_before: 1, unknown: 1 });
  assert.deepEqual(Object.fromEntries(r.changes.map((c) => [c.id, c.origin])), { n1: "public_after", n2: "public_before", n3: "unknown" });
});

test("removed trades say nothing about the member", () => {
  const r = compareTrades([T("x", { action: "sell" })], []);
  assert.equal(r.changes[0].cls, "removed");
  const text = JSON.stringify([compareTables(compareMember("M000001", side({ trades: [T("x")] }), side({})))]);
  assert.match(text, /no longer in the data/);
  assert.doesNotMatch(text, /disposed|sold off|divest/i);
});

test("empty and missing inputs", () => {
  const r = compareTrades([], []);
  assert.deepEqual(r.counts, { amended_filing: 0, changed_same_version: 0, added: 0, removed: 0 });
  assert.equal(r.unchanged, 0);
  assert.deepEqual(compareEdges([], []).counts, { added: 0, removed: 0, changed: 0 });
  const h = compareHoldings(null, null);
  assert.equal(h.presentA, false);
  assert.equal(h.changes.length, 0);
});

test("a repeated id keeps the highest version", () => {
  const r = compareTrades([T("x", { version: 1 }), T("x", { version: 2 })], [T("x", { version: 2 })]);
  assert.equal(r.unchanged, 1);
  assert.equal(r.changes.length, 0);
});

test("edges: added, removed, changed (amount, count, years, evidence ids)", () => {
  const a = [E("e1"), E("e2"), E("e3")];
  const b = [
    E("e1"),
    E("e2", { amount: { low: 1000, high: 5000, exact: null }, count: 3, last: "2021-05-05", evidence: [{ label: "y", date: null, url: null, source: "s", record: "r2" }] }),
    E("e4"),
  ];
  const r = compareEdges(a, b, "M000001");
  assert.deepEqual(r.counts, { added: 1, removed: 1, changed: 1 });
  assert.equal(r.unchanged, 1);
  const ch = r.changes.find((c) => c.kind === "changed");
  assert.equal(ch.other, "co:1");
  assert.deepEqual(ch.fields.map((f) => f.field), ["amount", "count", "last"]);
  assert.equal(ch.fields[0].before, "$500");
  assert.equal(ch.fields[0].after, "$1,000–$5,000");
  assert.deepEqual(ch.evidenceAdded, ["r2"]);
  assert.deepEqual(ch.evidenceRemoved, ["r1"]);
});

test("edges: evidence-only difference is a change; no member id names both ends", () => {
  const r = compareEdges([E("e1")], [E("e1", { evidence: [] })]);
  assert.equal(r.changes[0].kind, "changed");
  assert.equal(r.changes[0].fields.length, 0);
  assert.deepEqual(r.changes[0].evidenceRemoved, ["r1"]);
  assert.equal(r.changes[0].other, "co:1 → M000001");
});

const H = (years, docs = {}) => ({ docs, years });
const Y = (doc, low, high, label = "range") => ({ doc, net_worth: { low, high, high_valued: high, label } });

test("holdings: document change, net worth change, year appears and disappears", () => {
  const a = H({ 2019: Y("d19", 100, 200), 2020: Y("d20", 100, 200), 2021: Y("d21", 100, 200), 2022: Y("d22", 1, 2) },
    { d20: { filed: "2021-05-01", amendment: false }, d21: { filed: "2022-05-01", amendment: false } });
  const b = H({ 2020: Y("d20x", 100, 200), 2021: Y("d21", 300, 400), 2022: Y("d22", 1, 2), 2023: Y("d23", 5, 6) },
    { d20x: { filed: "2021-09-09", amendment: true } });
  const r = compareHoldings(a, b);
  assert.deepEqual(r.counts, { doc_changed: 1, net_worth_changed: 1, year_added: 1, year_removed: 1 });
  assert.equal(r.unchanged, 1);
  assert.deepEqual(r.changes.map((c) => [c.year, c.cls]), [[2023, "year_added"], [2021, "net_worth_changed"], [2020, "doc_changed"], [2019, "year_removed"]]);
  const d = r.changes.find((c) => c.year === 2020);
  assert.equal(d.docInfoA, "filed 1 May 2021");
  assert.equal(d.docInfoB, "filed 9 Sep 2021, an amendment");
  const nw = r.changes.find((c) => c.year === 2021);
  assert.equal(nw.netWorthA, "$100–$200");
  assert.equal(nw.netWorthB, "$300–$400");
  const gone = r.changes.find((c) => c.year === 2019);
  assert.equal(gone.docB, null);
  assert.equal(gone.netWorthB, null, "a missing year has no range, never $0");
});

test("holdings: a file in one release only", () => {
  const r = compareHoldings(null, H({ 2020: Y("d", 1, 2, "at least") }));
  assert.equal(r.presentA, false);
  assert.equal(r.presentB, true);
  assert.equal(r.changes[0].cls, "year_added");
  assert.equal(r.changes[0].netWorthB, "$1–$2 (at least)");
});

function side(o) {
  return { buildTime: "2026-03-01T06:00:00Z", edges: [], trades: [], holdings: null, ...o };
}

test("compareMember: summary, tables and CSV", () => {
  const r = compareMember("M000001",
    side({ trades: [T("a"), T("b")], edges: [E("e1")] }),
    side({ trades: [T("a", { version: 2 }), T("c", { available: "2026-04-01" })], edges: [E("e1", { count: 9 })], holdings: H({ 2020: Y("d", 1, 2) }) }));
  assert.equal(r.summary.changed, 3 + 1 + 1);
  assert.equal(r.summary.trades.added_public_after, 1);
  const tables = compareTables(r);
  assert.deepEqual(tables.map((t) => t.id), ["trades-amended_filing", "trades-added", "trades-removed", "ties-changed", "holdings-years"]);
  for (const t of tables) for (const row of t.rows) assert.equal(row.length, t.cols.length, t.id);
  const csv = compareCsv(r);
  assert.match(csv, /^Section,Change,Record id/);
  assert.equal(csv.split("\r\n").length, 1 + 5 + 1);
  assert.match(csv, /Became public after the earlier release/);
});

test("determinism: input order does not change the output", () => {
  const a = [T("1"), T("2", { date: "2026-02-01" }), T("3")], b = [T("4"), T("5", { date: "2026-02-01" }), T("2", { high: 9 }), T("6", { date: null })];
  const x = compareMember("M000001", side({ trades: a }), side({ trades: b }));
  const y = compareMember("M000001", side({ trades: [...a].reverse() }), side({ trades: [...b].reverse() }));
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.equal(compareCsv(x), compareCsv(y));
});

const entry = (id, over = {}) => ({ release_id: id, build_time: "2026-03-09T06:00:00Z", activated_at: "2026-03-09T07:00:00Z", ...over });

test("release index: accepts the documented shape", () => {
  const list = validateReleaseIndex({ schema_version: 1, releases: [entry(B), entry(A, { build_time: "2026-03-01T06:00:00Z" })] });
  assert.deepEqual(list.map((e) => e.release_id), [B, A]);
  assert.deepEqual(defaultPair(list), { to: B, from: A });
  assert.deepEqual(defaultPair([list[0]]), { to: B, from: null });
  assert.deepEqual(defaultPair([]), { to: null, from: null });
  assert.equal(releaseOptionLabel(list[0]), `9 Mar 2026 · ${B.slice(0, 12)}`);
  assert.deepEqual(validateReleaseIndex({ schema_version: 1, releases: [] }), []);
});

test("release index: everything else is rejected", () => {
  const bad = [
    null, [], "x", 3, {}, { schema_version: 1 }, { releases: [] },
    { schema_version: 2, releases: [] }, { schema_version: "1", releases: [] },
    { schema_version: 1, releases: {} }, { schema_version: 1, releases: [], extra: 1 },
    { schema_version: 1, releases: [null] }, { schema_version: 1, releases: [[]] },
    { schema_version: 1, releases: [entry(A.toUpperCase())] }, { schema_version: 1, releases: [entry("abc")] },
    { schema_version: 1, releases: [{ ...entry(A), extra: 1 }] },
    { schema_version: 1, releases: [{ release_id: A, build_time: "x" }] },
    { schema_version: 1, releases: [entry(A, { build_time: "" })] }, { schema_version: 1, releases: [entry(A, { build_time: "  " })] },
    { schema_version: 1, releases: [entry(A, { build_time: "x".repeat(101) })] }, { schema_version: 1, releases: [entry(A, { build_time: 5 })] },
    { schema_version: 1, releases: [entry(A, { activated_at: "2026-03-09" })] }, { schema_version: 1, releases: [entry(A, { activated_at: "2026-02-31T00:00:00Z" })] },
    { schema_version: 1, releases: [entry(A, { activated_at: "2026-03-09T07:00:00+00:00" })] },
    { schema_version: 1, releases: [entry(A), entry(A)] },
    { schema_version: 1, releases: Array.from({ length: 401 }, (_, i) => entry(i.toString(16).padStart(64, "0"))) },
  ];
  for (const j of bad) assert.throws(() => validateReleaseIndex(j), undefined, JSON.stringify(j)?.slice(0, 80));
  assert.equal(validateReleaseIndex({ schema_version: 1, releases: Array.from({ length: 400 }, (_, i) => entry(i.toString(16).padStart(64, "0"))) }).length, 400);
  void C;
});

// ---------------------------------------------------------------- loading (fake fetch)

const fakeFetch = (files, log = []) => async (url) => {
  log.push(url);
  if (!(url in files)) return { ok: false, status: 404, json: async () => ({}) };
  if (files[url] === "boom") return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => files[url] };
};
const MEMBER = "X000001";
const base = (id) => `/releases/${id}`;

test("loader: one release, only its own URLs; absent trades and holdings mean none", async () => {
  const log = [];
  const files = {
    [`${base(A)}/meta.json`]: { built: "2026-03-01T06:00:00Z" },
    [`${base(A)}/members/${MEMBER}.json`]: { member: { name: "Ada" }, edges: [E("e1")] },
  };
  const r = await loadMemberSide(A, MEMBER, null, fakeFetch(files, log));
  assert.equal(r.status, "ok");
  assert.equal(r.memberName, "Ada");
  assert.equal(r.built, "2026-03-01T06:00:00Z");
  assert.deepEqual(r.side.trades, []);
  assert.equal(r.side.holdings, null);
  assert.equal(r.side.edges.length, 1);
  assert.ok(log.every((u) => u.startsWith(base(A) + "/")), log.join("\n"));
  const withIndexTime = await loadMemberSide(A, MEMBER, "2026-03-02T00:00:00Z", fakeFetch(files));
  assert.equal(withIndexTime.built, "2026-03-02T00:00:00Z");
});

test("loader: a missing meta or member file is unavailable and nothing else is fetched; bad ids fetch nothing", async () => {
  const log = [];
  assert.deepEqual(await loadMemberSide(B, MEMBER, null, fakeFetch({}, log)), { status: "unavailable" });
  assert.deepEqual(log, [`${base(B)}/meta.json`]);
  log.length = 0;
  assert.deepEqual(await loadMemberSide(B, MEMBER, null, fakeFetch({ [`${base(B)}/meta.json`]: {} }, log)), { status: "unavailable" });
  assert.equal(log.length, 2);
  log.length = 0;
  assert.deepEqual(await loadMemberSide("../x", MEMBER, null, fakeFetch({}, log)), { status: "unavailable" });
  assert.deepEqual(await loadMemberSide(A, "nope", null, fakeFetch({}, log)), { status: "unavailable" });
  assert.equal(log.length, 0);
  await assert.rejects(loadMemberSide(A, MEMBER, null, fakeFetch({ [`${base(A)}/meta.json`]: "boom" })));
});

test("loader: the release list", async () => {
  assert.deepEqual(await loadReleaseIndex(fakeFetch({})), []);
  const ok = await loadReleaseIndex(fakeFetch({ "/releases/index.json": { schema_version: 1, releases: [entry(A)] } }));
  assert.equal(ok.length, 1);
  await assert.rejects(loadReleaseIndex(fakeFetch({ "/releases/index.json": { schema_version: 2, releases: [] } })));
  await assert.rejects(loadReleaseIndex(fakeFetch({ "/releases/index.json": "boom" })));
});

test("the index rewrite is exactly /releases/index.json", () => {
  assert.deepEqual(releaseIndexRewrite("https://x/releases"), { source: "/releases/index.json", destination: "https://x/releases/index.json" });
});
