// Unit tests for contextual coverage (src/lib/domain/coverage.ts): which facts apply, kept separate, no invented numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageFacts, coverageMeta, edgeFacts, factsFor, tradeValueStats } from "../src/lib/domain/coverage.ts";
import { yearRanges, percentText } from "../src/lib/format.ts";

const meta0 = { built: "2026-11-13T00:00:00Z", pac: null, tradesNoTicker: null, tradesUnresolvedTicker: null };
const base = (over = {}) => ({
  member: { terms: [{ chamber: "rep" }], served: ["2013-01-03", null] },
  coverage: [], tradeSummary: { count: 10, by_owner: { self: 10 } }, edges: [], ledgerTotals: {},
  holdings: null, meta: meta0, tradeValues: null, ...over,
});
const ids = (fs) => fs.map((f) => f.id);

test("a senator with no holdings file gets the explicit Senate gap, not an empty section", () => {
  const f = coverageFacts(base({ member: { terms: [{ chamber: "sen" }], served: ["2013-01-03", null] } }));
  const h = factsFor(f, ["holdings"]);
  assert.deepEqual(ids(h), ["holdings-senate"]);
  assert.match(h[0].text, /no annual-report holdings are in the data for senators/i);
  assert.match(h[0].text, /not a sign that a senator holds nothing/);
});

test("a House member with no file gets a different fact; a former House member now a senator is flagged for senator years", () => {
  assert.deepEqual(ids(factsFor(coverageFacts(base()), ["holdings"])), ["holdings-house-none"]);
  const h = { coverage: [{ year: 2020, status: "used" }] };
  const f = coverageFacts(base({ holdings: h, member: { terms: [{ chamber: "rep" }, { chamber: "sen" }], served: ["2013-01-03", null] } }));
  assert.deepEqual(ids(factsFor(f, ["holdings"])), ["holdings-senate-years"]);
});

test("missing holdings years are grouped by reason as year ranges", () => {
  const h = { coverage: [{ year: 2013, status: "no_annual_report_in_dataset" }, { year: 2014, status: "no_annual_report_in_dataset" }, { year: 2016, status: "no_annual_report_in_dataset" }, { year: 2017, status: "used" }] };
  const [fact] = factsFor(coverageFacts(base({ holdings: h })), ["holdings"]);
  assert.equal(fact.id, "holdings-years");
  assert.match(fact.text, /2013–2014, 2016 \(no annual report in the source\)/);
});

test("partial, none and n/a years become separate year-range facts; n/a only inside service", () => {
  const cov = [
    { year: 2012, trades: "n/a", money: "none" }, { year: 2013, trades: "partial", money: "partial" }, { year: 2014, trades: "partial", money: "full" },
    { year: 2015, trades: "full", money: "full" }, { year: 2016, trades: "none", money: "full" }, { year: 2030, trades: "n/a", money: "full" },
  ];
  const f = coverageFacts(base({ member: { terms: [{ chamber: "rep" }], served: ["2012-01-03", "2020-01-03"] }, coverage: cov }));
  const t = (id) => f.find((x) => x.id === id)?.text;
  assert.match(t("trades-partial"), /2013–2014/);
  assert.match(t("trades-none"), /2016/);
  assert.match(t("trades-na"), /2012/);
  assert.doesNotMatch(t("trades-na"), /2030/);
  assert.match(t("money-partial"), /2013/);
  assert.match(t("money-none"), /2012/);
  assert.match(t("trades-none"), /zero there means no data/);
});

test("freshness is its own fact, with the build date or an honest unknown", () => {
  assert.match(coverageFacts(base()).find((f) => f.id === "fresh").text, /13 Nov 2026/);
  assert.match(coverageFacts(base({ meta: { ...meta0, built: null } })).find((f) => f.id === "fresh").text, /not recorded/);
});

test("owner unspecified and open-ended / undisclosed values are counted, never zeroed", () => {
  const f = coverageFacts(base({ tradeSummary: { count: 1200, by_owner: { self: 1000, unspecified: 200 } }, tradeValues: { total: 1200, openEnded: 3, noValue: 1 } }));
  assert.match(f.find((x) => x.id === "owner-unspecified").text, /200 of 1,200 trades state no owner/);
  assert.match(f.find((x) => x.id === "values-open-ended").text, /3 trades are filed as open-ended/);
  assert.match(f.find((x) => x.id === "values-no-value").text, /1 trades carry no value.*never as \$0/);
  const none = coverageFacts(base({ tradeValues: { total: 5, openEnded: 0, noValue: 0 } }));
  assert.ok(!ids(none).some((i) => i.startsWith("values-")));
});

