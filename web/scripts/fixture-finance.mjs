// Invented campaign_finance blocks for a few fixture members (FEC loans and leadership PAC spending), imported by
// make-fixtures.mjs. Static and deterministic: it draws no random numbers, so no other fixture value shifts.
//   X000008  loans with a blank figure and a presidential row
//   X000001  a leadership PAC: a no-category row, a category refunded more than spent, two cycles, a second PAC
//   X000003  loans, no leadership PAC (note set)
//   X000012  campaign_finance null
// Every other member has no field at all, which the site reads the same as null.

const COVERAGE = { loans_cycles: [2016, 2018, 2020, 2022, 2024, 2026], leadership_pac_cycles: [2016, 2018, 2020, 2022, 2024, 2026] };
const NOTE = "SAMPLE: no leadership PAC is linked to this member in the FEC files loaded.";

const loan = (cycle, candidate_id, office, f) => ({
  cycle, candidate_id, office,
  candidate_loans: null, other_loans: null, candidate_loan_repayments: null, other_loan_repayments: null, debts_owed_by: null,
  through: `${cycle}-12-31`, ...f,
});
const cat = (category, label, total, count, refunds = 0, refund_count = 0) => ({ category, label, total, count, refunds, refund_count });
const pac = (committee_id, committee_name, cycle, categories) => ({
  committee_id, committee_name, cycle, sponsor_link: "fec_candidate_id",
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
    leadership_pac: [],
    coverage: { ...COVERAGE, leadership_pac_note: NOTE },
  }),
  X000001: () => ({
    loans: [],
    leadership_pac: [
      pac("C00900001", "SAMPLE FORWARD FUND", 2022, [
        cat("001", "Administrative/Salary/Overhead Expenses", 30000, 12),
        cat("012", "Political Contributions", 20000, 6),
        cat(null, "No FEC category on the filing", 150000, 80, 1200, 2),
      ]),
      pac("C00900001", "SAMPLE FORWARD FUND", 2024, [
        cat("001", "Administrative/Salary/Overhead Expenses", 42000, 15, 500, 1),
        cat("004", "Travel", 9000, 4, 15000, 3),
        cat("012", "Political Contributions", 28000, 9),
        cat(null, "No FEC category on the filing", 321000, 140, 4000, 5),
      ]),
      pac("C00900002", "SAMPLE LEADERSHIP COMMITTEE", 2024, [
        cat("006", "Fundraising Expenses", 18000, 7),
        cat(null, "No FEC category on the filing", 2000, 3),
      ]),
    ],
    coverage: { ...COVERAGE, leadership_pac_note: null },
  }),
  X000003: () => ({
    loans: [
      loan(2022, "H0SAMPLE003", "house", { candidate_loans: 8000, other_loans: 0, candidate_loan_repayments: 0, other_loan_repayments: 0, debts_owed_by: 8000 }),
      loan(2024, "H0SAMPLE003", "house", { candidate_loans: 0, other_loans: 0, candidate_loan_repayments: 8000, other_loan_repayments: 0, debts_owed_by: 0 }),
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
