// Unit tests for citation packets (src/lib/domain/citation.ts): amounts, ledger-only ties, release vs no release,
// assumptions, unsafe URLs and the text rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTieCitation, buildViewCitation, citationFilename, citationJson, citationText, CITATION_SCHEMA, MAX_IDS } from "../src/lib/domain/citation.ts";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/domain/assume.ts";
import { METHOD_VERSION } from "../src/lib/method.ts";
import { SITE } from "../src/lib/copy.ts";

const REL = "ab".repeat(32);
const env = (release = null) => ({
  release, built: "2026-11-13T04:00:00Z", retrieved: "2026-11-16T10:00:00.000Z",
  sources: [{ id: "ptr", name: "House periodic transaction reports", url: "https://clerk.house.gov/x", revision: "r1", retrieved: "2026-11-01" }, { id: "bad", name: "Bad", url: "javascript:alert(1)" }],
});
const edge = (over = {}) => ({
  id: "e1e1e1e1e1e1", type: "traded", family: "holding", basis: "filed",
  from: { kind: "member", id: "M000001" }, to: { kind: "org", id: "co:123" }, directed: true, via: null,
  amount: { low: 15001, high: 50000, exact: null }, count: 3, first: "2021-03-14", last: "2022-04-02",
  by_year: [{ y: 2021, n: 2, low: 15001, high: 50000, exact: null }, { y: 2022, n: 1, low: 1001, high: 15000, exact: null }],
  evidence: [
    { label: "Buy ACME", date: "2021-03-14", url: "https://disclosures-clerk.house.gov/a.pdf", source: "ptr", record: "rec-1" },
    { label: "Sell ACME", date: "2022-04-02", url: "javascript:alert(1)", source: "ptr", record: "rec-2" },
  ],
  evidence_total: 3, stat: null, weak: false, note: null, ...over,
});
const names = { from: "Jane Doe", to: "ACME Corp" };
const tie = (e, extra = {}) => buildTieCitation({ edge: e, names, env: env(), limitations: ["A limit."], ledgerOnly: false, ...extra });

test("a range amount keeps low and high, with no midpoint field", () => {
  const c = tie(edge());
  assert.equal(c.schema, CITATION_SCHEMA);
  assert.deepEqual([c.amount.displayed, c.amount.low, c.amount.high, c.amount.exact], ["$15,001–$50,000", 15001, 50000, null]);
  assert.equal(c.amount.open_ended, false);
  assert.ok(!JSON.stringify(c).toLowerCase().includes("midpoint\":"));
});

test("an open-ended amount stays open-ended, a missing one is not disclosed and never 0", () => {
  const open = tie(edge({ amount: { low: 1000001, high: null, exact: null } }));
  assert.equal(open.amount.open_ended, true);
  assert.equal(open.amount.high, null);
  assert.match(open.amount.displayed, /or more/);
  assert.match(citationText(open), /open-ended disclosed range/);
  const none = tie(edge({ amount: { low: null, high: null, exact: null }, by_year: [] }));
  assert.equal(none.amount.displayed, "not disclosed");
  assert.equal(none.amount.disclosed, false);
  assert.equal(none.amount.low, null);
  assert.match(citationText(none), /Amount as displayed: not disclosed \(no amount disclosed, not zero\)/);
  assert.doesNotMatch(citationText(none), /\$0\b/);
});

test("an exact amount is recorded as exact", () => {
  const c = tie(edge({ amount: { low: null, high: null, exact: 2500 } }));
  assert.equal(c.amount.exact, 2500);
  assert.equal(c.amount.displayed, "$2,500");
});

test("a year window records the filter and the amount within it", () => {
  const c = tie(edge(), { range: [2022, 2022] });
  assert.deepEqual(c.filters.years, [2022, 2022]);
  assert.equal(c.amount_in_years.displayed, "$1,001–$15,000");
  assert.equal(c.amount_in_years.records, 1);
  assert.match(citationText(c), /Within 2022–2022 only/);
  assert.equal(tie(edge(), { range: [2000, 2099] }).filters.years, null);
});

test("unsafe URLs are dropped, safe ones kept; record ids and dates as filed", () => {
  const c = tie(edge());
  assert.deepEqual(c.evidence.map((e) => e.url), ["https://disclosures-clerk.house.gov/a.pdf", null]);
  assert.deepEqual(c.identifiers.evidence_records, ["rec-1", "rec-2"]);
  assert.deepEqual(c.identifiers.edge_ids, ["e1e1e1e1e1e1"]);
  assert.equal(c.identifiers.evidence_total, 3);
  assert.deepEqual(c.dates, { first: "2021-03-14", last: "2022-04-02", evidence: ["2021-03-14", "2022-04-02"] });
  const sources = buildViewCitation({ kind: "records", member: { id: "M000001", name: "Jane Doe" }, env: env(), limitations: [] }).sources;
  assert.equal(sources.find((s) => s.id === "bad").url, null);
  assert.equal(sources.find((s) => s.id === "ptr").url, "https://clerk.house.gov/x");
  assert.doesNotMatch(citationText(c), /javascript:/);
});

test("without a release there is no permanent link and a note says why", () => {
  const c = tie(edge());
  assert.equal(c.data.release, null);
  assert.equal(c.links.permanent, null);
  assert.match(c.permanence_note, /No permanent link/);
  assert.equal(c.links.latest, `${SITE.url}/m/M000001`);
  const text = citationText(c);
  assert.match(text, /No permanent link/);
  assert.match(text, /data release not recorded/);
});

