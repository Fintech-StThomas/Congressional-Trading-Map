// Wording for "Money in and out, as summarised by the FEC" (a leadership PAC's panel on the member page, the full file's table and
// the printed case file). It says what the FEC's committee summary reports and how its figures relate to the spending tables; it never
// characterises a contribution or a payment. A figure the FEC summary does not give reads "not reported", never zero. Import from here.

export const TOTALS = {
  title: "Money in and out, as summarised by the FEC",
  note: "The FEC's own summary of this committee's reports for the cycle, added up from the start of the cycle to the date shown. Totals only: no donor, payee or payment is named, and nothing here says any money was tied to a vote or a trade.",
  unavailable: "Not reported: the FEC's committee summary is not available for this cycle.",
  reconcile: "The purpose groups below cover the committee's disbursements. Operating expenditures are one part of them, next to contributions to other committees, refunds and other disbursements, so the two do not add to the same figure. The category table below comes from the FEC's operating-expenditure file, which can end on a different date.",
  through: (date: string) => `through ${date}`,
  fecLink: "FEC committee page",
  labels: {
    receipts: "Money in (receipts)",
    disbursements: "Total money out (disbursements)",
    contributions: "Contributions to other committees and candidates",
    operating: "Operating expenditures",
    cash: "Cash on hand at close",
  },
  records: {
    title: "Leadership PAC money in and out, per cycle",
    intro: "One row per committee and cycle, from the FEC's committee summary: receipts, total disbursements, contributions to other committees and candidates, operating expenditures, refunds, other disbursements and cash on hand, added up to the coverage end date. Exact dollars. A blank cell is not reported (or unavailable), never zero. Totals only; no donors or payees.",
    none: "No FEC committee summary for this member's committees in the cycles loaded.",
  },
  caseFile: (name: string, id: string, cycle: number, through: string) => `${name} (${id}), ${cycle} cycle, FEC committee summary ${through}`,
} as const;
