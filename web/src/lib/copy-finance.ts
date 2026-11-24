// Wording for the "Campaign money" section (FEC loans a candidate reported making to their own campaign, and leadership
// PAC spending by FEC category): section text, empty states, column labels and the notes under the tables. It states what
// the filings say and what they do not show; it never characterises a loan or a payment. Import from here.

export const FINANCE = {
  title: "Campaign money",
  intro: "Figures from the FEC's candidate summary and operating-expenditure files, as filed. Exact dollars, not ranges. A blank figure is shown as not reported, never as zero.",
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
  pacRefunds: "Refunds",
  pacShare: "Share of spent",
  pacTotals: (spent: string, n: string, refunds: string, rn: string) => `Spent ${spent} in ${n}; refunds ${refunds} in ${rn}.`,
  pacChartLabel: (committee: string, cycle: number) => `${committee}, ${cycle} cycle: spending by FEC category`,
  coverage: (loans: string, pac: string) => `Cycles loaded: loans ${loans}; leadership PAC spending ${pac}.`,
  coverageNone: "none",
  notShownLabel: "What this does not show:",
  notShown: "Who was paid, what for, or whether any payment was proper. Loans are cycle totals as the FEC summarises them; categories are the FEC's, and most PAC spending has none.",
  refundsNote: "A category can show more refunded than spent, for example when the original payment is in an earlier cycle's file. The two are not paired.",
  showAll: "loan rows",
  fecLink: "FEC committee page",
  records: {
    loansTitle: "Loans to own campaign",
    loansIntro: "One row per cycle and candidate id, as the FEC's candidate summary reports it. Blank figures are empty cells.",
    pacTitle: "Leadership PAC spending by category",
    pacIntro: "One row per committee, cycle and FEC category, with spending and refunds side by side. Refunds are not subtracted. A blank category is spending the filing gave no category.",
    none: "No FEC campaign summary for this member in the cycles loaded.",
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
