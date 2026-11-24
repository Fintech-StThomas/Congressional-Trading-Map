// Unit tests for packet P5 wording: who a /connect step names, buys and sells apart, tie kinds not in the build, the
// kept-not-excluded rows on /method, site terms in coverage notes, the drawer's sentence, and the neutral mark for
// spending against a member. Pure helpers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hopWords, ownersOf } from "../src/lib/domain/hopwords.ts";
import { splitText, tradeSplit } from "../src/lib/domain/tradesplit.ts";
import { exclusionRows, siteTerms, splitExclusions, typesInBuild } from "../src/lib/domain/method-build.ts";
import { PRECISE, CONNECT_WORDS } from "../src/lib/copy-precision.ts";
import { buildEmbedHtml, topTies } from "../src/lib/domain/embed.ts";
import { stringStyle } from "../src/lib/domain/edges.ts";
import { itemTitle } from "../src/lib/domain/feed.ts";

const hop = (o) => ({ type: "traded", via: null, note: null, ...o });

test("connect: a trade is the household's unless every owner is self or joint; a committee is not the member", () => {
  assert.deepEqual(ownersOf("owners: spouse 3, self 2; 1 with a missing date"), [{ owner: "spouse", n: 3 }, { owner: "self", n: 2 }]);
  assert.equal(ownersOf("support"), null);
  assert.deepEqual(ownersOf("annual report 2020; owners self 2"), [{ owner: "self", n: 2 }]);
  assert.equal(hopWords(hop({ type: "owns", note: "x; owners self 2" }), true).after, "", "a self-owned holding is not the household");
  assert.equal(hopWords(hop({ note: "owners: spouse 3, self 2" }), true).after, CONNECT_WORDS.household);
  assert.equal(hopWords(hop({ note: "owners: spouse 3" }), true).after, CONNECT_WORDS.spouse);
  assert.equal(hopWords(hop({ note: "owners: dependent 1" }), true).after, CONNECT_WORDS.dependent);
  assert.equal(hopWords(hop({ note: "owners: self 4, joint 1" }), true).after, "", "self and joint are the member's own");
  assert.equal(hopWords(hop({ note: null }), true).after, CONNECT_WORDS.household, "no owner stated: the household");
  assert.equal(hopWords(hop({ note: "owners: spouse 3, self 2" }), true).owners, "spouse 3, self 2");
  assert.equal(hopWords(hop({ note: "owners: spouse 3" }), false).after, "", "an organisation as subject is left alone");
  const f = hopWords(hop({ type: "funds", via: "Example Leadership PAC" }), true);
  assert.equal(f.before, "a committee of ");
  assert.equal(f.after, " (Example Leadership PAC)");
  assert.equal(hopWords(hop({ type: "funds" }), true).after, "");
  assert.equal(hopWords(hop({ type: "funds", via: "pac:C00344234" }), true).after, " (FEC committee C00344234)");
  assert.equal(hopWords(hop({ type: "pac_money" }), true).before, "");
});

test("buys and sells apart: sums of the disclosed ends, open-ended and missing amounts never become numbers", () => {
  const rows = [
    { action: "buy", org: "co:1", low: 1001, high: 15000 }, { action: "buy", org: "co:1", low: 15001, high: 50000 },
    { action: "sell", org: "co:1", low: 100001, high: 250000 }, { action: "exchange", org: "co:1", low: 1001, high: 15000 },
    { action: "buy", org: "co:2", low: 5, high: 6 }, { action: "sell", org: "co:1", low: null, high: null },
  ];
  const s = tradeSplit(rows, "co:1");
  assert.deepEqual(s.bought, { n: 2, low: 16002, high: 65000 });
  assert.deepEqual(s.sold, { n: 1, low: 100001, high: 250000 });
  assert.deepEqual(s.other, { n: 1, low: 1001, high: 15000 });
  assert.equal(s.undisclosed, 1);
  assert.equal(splitText(s), "Bought $16,002–$65,000 (2 trades) · Sold $100,001–$250,000 (1 trade) · Exchanges and other $1,001–$15,000 (1 trade) · 1 trade has no amount disclosed and is not in these sums");
  // buys + sells + other add up to the combined total (low and high ends)
  const all = rows.filter((r) => r.org === "co:1" && r.low !== null);
  assert.equal(s.bought.low + s.sold.low + s.other.low, all.reduce((n, r) => n + r.low, 0));
  assert.equal(s.bought.high + s.sold.high + s.other.high, all.reduce((n, r) => n + r.high, 0));
  const open = tradeSplit([{ action: "buy", org: "x", low: 50000001, high: null }], "x");
  assert.deepEqual(open.bought, { n: 1, low: 50000001, high: null });
  assert.match(splitText(open), /Bought \$50,000,001 or more/);
  assert.match(splitText(tradeSplit([{ action: "buy", org: "x", low: 1, high: 2 }], "x")), /Sold none \(0 trades\)/, "a side with no trades says none, not $0");
  assert.equal(splitText(tradeSplit([{ action: "exchange", org: "x", low: 1, high: 2 }], "x")), null, "an exchange-only tie shows no buy/sell line");
});

