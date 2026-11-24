// Unit tests for lib/domain/finance-receipts.ts: newest-first order, "not reported" for a blank (never $0), exact-id FEC candidate
// links, an absent receipts field, the full file's columns and rows (cents and blanks kept), and the latest-cycle line.
import test from "node:test";
import assert from "node:assert/strict";
import { receiptsOf, receiptsNewestFirst, receiptsLine, candidateUrl, candidateLinks, receiptsRows, latestReceiptsLine, RECEIPT_COLS } from "../src/lib/domain/finance-receipts.ts";
import { RECEIPTS } from "../src/lib/copy-finance-receipts.ts";

const row = (cycle, over = {}) => ({
  cycle, candidate_id: "H8CA05035", office: "house", total_receipts: 10223363.88, from_individuals: 9554439.66, from_other_committees: 251518.53,
  from_party_committees: 130.94, from_candidate: 0, transfers_from_authorised: 403887.59, total_disbursements: 11739026.18, cash_on_hand: -12.5,
  through: "2024-12-31", ...over,
});
const BLANK = { total_receipts: null, from_individuals: null, from_other_committees: null, from_party_committees: null, from_candidate: null, transfers_from_authorised: null, total_disbursements: null, cash_on_hand: null, through: null };

test("receipts: newest cycle first, then candidate id", () => {
  const rows = receiptsNewestFirst([row(2018), row(2022, { candidate_id: "P00000001", office: "president" }), row(2022)]);
  assert.deepEqual(rows.map((r) => [r.cycle, r.candidate_id]), [[2022, "H8CA05035"], [2022, "P00000001"], [2018, "H8CA05035"]]);
});

test("receipts: a blank is not reported, zero stays $0, cents are rounded only for display, a negative cash balance is shown as filed", () => {
  const l = receiptsLine(row(2024));
  assert.equal(l.total, "$10,223,364");
  assert.equal(l.candidate, "$0");
  assert.equal(l.cash, "-$13");
  assert.equal(l.through, "through 2024-12-31");
  const b = receiptsLine(row(2024, BLANK));
  for (const k of ["total", "individuals", "committees", "party", "candidate", "cash", "through"]) assert.equal(b[k], "not reported", k);
});

test("receipts: the FEC candidate page is built from an exact id only", () => {
  assert.equal(candidateUrl("H8CA05035"), "https://www.fec.gov/data/candidate/H8CA05035/");
  assert.equal(candidateUrl("P60003225"), "https://www.fec.gov/data/candidate/P60003225/");
  for (const bad of ["", "pelosi", "H8CA05035/../x", "https://x.test", "H8CA 05035", "C00123456"]) assert.equal(candidateUrl(bad), null, bad);
  const links = candidateLinks([row(2018), row(2022, { candidate_id: "P60003225", office: "president" }), row(2022)]);
  assert.deepEqual(links.map((l) => l.id), ["H8CA05035", "P60003225"]);
});

test("receipts: an absent or empty field is none, never zeros", () => {
  assert.deepEqual(receiptsOf(null), []);
  assert.deepEqual(receiptsOf(undefined), []);
  assert.deepEqual(receiptsOf({ loans: [], leadership_pac: [], coverage: {} }), []);
  assert.deepEqual(receiptsRows(null), []);
  assert.equal(latestReceiptsLine([]), null);
});

test("receipts: full-file rows match the columns, keep cents and leave blanks empty", () => {
  const rows = receiptsRows({ receipts: [row(2022, BLANK), row(2024)] });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.length === RECEIPT_COLS.length));
  assert.equal(rows[0][0], 2024);
  assert.equal(rows[0][3], 10223363.88);
  assert.equal(rows[0][12], "https://www.fec.gov/data/candidate/H8CA05035/");
  assert.deepEqual(rows[1].slice(3, 11), Array(8).fill(null));
  assert.equal(rows[1][11], null);
});

test("receipts: the printed line is for the latest cycle only and the wording never says tie or wrongdoing", () => {
  const latest = latestReceiptsLine([row(2020), row(2024), row(2024, { candidate_id: "S2TX00312", office: "senate" })]);
  assert.equal(latest.cycle, 2024);
  assert.deepEqual(latest.rows.map((r) => r.candidate_id), ["H8CA05035", "S2TX00312"]);
  const words = JSON.stringify(RECEIPTS);
  assert.match(RECEIPTS.note, /not ties/);
  assert.match(RECEIPTS.note, /Individual contributors are never published/);
  assert.doesNotMatch(words, /illegal|improper|corrupt|bribe|scandal|suspicious/i);
});
