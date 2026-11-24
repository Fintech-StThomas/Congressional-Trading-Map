// Unit tests for lib/domain/finance.ts: loan ordering and "not reported", PAC grouping and default cycle, category rows
// with share of spent (null without a denominator), the no-category share, refunds never netted, tables and coverage.
import test from "node:test";
import assert from "node:assert/strict";
import { loansNewestFirst, loanLine, pacGroups, defaultCycle, cycleOf, categoryRows, noCategoryShare, shareText, barPercent, committeeUrl, coverageLine, loanRows, pacRows, LOAN_COLS, PAC_COLS, hasFinance } from "../src/lib/domain/finance.ts";
import { reportedMoney } from "../src/lib/format.ts";

const loan = (cycle, over = {}) => ({ cycle, candidate_id: "H0SAMPLE001", office: "house", candidate_loans: 1000, other_loans: 0, candidate_loan_repayments: null, other_loan_repayments: 5, debts_owed_by: null, through: "2024-12-31", ...over });
const cat = (category, total, refunds = 0, count = 1, refund_count = 0) => ({ category, label: category ?? "x", total, count, refunds, refund_count });
const year = (committee_id, cycle, categories, over = {}) => ({
  committee_id, committee_name: `PAC ${committee_id} ${cycle}`, cycle, sponsor_link: "fec_candidate_id",
  total: categories.reduce((s, c) => s + c.total, 0), count: categories.length, refunds: categories.reduce((s, c) => s + c.refunds, 0),
  refund_count: categories.reduce((s, c) => s + c.refund_count, 0), categories, ...over,
});

test("reportedMoney: null is not reported, zero is $0", () => {
  assert.equal(reportedMoney(null), "not reported");
  assert.equal(reportedMoney(undefined), "not reported");
  assert.equal(reportedMoney(0), "$0");
  assert.equal(reportedMoney(12500), "$12,500");
});

test("loans: newest cycle first, then candidate id; blanks say not reported", () => {
  const rows = loansNewestFirst([loan(2018), loan(2022, { candidate_id: "P00000001", office: "president" }), loan(2022)]);
  assert.deepEqual(rows.map((r) => [r.cycle, r.candidate_id]), [[2022, "H0SAMPLE001"], [2022, "P00000001"], [2018, "H0SAMPLE001"]]);
  const l = loanLine(loan(2024));
  assert.equal(l.candidateRepaid, "not reported");
  assert.equal(l.debts, "not reported");
  assert.equal(l.otherLoans, "$0");
  assert.equal(l.office, "House");
  assert.equal(l.through, "through 2024-12-31");
  assert.equal(loanLine(loan(2024, { office: null, through: null })).office, "not reported");
  assert.equal(loanLine(loan(2024, { office: "president" })).office, "President");
});

test("loan rows keep null as an empty cell", () => {
  const rows = loanRows({ loans: [loan(2024)], leadership_pac: [], coverage: { loans_cycles: [2024], leadership_pac_cycles: [], leadership_pac_note: "n" } });
  assert.equal(rows[0].length, LOAN_COLS.length);
  assert.equal(rows[0][5], null);
  assert.deepEqual(loanRows(null), []);
});

test("pac groups: one per committee, newest cycle first, latest name", () => {
  const g = pacGroups([year("C00000002", 2018, [cat("001", 5)]), year("C00000001", 2020, [cat("001", 5)]), year("C00000001", 2024, [cat("001", 5)]), year("C00000001", 2022, [cat("001", 5)])]);
  assert.deepEqual(g.map((x) => x.id), ["C00000001", "C00000002"]);
  assert.deepEqual(g[0].cycles.map((y) => y.cycle), [2024, 2022, 2020]);
  assert.equal(g[0].name, "PAC C00000001 2024");
  assert.equal(defaultCycle(g[0]), 2024);
  assert.equal(cycleOf(g[0], 2020).cycle, 2020);
  assert.equal(cycleOf(g[0], 1999).cycle, 2024);
  assert.equal(cycleOf(g[0], null).cycle, 2024);
});

test("categories: no-category row first, then by spending; shares of spent; refunds not netted", () => {
  const y = year("C00000001", 2024, [cat("002", 100, 400, 3, 2), cat("001", 300), cat(null, 600, 50, 9, 1)]);
  const rows = categoryRows(y);
  assert.deepEqual(rows.map((r) => r.key), ["none", "001", "002"]);
  assert.equal(rows[0].label, "No FEC category on the filing");
  assert.equal(rows[0].share, 0.6);
  assert.equal(rows[2].total, 100);
  assert.equal(rows[2].refunds, 400, "refund exceeds spent and stays its own figure");
  assert.equal(noCategoryShare(y), 0.6);
  assert.equal(shareText(0.6), "60%");
  assert.equal(barPercent(0.6), 60);
});

test("share is null when nothing was spent; never 0%", () => {
  const y = year("C00000001", 2024, [cat("001", 0, 70, 0, 2)]);
  assert.equal(categoryRows(y)[0].share, null);
  assert.equal(noCategoryShare(y), null);
  assert.equal(shareText(null), "n/a");
  assert.equal(barPercent(null), 0);
});

test("no null-category row with spending: the share is 0, not missing", () => {
  assert.equal(noCategoryShare(year("C00000001", 2024, [cat("001", 10)])), 0);
});

test("pac table rows: refunds beside spending, null category as empty code", () => {
  const cf = { loans: [], leadership_pac: [year("C00000001", 2024, [cat(null, 9, 1, 2, 1), cat("001", 1)])], coverage: { loans_cycles: [], leadership_pac_cycles: [2024], leadership_pac_note: null } };
  const rows = pacRows(cf);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, PAC_COLS.length);
  assert.equal(rows[0][3], null);
  assert.equal(rows[0][4], "No FEC category on the filing");
  assert.equal(rows[0][7], 1);
});

test("committee link is the FEC page; coverage line lists cycles", () => {
  assert.equal(committeeUrl("C00123456"), "https://www.fec.gov/data/committee/C00123456/");
  assert.equal(committeeUrl("bad"), null);
  const line = coverageLine({ loans: [], leadership_pac: [], coverage: { loans_cycles: [2022, 2020], leadership_pac_cycles: [], leadership_pac_note: "x" } });
  assert.match(line, /loans 2020, 2022/);
  assert.match(line, /none/);
  assert.equal(hasFinance(undefined), false);
  assert.equal(hasFinance(null), false);
});