test("embed card: the trade tie says household and bought and sold combined, and shows the two sides", () => {
  const file = {
    edges: [{ id: "e1", type: "traded", family: "holding", basis: "filed", from: { kind: "member", id: "M1" }, to: { kind: "org", id: "co:1" }, directed: true, via: null,
      amount: { low: 27900000, high: 113300000, exact: null }, count: 3, first: "2020-01-01", last: "2021-01-01", by_year: [], evidence: [], evidence_total: 3, stat: null, weak: false, note: null }],
    nodes: { "co:1": { name: "Acme", kind: "company", ticker: "ACME" } },
  };
  const trades = [{ action: "buy", org: "co:1", low: 1001, high: 15000 }, { action: "sell", org: "co:1", low: 15001, high: 50000 }];
  const [t] = topTies(file, "M1", 3, trades);
  assert.equal(t.label, "Household stock trades, bought and sold combined");
  assert.equal(t.amount, "$27,900,000–$113,300,000");
  assert.match(t.detail, /Bought \$1,001–\$15,000/);
  assert.match(t.detail, /Sold \$15,001–\$50,000/);
  assert.equal(topTies(file, "M1")[0].detail, null, "without trade rows no split is claimed");
  const html = buildEmbedHtml({ member: { id: "M1", name: "A B", party: "D", state: "CA", chamber: "rep", district: 1, counts: { trades: 3, orgs: 1, cases: 0 } }, ties: [t], release: null, built: null, theme: "light" });
  assert.match(html, /Household trades/);
  assert.match(html, /Bought \$1,001/);
});

test("feed titles name the owner as filed", () => {
  const m = { id: "M", name: "Nancy P", party: "D", state: "CA" };
  const t = (owner) => ({ owner, action: "buy", partial: null, asset: "Apple", ticker: "AAPL", low: 1001, high: 15000 });
  assert.match(itemTitle(m, t("spouse")), /^Nancy P \(D-CA\), owner spouse: buy Apple/);
  assert.match(itemTitle(m, t("self")), /owner self:/);
  assert.match(itemTitle(m, t("dependent")), /owner dependent child:/);
  assert.match(itemTitle(m, t("unspecified")), /owner not stated:/);
});

test("method: tie kinds with no ties in the build are marked from meta counts; unknown counts mark nothing", () => {
  const s = typesInBuild({ edges_by_type: { traded: 5, pac_money: 3, funds: 0 } });
  assert.ok(s.has("traded") && s.has("pac_money"));
  assert.ok(!s.has("employee_money") && !s.has("funds"));
  assert.equal(typesInBuild({}), null);
  assert.equal(typesInBuild(null), null);
  assert.equal(typesInBuild({ edges_by_type: [] }), null);
});

test("method: kept rows are listed apart from excluded ones; both shapes of meta.exclusions read", () => {
  const ex = {
    failed: { reason: "could not be extracted", rows: 3 },
    amended_rows_without_original: { reason: "kept (rows = kept, not excluded)", rows: 4 },
    same_key_other_filing: { reason: "kept", rows: 2 },
    lag_withheld_date_corrected: { reason: "kept", rows: 1 },
  };
  const { excluded, kept } = splitExclusions(ex);
  assert.deepEqual(excluded.map((r) => r.key), ["failed"]);
  assert.deepEqual(kept.map((r) => r.rows), [4, 2, 1]);
  assert.deepEqual(splitExclusions([{ reason: "old list form", count: 7 }]).excluded, [{ key: "list-0", reason: "old list form", rows: 7 }]);
  assert.deepEqual(exclusionRows(null), []);
  assert.deepEqual(exclusionRows({ k: {} }), [{ key: "k", reason: "K", rows: 0 }]);
});

test("coverage notes from the data are put in the site's terms: no 'late-filed'", () => {
  const out = siteTerms("House trades begin 2014; earlier House years are marked none (a few late-filed earlier trades still appear).");
  assert.doesNotMatch(out, /\blate\b|late-filed/i);
  assert.match(out, /a few earlier trades that were made public later still appear/);
  assert.doesNotMatch(siteTerms("Some late-filed rows"), /late-filed/);
  assert.equal(siteTerms("no change here"), "no change here");
});

test("the drawer's sentence about unlisted records is true for each kind of tie", () => {
  assert.match(PRECISE.drawerMore("outside_spending", 34, "C00553560"), /The other 34 records are in the committee's other FEC filings \(FEC committee C00553560; its FEC page lists its filings\), not listed here/);
  assert.match(PRECISE.drawerMore("traded", 5), /trades in other periodic transaction reports/);
  assert.doesNotMatch(PRECISE.drawerMore("pac_money", 2).concat(PRECISE.drawerMore("pac_money", 2)),/link on each record/);
  assert.doesNotMatch(PRECISE.drawerMore("pac_money", 2) + PRECISE.drawerMore("owns", 2), /same source filings/);
});

test("spending against a member is drawn with no tie mark (neutral), support and trades keep theirs", () => {
  const e = (o) => ({ type: "outside_spending", family: "money", basis: "filed", weak: false, note: "oppose", via: { id: "pac:C00553560:oppose", name: "VIGOP" }, ...o });
  assert.equal(stringStyle(e({})), "against");
  assert.equal(stringStyle(e({ note: "support", via: { id: "pac:C1:support", name: "X" } })), "filed");
  assert.equal(stringStyle({ ...e({}), type: "traded", note: null, via: null }), "filed");
});
