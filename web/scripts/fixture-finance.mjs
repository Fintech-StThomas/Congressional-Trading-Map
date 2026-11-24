// Invented campaign_finance blocks for a few fixture members (FEC campaign receipts, loans and leadership PAC spending), imported by
// make-fixtures.mjs. Static and deterministic: it draws no random numbers, so no other fixture value shifts.
//   X000008  loans and receipts with blank figures, a presidential row and a negative cash on hand
//   X000001  a leadership PAC: a no-category row, a category refunded more than spent, receipts [], two cycles, FEC purpose groups (one
//            unpublished negative total; the second PAC has [] in 2022, 95% uncategorised, and null in 2024), a second PAC, combined sponsor links
//   X000003  loans and receipts, no leadership PAC (note set)
//   X000012  campaign_finance null
// Every other member has no field at all, which the site reads the same as null.

const COVERAGE = { loans_cycles: [2016, 2018, 2020, 2022, 2024, 2026], leadership_pac_cycles: [2016, 2018, 2020, 2022, 2024, 2026],
  purposes_cycles: [2018, 2020, 2022, 2024], purposes_source: "SAMPLE: OpenFEC /committee/{id}/reports by_purpose (invented figures for the fixtures)." };
const NOTE = "SAMPLE: no leadership PAC is linked to this member in the FEC files loaded.";

const loan = (cycle, candidate_id, office, f) => ({
  cycle, candidate_id, office,
  candidate_loans: null, other_loans: null, candidate_loan_repayments: null, other_loan_repayments: null, debts_owed_by: null,
  through: `${cycle}-12-31`, ...f,
});
const rec = (cycle, candidate_id, office, f) => ({
  cycle, candidate_id, office, total_receipts: null, from_individuals: null, from_other_committees: null, from_party_committees: null,
  from_candidate: null, transfers_from_authorised: null, total_disbursements: null, cash_on_hand: null, through: `${cycle}-12-31`, ...f,
});
const cat = (category, label, total, count, refunds = 0, refund_count = 0) => ({ category, label, total, count, refunds, refund_count });
const purpose = (purpose, total, count) => ({ purpose, total, count });
const pac = (committee_id, committee_name, cycle, categories, purposes = null, sponsor_link = "fec_candidate_id") => ({
  committee_id, committee_name, cycle, sponsor_link, purposes,
  total: categories.reduce((s, c) => s + c.total, 0), count: categories.reduce((s, c) => s + c.count, 0),
  refunds: categories.reduce((s, c) => s + c.refunds, 0), refund_count: categories.reduce((s, c) => s + c.refund_count, 0),
  categories,
});