test("with a release the permanent link is absolute, to that release", () => {
  const c = tie(edge(), { env: env(REL) });
  assert.equal(c.data.release, REL);
  assert.equal(c.links.permanent, `${SITE.url}/r/${REL}/m/M000001`);
  assert.equal(c.permanence_note, null);
  const text = citationText(c);
  assert.match(text, new RegExp(`data release ${REL.slice(0, 12)}, built 13 Nov 2026, retrieved 16 Nov 2026`));
  assert.match(text, /Permanent link \(fixed to this data release\)/);
});

test("a malformed release id is treated as unknown, never linked", () => {
  const c = tie(edge(), { env: env("../etc") });
  assert.equal(c.data.release, null);
  assert.equal(c.links.permanent, null);
});

test("a ledger-only tie says so", () => {
  const c = tie(edge({ evidence: [], evidence_total: 0 }), { ledgerOnly: true });
  assert.equal(c.ledger_only, true);
  assert.match(c.ledger_note, /Ledger-only/);
  assert.match(citationText(c), /Ledger-only tie/);
  assert.equal(tie(edge()).ledger_only, false);
  assert.equal(tie(edge()).ledger_note, null);
});

test("a member view records the assumptions and carries them in the links", () => {
  const view = (assumptions) => buildViewCitation({
    kind: "member", member: { id: "M000001", name: "Jane Doe" }, env: env(REL), limitations: ["L1", "L2"], assumptions,
    counts: { trades: 12, ties: 5 }, dates: { first: "2014-01-02", last: "2022-04-02" },
  });
  const dflt = view(DEFAULT_ASSUMPTIONS);
  assert.equal(dflt.filters.assumptions.default, true);
  assert.equal(dflt.links.permanent, `${SITE.url}/r/${REL}/m/M000001`);
  const own = view({ ...DEFAULT_ASSUMPTIONS, family: false, unstated: false, lateOnly: true });
  assert.equal(own.filters.assumptions.param, "own,late");
  assert.equal(own.filters.assumptions.default, false);
  assert.equal(own.links.permanent, `${SITE.url}/r/${REL}/m/M000001?as=own,late`);
  assert.equal(own.links.latest, `${SITE.url}/m/M000001?as=own,late`);
  const text = citationText(own);
  assert.match(text, /Filters: assumptions: own,late/);
  assert.match(text, /Counts: 12 trades, 5 ties/);
  assert.match(text, /Limit: L1\nLimit: L2/);
  assert.equal(own.method_version, METHOD_VERSION);
});

test("a table citation records its filters and row counts, and links to the full file", () => {
  const c = buildViewCitation({
    kind: "table", member: { id: "M000001", name: "Jane Doe" }, env: env(REL), limitations: [],
    table: { title: "Every trade", filters: [{ column: "Owner", value: "spouse" }], shown: 2, total: 40, ids: { trade_ids: ["t1", "t2"], filing_docs: ["d1"] } },
  });
  assert.equal(c.links.permanent, `${SITE.url}/r/${REL}/m/M000001/records`);
  assert.deepEqual(c.filters.table, [{ column: "Owner", value: "spouse" }]);
  assert.equal(c.filters.rows_total, 40);
  assert.deepEqual(c.identifiers.trade_ids, ["t1", "t2"]);
  assert.match(citationText(c), /Filters: Owner contains “spouse”; 2 of 40 rows/);
  assert.equal(citationFilename(c), "paper-trail-citation-M000001-Every-trade.json");
});

test("long id lists are capped and flagged", () => {
  const ids = Array.from({ length: MAX_IDS + 5 }, (_, i) => `t${i}`);
  const c = buildViewCitation({ kind: "table", member: { id: "M", name: "N" }, env: env(), limitations: [], table: { title: "T", filters: [], shown: ids.length, total: ids.length, ids: { trade_ids: ids } } });
  assert.equal(c.identifiers.trade_ids.length, MAX_IDS);
  assert.equal(c.identifiers.truncated, true);
});

test("key order is fixed and the JSON round-trips", () => {
  const a = tie(edge()), b = tie(edge({ evidence_total: 3 }));
  assert.deepEqual(Object.keys(a), Object.keys(buildViewCitation({ kind: "records", member: { id: "M", name: "N" }, env: env(), limitations: [] })));
  assert.equal(citationJson(a), citationJson(b));
  assert.deepEqual(JSON.parse(citationJson(a)), JSON.parse(JSON.stringify(a)));
  assert.equal(Object.keys(a)[0], "schema");
});

test("the text names who, what, source, method and the site disclaimer, and avoids accusation words", () => {
  const text = citationText(tie(edge(), { env: env(REL) }));
  assert.match(text, /^Stock trades: Jane Doe to ACME Corp/);
  assert.match(text, /Subject: Jane Doe \(member M000001\); ACME Corp \(organisation co:123\)/);
  assert.match(text, /Dates as filed: first 14 Mar 2021, latest 2 Apr 2022/);
  assert.match(text, /Source: House periodic transaction reports/);
  assert.match(text, /Official records: https:\/\/disclosures-clerk\.house\.gov\/a\.pdf/);
  assert.match(text, /filed records rec-1, rec-2 \(2 of 3 listed\)/);
  assert.match(text, new RegExp(`Method version: ${METHOD_VERSION}`));
  assert.ok(text.endsWith(SITE.disclaimer));
  assert.doesNotMatch(text, /corrupt|insider/i);
  assert.equal(citationFilename(tie(edge())), "paper-trail-citation-tie-e1e1e1e1e1e1.json");
});
