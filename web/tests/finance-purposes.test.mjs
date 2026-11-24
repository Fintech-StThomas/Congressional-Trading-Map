// Unit tests for lib/domain/finance-purposes.ts: the three states of a PAC-year's FEC purpose groups (null, [], rows),
// shares over published totals only, a negative figure shown as not published, order kept as given, label mapping,
// the sponsor-link phrases, the fold rule and the full file's purpose table.
import test from "node:test";
import assert from "node:assert/strict";
import { purposeLabel, purposesState, purposeRows, purposesTotal, purposeText, sponsorLinkText, foldCategories, purposeTableRows, PURPOSE_COLS } from "../src/lib/domain/finance-purposes.ts";

const p = (purpose, total, count = 1) => ({ purpose, total, count });
const year = (purposes, over = {}) => ({
  committee_id: "C00000001", committee_name: "PAC", cycle: 2024, sponsor_link: "fec_candidate_id", total: 100, count: 3, refunds: 0, refund_count: 0,
  categories: [{ category: null, label: "x", total: 100, count: 3, refunds: 0, refund_count: 0 }], purposes, ...over,
});

test("state: null is unavailable, [] is none, groups are rows; a missing field reads as unavailable", () => {
  assert.equal(purposesState(year(null)), "unavailable");
  assert.equal(purposesState(year(undefined)), "unavailable");
  assert.equal(purposesState(year([])), "none");
  assert.equal(purposesState(year([p("OTHER", 5)])), "rows");
  assert.deepEqual(purposeRows(year(null)), []);
  assert.equal(purposesTotal(year([])), null);
});

test("rows keep the given order and shares use published totals only", () => {
  const rows = purposeRows(year([p("OTHER", 600, 4), p("CONTRIBUTIONS", 300, 2), p("REFUNDS", 100, 1), p("TRANSFERS", null, 1)]));
  assert.deepEqual(rows.map((r) => r.purpose), ["OTHER", "CONTRIBUTIONS", "REFUNDS", "TRANSFERS"]);
  assert.deepEqual(rows.map((r) => r.share), [0.6, 0.3, 0.1, null]);
  assert.equal(rows[2].isRefunds, true);
  assert.equal(rows[3].published, false);
  assert.equal(purposeText(rows[3]), "not published (negative figure)");
  assert.equal(purposeText(rows[0]), "$600");
  assert.equal(purposesTotal(year([p("OTHER", 600), p("X", null)])), 600);
});

test("a zero total is $0, and with a zero denominator no share is invented", () => {
  const rows = purposeRows(year([p("TRAVEL", 0, 0), p("OTHER", 0, 0)]));
  assert.equal(purposeText(rows[0]), "$0");
  assert.deepEqual(rows.map((r) => r.share), [null, null]);
  assert.deepEqual(purposeRows(year([p("A", null)])).map((r) => r.share), [null]);
});

test("labels: fixed mapping to sentence case, unknown labels shown as given in sentence case", () => {
  assert.equal(purposeLabel("CONTRIBUTIONS"), "Contributions");
  assert.equal(purposeLabel("ADMINISTRATIVE"), "Administrative");
  assert.equal(purposeLabel("REFUNDS"), "Refunds");
  assert.equal(purposeLabel("OTHER"), "Other");
  assert.equal(purposeLabel("LOAN REPAYMENTS"), "Loan repayments");
  assert.equal(purposeLabel(""), "");
});

test("sponsor link: one phrase per method, joined by '; ', unknown ignored", () => {
  assert.equal(sponsorLinkText("fec_api_sponsor_id"), "Linked by the FEC's sponsor candidate id");
  assert.equal(sponsorLinkText("fec_candidate_id"), "Linked by the FEC candidate id on the committee record");
  assert.equal(sponsorLinkText("leadership_file_exact_name"), "Linked by the sponsor name in the FEC's leadership-PAC list (exact match)");
  assert.equal(
    sponsorLinkText("fec_api_sponsor_id+fec_candidate_id"),
    "Linked by the FEC's sponsor candidate id; Linked by the FEC candidate id on the committee record",
  );
  assert.equal(sponsorLinkText("something_else"), null);
});

test("fold: only when more than 90% of the operating spending has no FEC category", () => {
  const cat = (category, total) => ({ category, label: "x", total, count: 1, refunds: 0, refund_count: 0 });
  assert.equal(foldCategories(year([], { total: 100, categories: [cat(null, 95), cat("001", 5)] })), true);
  assert.equal(foldCategories(year([], { total: 100, categories: [cat(null, 90), cat("001", 10)] })), false);
  assert.equal(foldCategories(year([], { total: 100, categories: [cat("001", 100)] })), false);
  assert.equal(foldCategories(year([], { total: 0, categories: [] })), false);
});

test("purpose table: one row per group newest cycle first, a null total stays an empty cell, cycles without groups add none", () => {
  const cf = { loans: [], coverage: {}, leadership_pac: [
    year([p("OTHER", 5, 2), p("TRANSFERS", null, 1)], { cycle: 2022 }),
    year([p("REFUNDS", 7, 3)], { cycle: 2024 }),
    year(null, { cycle: 2020 }),
    year([], { cycle: 2018 }),
  ] };
  const rows = purposeTableRows(cf);
  assert.deepEqual(rows.map((r) => [r[2], r[3], r[4], r[5]]), [[2024, "REFUNDS", 7, 3], [2022, "OTHER", 5, 2], [2022, "TRANSFERS", null, 1]]);
  assert.equal(rows[0].length, PURPOSE_COLS.length);
  assert.deepEqual(purposeTableRows(null), []);
});

test("the groups total says when it leaves out groups whose figure is not published", async () => {
  const { FINANCE } = await import("../src/lib/copy-finance.ts");
  assert.equal(FINANCE.purposesTotal("$10", "3 payments", 0), "Groups total $10 in 3 payments.");
  assert.match(FINANCE.purposesTotal("$10", "3 payments", 1), /not counting one group whose figure is not published\.$/);
  assert.match(FINANCE.purposesTotal("$10", "3 payments", 2), /not counting 2 groups whose figure is not published\.$/);
});
