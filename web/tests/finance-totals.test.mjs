// Unit tests for lib/domain/finance-totals.ts: the three states of a PAC-year's FEC committee totals (field absent in an old file,
// null, object), "not reported" for a missing figure and never $0 for it, the through text, the printed line and the full file's table.
import test from "node:test";
import assert from "node:assert/strict";
import { totalsState, totalsLines, throughText, totalsCaseLine, totalsTableRows, TOTALS_COLS } from "../src/lib/domain/finance-totals.ts";

const T = { receipts: 3811921.29, disbursements: 8067055.36, contributions_to_committees: 1196000, operating_expenditures: 5833520.61,
  contribution_refunds: 65986.75, other_disbursements: 971548, cash_on_hand: 5673948, coverage_end_date: "2026-10-14" };
const year = (totals, over = {}) => ({
  committee_id: "C00344234", committee_name: "PAC TO THE FUTURE", cycle: 2026, sponsor_link: "fec_api_sponsor_id", total: 100, count: 3, refunds: 0, refund_count: 0,
  categories: [{ category: null, label: "x", total: 100, count: 3, refunds: 0, refund_count: 0 }], purposes: null,
  ...(totals === undefined ? {} : { totals }), ...over,
});

test("state: a missing field is an old file (render nothing), null is unavailable, an object is figures", () => {
  assert.equal(totalsState(year(undefined)), "absent");
  assert.equal(totalsState(year(null)), "unavailable");
  assert.equal(totalsState(year(T)), "figures");
  assert.deepEqual(totalsLines(year(undefined)), []);
  assert.deepEqual(totalsLines(year(null)), []);
  assert.equal(throughText(year(null)), null);
  assert.equal(totalsCaseLine(year(null)), null);
});

test("the five headline figures are the FEC's own, in reading order, as whole dollars", () => {
  const lines = totalsLines(year(T));
  assert.deepEqual(lines.map((l) => l.key), ["receipts", "disbursements", "contributions", "operating", "cash"]);
  assert.deepEqual(lines.map((l) => l.value), ["$3,811,921", "$8,067,055", "$1,196,000", "$5,833,521", "$5,673,948"]);
  assert.equal(throughText(year(T)), "through 14 Oct 2026");
});

test("a figure that is null reads 'not reported', never $0; a real zero is $0", () => {
  const lines = totalsLines(year({ ...T, receipts: null, contributions_to_committees: 0, cash_on_hand: null }));
  assert.equal(lines[0].value, "not reported");
  assert.equal(lines[2].value, "$0");
  assert.equal(lines[4].value, "not reported");
  assert.ok(!lines.some((l) => l.value === "$0" && l.key !== "contributions"));
});

test("printed line: one compact line naming the committee, cycle, date and figures; 'not reported' for a gap", () => {
  const line = totalsCaseLine(year({ ...T, other_disbursements: null, cash_on_hand: null }));
  assert.match(line, /^PAC TO THE FUTURE \(C00344234\), 2026 cycle, FEC committee summary through 14 Oct 2026: receipts \$3,811,921; disbursements \$8,067,055;/);
  assert.match(line, /operating expenditures \$5,833,521; cash on hand not reported\.$/);
  assert.ok(!line.includes("\n"));
});

test("full file rows: cents kept, empty cells for gaps, an old file's year adds no row, newest cycle first, FEC page link", () => {
  const cf = { loans: [], receipts: [], coverage: {}, leadership_pac: [
    year(T, { cycle: 2024, totals: { ...T, cash_on_hand: null, coverage_end_date: "2024-12-31" } }),
    year(null, { cycle: 2022 }),
    year(undefined, { cycle: 2020 }),
    year(T),
  ] };
  const rows = totalsTableRows(cf);
  assert.deepEqual(rows.map((r) => r[2]), [2026, 2024, 2022]);
  assert.equal(rows[0].length, TOTALS_COLS.length);
  assert.equal(rows[0][3], 3811921.29);
  assert.equal(rows[1][9], null);
  assert.deepEqual(rows[2].slice(3, 11), [null, null, null, null, null, null, null, null]);
  assert.match(String(rows[0][11]), /^https:\/\/www\.fec\.gov\//);
  assert.deepEqual(totalsTableRows(null), []);
});

test("totals: an old file (no PAC-year has a totals field) gives no rows, so the full file shows no totals section", () => {
  const old = { loans: [], coverage: {}, leadership_pac: [year(undefined), year(undefined, { cycle: 2024 })] };
  assert.equal(totalsTableRows(old).length, 0);
  assert.equal(totalsTableRows({ ...old, leadership_pac: [year(null)] }).length, 1, "null is 'unavailable': a real state, still listed");
});