const BLOCKS = {
  X000008: () => ({
    loans: [
      loan(2016, "P0SAMPLE08", "president", { candidate_loans: 250000, other_loans: 0, candidate_loan_repayments: 100000, other_loan_repayments: 0, debts_owed_by: 150000 }),
      loan(2018, "H0SAMPLE008", "senate", { candidate_loans: 40000, other_loans: null, candidate_loan_repayments: null, other_loan_repayments: 0, debts_owed_by: 40000 }),
      loan(2020, "H0SAMPLE008", "senate", { candidate_loans: 0, other_loans: 0, candidate_loan_repayments: 40000, other_loan_repayments: 0, debts_owed_by: 0 }),
      loan(2022, "H0SAMPLE008", "senate", { candidate_loans: 12500, other_loans: 0, candidate_loan_repayments: 0, other_loan_repayments: 0, debts_owed_by: 12500 }),
      loan(2024, "H0SAMPLE008", "senate", { candidate_loans: 5000, other_loans: 1200, candidate_loan_repayments: 2500, other_loan_repayments: 0, debts_owed_by: 3700, through: "2024-11-25" }),
    ],
    receipts: [
      rec(2016, "P0SAMPLE08", "president", { total_receipts: 1250000.5, from_individuals: 900000, from_other_committees: 20000, from_party_committees: 0, from_candidate: 250000, transfers_from_authorised: 0, total_disbursements: 1100000, cash_on_hand: 150000 }),
      rec(2018, "H0SAMPLE008", "senate", { total_receipts: 3400000, from_individuals: 2100000, from_other_committees: null, from_party_committees: 5000, from_candidate: 40000, transfers_from_authorised: 12000, total_disbursements: 3300000, cash_on_hand: 100000 }),
      rec(2020, "H0SAMPLE008", "senate", { total_receipts: 5000000, from_individuals: 3800000, from_other_committees: 900000, from_party_committees: 0, from_candidate: 0, transfers_from_authorised: 0, total_disbursements: 4900000, cash_on_hand: -2500.75 }),
      rec(2022, "H0SAMPLE008", "senate", { total_receipts: 4100000, from_individuals: 3000000, from_other_committees: 700000, from_party_committees: 1500, from_candidate: 12500, transfers_from_authorised: 0, total_disbursements: 3900000, cash_on_hand: 300000 }),
      rec(2024, "H0SAMPLE008", "senate", { total_receipts: 2600000, from_individuals: 1800000, from_other_committees: 450000, from_party_committees: 0, from_candidate: 5000, transfers_from_authorised: 20000, total_disbursements: 2400000, cash_on_hand: 520000, through: "2024-11-25" }),
    ],
    leadership_pac: [],
    coverage: { ...COVERAGE, leadership_pac_note: NOTE },
  }),
  X000001: () => ({
    loans: [],
    receipts: [],
    leadership_pac: [
      pac("C00900001", "SAMPLE FORWARD FUND", 2022, [
        cat("001", "Administrative/Salary/Overhead Expenses", 30000, 12),
        cat("012", "Political Contributions", 20000, 6),
        cat(null, "No FEC category on the filing", 150000, 80, 1200, 2),
      ], [
        purpose("OTHER", 120000, 70), purpose("CONTRIBUTIONS", 60000, 14), purpose("ADMINISTRATIVE", 20000, 9),
        purpose("REFUNDS", 1200, 2), purpose("TRANSFERS", null, 1),
      ], "fec_api_sponsor_id+fec_candidate_id"),
      pac("C00900001", "SAMPLE FORWARD FUND", 2024, [
        cat("001", "Administrative/Salary/Overhead Expenses", 42000, 15, 500, 1),
        cat("004", "Travel", 9000, 4, 15000, 3),
        cat("012", "Political Contributions", 28000, 9),
        cat(null, "No FEC category on the filing", 321000, 140, 4000, 5),
      ], [
        purpose("OTHER", 250000, 120), purpose("CONTRIBUTIONS", 100000, 22), purpose("REFUNDS", 19500, 9),
        purpose("ADVERTISING", 7000, 3), purpose("ADMINISTRATIVE", 5000, 6), purpose("TRAVEL", 0, 0),
      ], "fec_api_sponsor_id+fec_candidate_id"),
      pac("C00900002", "SAMPLE LEADERSHIP COMMITTEE", 2022, [
        cat("006", "Fundraising Expenses", 500, 1),
        cat(null, "No FEC category on the filing", 9500, 12),
      ], [], "leadership_file_exact_name"),
      pac("C00900002", "SAMPLE LEADERSHIP COMMITTEE", 2024, [
        cat("006", "Fundraising Expenses", 18000, 7),
        cat(null, "No FEC category on the filing", 2000, 3),
      ], null, "leadership_file_exact_name"),
    ],
    coverage: { ...COVERAGE, leadership_pac_note: null },
  }),
  X000003: () => ({
    loans: [
      loan(2022, "H0SAMPLE003", "house", { candidate_loans: 8000, other_loans: 0, candidate_loan_repayments: 0, other_loan_repayments: 0, debts_owed_by: 8000 }),
      loan(2024, "H0SAMPLE003", "house", { candidate_loans: 0, other_loans: 0, candidate_loan_repayments: 8000, other_loan_repayments: 0, debts_owed_by: 0 }),
    ],
    receipts: [
      rec(2022, "H0SAMPLE003", "house", { total_receipts: 610000, from_individuals: 480000, from_other_committees: 90000, from_party_committees: 0, from_candidate: 8000, transfers_from_authorised: 0, total_disbursements: 590000, cash_on_hand: 20000 }),
      rec(2024, "H0SAMPLE003", "house", { total_receipts: 720000, from_individuals: 510000, from_other_committees: 130000, from_party_committees: 2500, from_candidate: 0, transfers_from_authorised: 0, total_disbursements: 700000, cash_on_hand: 40000 }),
    ],
    leadership_pac: [],
    coverage: { ...COVERAGE, leadership_pac_note: NOTE },
  }),
  X000012: () => null,
};

/** The member's campaign_finance value, or undefined when the fixture leaves the field out. */
export function financeFor(id) {
  return BLOCKS[id] ? BLOCKS[id]() : undefined;
}

/** Extra FEC ids a fixture member needs so every loan row's candidate id is one of its own. */
function extraFecIds(id) {
  return id === "X000008" ? ["P0SAMPLE08"] : [];
}

/** A fixture member file with its campaign_finance block (when it has one) and any extra FEC ids that block needs. */
export function withFinance(id, file) {
  const cf = financeFor(id);
  const member = { ...file.member, fec_ids: [...file.member.fec_ids, ...extraFecIds(id)] };
  return cf === undefined ? { ...file, member } : { ...file, member, campaign_finance: cf };
}
