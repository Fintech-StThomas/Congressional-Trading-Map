// Data contract types for MemberFile.campaign_finance (docs/data-dictionary.md, "Campaign finance block"), split out of
// types.ts to keep files short. Same rule: change the data dictionary first, then re-copy. Re-exported by types.ts.
export type CampaignFinance = {
  loans: LoanRow[];                 // one row per (cycle, candidate id), oldest cycle first; [] if none
  leadership_pac: LeadershipPacYear[]; // one row per (cycle, committee), oldest cycle first; [] if none
  coverage: {
    loans_cycles: number[];         // cycles whose weball file was loaded (the same for every member)
    leadership_pac_cycles: number[];// cycles whose oppexp file was loaded (2004 on)
    leadership_pac_note: string | null; // set exactly when leadership_pac is []
  };
};

export type LoanRow = {                    // the FEC's all-candidates summary row for one candidate id and cycle
  cycle: number;                    // two-year election cycle, even year
  candidate_id: string;             // one of MemberFile.member.fec_ids
  office: "house" | "senate" | "president" | null;
  candidate_loans: number | null;   // loans the candidate reported making to their own campaign
  other_loans: number | null;
  candidate_loan_repayments: number | null;
  other_loan_repayments: number | null;
  debts_owed_by: number | null;
  through: string | null;           // the summary covers the cycle up to this date (YYYY-MM-DD)
};                                  // dollars, exact (not ranges); null = blank in the file or a negative figure

export type LeadershipPacCategory = { category: string | null; label: string; total: number; count: number; refunds: number; refund_count: number };

export type LeadershipPacYear = {
  committee_id: string;             // the leadership PAC, C + 8 digits
  committee_name: string;
  cycle: number;
  sponsor_link: "fec_candidate_id" | "leadership_file_exact_name" | "fec_candidate_id+leadership_file_exact_name";
  total: number;                    // dollars spent: positive operating-expenditure rows in that cycle
  count: number;
  refunds: number;                  // absolute value of the negative rows, not subtracted from total
  refund_count: number;
  categories: LeadershipPacCategory[]; // category null (no usable code) last; the four figures sum to the four above
};
