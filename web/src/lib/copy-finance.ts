// Wording for the "Campaign money" section (FEC loans a candidate reported making to their own campaign, and leadership
// PAC spending by FEC category): section text, empty states, column labels and the notes under the tables. It states what
// the filings say and what they do not show; it never characterises a loan or a payment. Import from here.

export const FINANCE = {
  title: "Campaign money",
  intro: "Figures from the FEC's candidate summary and operating-expenditure files, as filed. Whole dollars (cents are not kept), not ranges. A blank figure is shown as not reported, never as zero.",
  loansTitle: "Loans to own campaign",
  loansNote: "Loans the candidate reported making to their own campaign, as summarised by the FEC. A loan figure does not show why it was made or whether it was repaid beyond the repayment columns.",
  loansNone: "No loans reported in the cycles loaded.",
  noSummary: "No FEC campaign summary for this member in the cycles loaded.",
  pacTitle: "Leadership PAC spending",
  pacNote: "Spending by each leadership PAC linked to this member, grouped by the FEC's disbursement category. Refunds are shown beside spending and are never subtracted from it.",
  pacNoCategoryLabel: "No FEC category on the filing",
  pacNoCategoryShare: (share: string) => `${share} of the spending carries no FEC category.`,
  pacCycle: "Cycle",
  pacCommittee: "Committee",
  pacSpent: "Spent",
  purposeAmount: "Amount",
  pacRefunds: "Refunds",
  pacShare: "Share of spent",
  pacTotals: (spent: string, n: string, refunds: string, rn: string) => `Spent ${spent} in ${n}; refunds ${refunds} in ${rn}.`,
  pacChartLabel: (committee: string, cycle: number) => `${committee}, ${cycle} cycle: spending by FEC category`,
  coverage: (loans: string, pac: string, purposes: string) => `Cycles loaded: loans ${loans}; leadership PAC spending ${pac}; FEC purpose groups ${purposes}.`,
  coverageNone: "none",
  notShownLabel: "What this does not show:",
  notShown: "Who was paid, what for, or whether any payment was proper. Loans are cycle totals as the FEC summarises them; categories are the FEC's, and most PAC spending has none.",
  refundsNote: "A category can show more refunded than spent, for example when the original payment is in an earlier cycle's file. The two are not paired.",
  purposesTitle: "How the FEC groups this committee's spending",
  purposesNote: "The FEC's own groupings of every payment this committee reported in the cycle — contributions to candidates, transfers and refunds as well as running costs — so the total can differ from the operating spending below.",
  purposesUnavailable: "The FEC's groupings are not available for this cycle.",
  purposesNone: "The FEC reported no groupings for this committee in this cycle.",
  purposesNotPublished: "not published (negative figure)",
  purposesRefundsNote: "The FEC reports refunds as their own group; nothing is subtracted from the other groups.",
  purposesChartLabel: (committee: string, cycle: number) => `${committee}, ${cycle} cycle: the FEC's purpose groups`,
  purposesTotal: (total: string, n: string, unpublished: number) =>
    `Groups total ${total} in ${n}${unpublished ? `, not counting ${unpublished === 1 ? "one group" : `${unpublished} groups`} whose figure is not published` : ""}.`,
  purposeGroup: "Group",
  opexTitle: "Operating spending by FEC category",
  opexShow: "Show operating spending by category",
  opexMostlyNone: (share: string) => `${share} of this operating spending has no FEC category, so the table is folded.`,
  sponsorLink: {
    fec_api_sponsor_id: "Linked by the FEC's sponsor candidate id",
    fec_candidate_id: "Linked by the FEC candidate id on the committee record",
    leadership_file_exact_name: "Linked by the sponsor name in the FEC's leadership-PAC list (exact match)",
  } as Record<string, string>,
  showAll: "loan rows",
  fecLink: "FEC committee page",
  records: {
    loansTitle: "Loans to own campaign",
    loansIntro: "One row per cycle and candidate id, as the FEC's candidate summary reports it. Blank figures are empty cells.",
    pacTitle: "Leadership PAC spending by category",
    pacIntro: "One row per committee, cycle and FEC category, with spending and refunds side by side. Refunds are not subtracted. A blank category is spending the filing gave no category.",
    none: "No FEC campaign summary for this member in the cycles loaded.",
    purposesTitle: "FEC purpose groups",
    purposesIntro: "One row per committee, cycle and FEC purpose group: the FEC's own groupings of every disbursement the committee reported in the cycle, so totals can differ from the category table. Refunds are their own group and nothing is subtracted. A blank total is a negative figure the FEC does not publish here, not zero.",
    purposesNone: "No FEC purpose groups for this member's committees in the cycles loaded.",
    pacNone: "No leadership PAC linked to this member in the cycles loaded.",
  },
} as const;

/** The explainer for the campaign-money "no category" row; Explain.tsx merges it with lib/copy.ts EXPLAIN. */
export const FINANCE_EXPLAIN = {
  nocategory: {
    label: "No FEC category on the filing",
    body: "The FEC files most PAC spending without a category code, so this row is usually the largest. It means the filing carries no category, not that the money went anywhere in particular. The amount is as filed; the site does not guess a category.",
  },
} as const;
