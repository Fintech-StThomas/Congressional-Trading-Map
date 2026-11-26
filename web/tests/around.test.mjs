// Unit tests for "Around this trade" (src/lib/domain/around.ts): which rules could not be checked for a trade and why,
// the wording when none was met, PAC money from ledger-only ties (never "none" for a flagged trade), not-counted rows,
// and old releases without flags (nothing shown). No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fecCommitteeUrl, hasFlags, notChecked, notCheckedText, pacEmptyKind, pacTies } from "../src/lib/domain/around.ts";
import { AROUND, RULE_LABEL } from "../src/lib/copy-flags.ts";

const T = { date: "2025-10-30", lag_days: 22, low: 1001, ticker: "UNH", org: "co:731766", action: "sell", asset_class: "stock" };
const ledger = (o) => ({ type: "pac_money", other: "co:731766", otherKind: "org", via: { id: "pac:C00274431", name: "UNITEDHEALTH GROUP PAC" }, exact: 5000, low: 5000, high: 5000, count: 1, first: "2026-08-19", last: "2026-08-19", note: null, dir: "in", ...o });

test("a fully checkable trade lists no rule as not checked; the none-met wording is limited to checkable rules", () => {
  assert.deepEqual(notChecked(T, { fec: true, current: true }), []);
  assert.equal(notCheckedText([]), null);
  assert.match(AROUND.noFlags, /rules that could be checked for it/);
  assert.doesNotMatch(AROUND.noFlags, /five/);
});

test("rules not checked, with the reason visible in the row", () => {
  const undated = notChecked({ ...T, date: null, lag_days: null }, { fec: true, current: true }).map((x) => x.rule);
  assert.deepEqual(undated, ["late", "pile_on", "money_both_ways", "sector_overseen"]);
  const noRange = notChecked({ ...T, low: null }, { fec: true, current: true });
  assert.deepEqual(noRange, [{ rule: "large_amount", reason: AROUND.reasons.noRange }]);
  const noOrg = notChecked({ ...T, org: null, ticker: null }, { fec: false, current: false }).map((x) => x.rule);
  assert.deepEqual(noOrg, ["pile_on", "money_both_ways", "sector_overseen"]);
  const fund = notChecked({ ...T, asset_class: "fund", action: "exchange" }, { fec: true, current: true });
  assert.deepEqual(fund.map((x) => x.rule), ["pile_on", "sector_overseen"]);
  assert.equal(notChecked({ ...T, date: "2024-06-01" }, { fec: true, current: true })[0].reason, AROUND.reasons.beforeRoster);
  const text = notCheckedText(noRange);
  assert.equal(text, `Not checked for this trade: ${RULE_LABEL.large_amount} (no disclosed range).`);
});

test("PAC money: a ledger-only tie is listed for the cycle; a straddling one is marked; other orgs and cycles are not", () => {
  const got = pacTies("co:731766", 2026, [], [ledger()]);
  assert.equal(got.edges.length, 0);
  assert.equal(got.ledger.length, 1);
  assert.equal(got.ledger[0].whole, true);
  assert.equal(got.ledger[0].via, "UNITEDHEALTH GROUP PAC");
  assert.equal(pacTies("co:731766", 2026, [], [ledger({ via: { id: "pac:C00274431", name: "pac:C00274431" } })]).ledger[0].via, "FEC committee C00274431");
  assert.equal(pacTies("co:731766", 2024, [], [ledger()]).ledger.length, 0);
  assert.equal(pacTies("co:1", 2026, [], [ledger()]).ledger.length, 0);
  assert.equal(pacTies("co:731766", 2026, [], [ledger({ dir: "out" })]).ledger.length, 0);
  assert.equal(pacTies("co:731766", 2026, [], [ledger({ first: "2022-01-05" })]).ledger[0].whole, false);
  assert.equal(fecCommitteeUrl("pac:C00274431"), "https://www.fec.gov/data/committee/C00274431/");
  assert.equal(fecCommitteeUrl("co:1"), null);
});

test("the PAC block never says none for a flagged trade; otherwise 'not in this data' with the one-fifth caveat", () => {
  assert.equal(pacEmptyKind(true, false), "flagged");
  assert.equal(pacEmptyKind(true, true), "flagged");
  assert.equal(pacEmptyKind(false, true), "trimmed");
  assert.equal(pacEmptyKind(false, false), "none");
  assert.match(AROUND.pacNone("2025–2026"), /is in this data for the 2025–2026 cycle\. Only about a fifth of PAC dollars/);
  assert.doesNotMatch(AROUND.pacFlagged, /^No /);
});

test("not-counted rows: never checked, and never 'no 8-K'", () => {
  assert.match(AROUND.notCounted, /not counted: a later filing deleted it, so the review-flag rules were not checked/);
  assert.match(AROUND.secNotCounted, /kept only near counted trades/);
  assert.doesNotMatch(AROUND.secNotCounted, /No 8-K was filed/);
});

test("old releases: a trade file without flags hides the Around column and panel", () => {
  assert.equal(hasFlags(null), false);
  assert.equal(hasFlags({ cols: [], rows: [] }), false);
  assert.equal(hasFlags({ flags: [] }), false);
  assert.equal(hasFlags({ flags: {} }), true);
});

test("the panel subtitle never repeats a ticker the filed asset text already carries", async () => {
  const { assetWithTicker } = await import("../src/lib/format.ts");
  assert.equal(assetWithTicker("Eli Lilly and Company Common Stock (LLY)", "LLY"), "Eli Lilly and Company Common Stock (LLY)");
  assert.equal(assetWithTicker("Holding Co (ABC) class B", "XYZ"), "Holding Co (ABC) class B (XYZ)");
  assert.equal(assetWithTicker("Microsoft Corporation", "MSFT"), "Microsoft Corporation (MSFT)");
  assert.equal(assetWithTicker("Treasury note", null), "Treasury note");
});