test("tradeValueStats counts open-ended and valueless rows", () => {
  const t = { cols: ["id", "low", "high"], rows: [["a", 1, 2], ["b", 1000001, null], ["c", null, null], ["d", null, null]] };
  assert.deepEqual(tradeValueStats(t), { total: 4, openEnded: 1, noValue: 2 });
  assert.equal(tradeValueStats(null), null);
  assert.equal(tradeValueStats({ cols: ["id"], rows: [] }), null);
});

test("the PAC share is printed only when meta carries the figures", () => {
  const pacEdge = [{ type: "pac_money", family: "money", basis: "filed" }];
  const without = coverageFacts(base({ edges: pacEdge }));
  assert.ok(!ids(without).includes("orgs-pac-share"));
  assert.ok(!without.some((f) => /\d%/.test(f.text)));
  const m = coverageMeta({ built: "2026-11-13T00:00:00Z", reports: { fec: { pac_money_match: { dollars: 1000, dollars_matched_to_company: 250 } } }, unmatched: { trades_without_ticker: 12, trades_with_unmatched_ticker: 3 } });
  assert.deepEqual(m.pac, { dollars: 1000, matched: 250 });
  const f = coverageFacts(base({ edges: pacEdge, meta: m }));
  assert.match(f.find((x) => x.id === "orgs-pac-share").text, /25% of PAC dollars/);
  assert.match(f.find((x) => x.id === "orgs-ticker").text, /12 trades in this build carry no ticker and 3 carry a ticker that does not resolve/);
  // no PAC ties: no share
  assert.ok(!ids(coverageFacts(base({ edges: [{ type: "traded", family: "holding", basis: "filed" }], meta: m }))).includes("orgs-pac-share"));
});

test("coverageMeta rejects impossible or absent figures", () => {
  assert.equal(coverageMeta({ reports: { fec: { pac_money_match: { dollars: 100, dollars_matched_to_company: 200 } } } }).pac, null);
  assert.equal(coverageMeta({ reports: { fec: { pac_money_match: { dollars: 0, dollars_matched_to_company: 0 } } } }).pac, null);
  assert.equal(coverageMeta({}).pac, null);
  assert.equal(coverageMeta(null).built, null);
});

test("exact match, reviewed match and derivation are separate facts", () => {
  const f = coverageFacts(base({ edges: [{ type: "shared_donors", family: "money", basis: "derived" }, { type: "traded", family: "holding", basis: "filed" }] }));
  for (const id of ["orgs-exact", "orgs-reviewed", "derived-money", "fresh"]) assert.ok(ids(f).includes(id), id);
  assert.equal(new Set(f.map((x) => x.text)).size, f.length);
  assert.doesNotMatch(f.find((x) => x.id === "orgs-exact").text, /reviewed/);
  assert.doesNotMatch(f.find((x) => x.id === "orgs-reviewed").text, /exact/i);
});

test("tie facts: ledger-only, derived, committee, open-ended, no amount", () => {
  const e = (o) => ({ basis: "filed", weak: false, evidence: [{}], evidence_total: 1, amount: { low: 1, high: 2, exact: null }, from: { kind: "org", id: "pac:C00000001" }, to: { kind: "member", id: "M" }, family: "money", ...o });
  assert.deepEqual(ids(edgeFacts(e({}), false)), ["tie-committee"]);
  assert.ok(ids(edgeFacts(e({ evidence: [], evidence_total: 0 }), true)).includes("tie-ledger-only"));
  assert.ok(ids(edgeFacts(e({ basis: "derived", weak: true, evidence_total: 4 }), false)).join().includes("tie-derived"));
  assert.ok(ids(edgeFacts(e({ amount: { low: 5, high: null, exact: null } }), false)).includes("tie-open-ended"));
  assert.ok(ids(edgeFacts(e({ amount: { low: null, high: null, exact: null } }), false)).includes("tie-no-amount"));
});

test("year ranges and percent text", () => {
  assert.equal(yearRanges([2016, 2014, 2013, 2014]), "2013–2014, 2016");
  assert.equal(yearRanges([]), "");
  assert.equal(percentText(0.21), "21%");
  assert.equal(percentText(0.001), "under 1%");
  assert.equal(percentText(0.999), "over 99%");
  assert.equal(percentText(0), "0%");
});
