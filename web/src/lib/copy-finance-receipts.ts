// Wording for "Campaign receipts, as summarised by the FEC" (the member page's Campaign money section, the full file's table and
// the printed case file). It says what the FEC's candidate summary reports and what it does not: these are the campaign
// committee's own summary totals, never a tie, and individual contributors are not published. It never characterises a
// contribution. Import from here.

export const RECEIPTS = {
  title: "Campaign receipts, as summarised by the FEC",
  note: "The campaign committee's own summary totals for each two-year cycle, from the FEC's candidate summary. They are not ties: nothing here says who gave or that any gift was tied to a vote or a trade. Individual contributors are never published.",
  none: "No FEC receipts summary for this member in the cycles loaded.",
  showAll: "receipt rows",
  cols: {
    cycle: "Cycle",
    total: "Total receipts",
    individuals: "From individuals",
    committees: "From PACs and other committees",
    party: "From party committees",
    candidate: "From the candidate",
    cash: "Cash on hand",
    through: "Through",
  },
  caption: "Campaign receipts by election cycle, newest first",
  fecLink: (id: string) => `FEC candidate page for ${id}`,
  cashNote: "Cash on hand is the balance at the close of the coverage period shown. Each figure is the FEC's summary of what the candidate's authorised committees reported; a blank figure is not reported (or the filed parts were inconsistent with the total and are not published), never zero; the parts do not add up to the total (loans and other lines are in the total only), and two rows in one cycle (a member who ran for two offices) should not be added, since one committee's total can include transfers from the other.",
  records: {
    title: "Campaign receipts per cycle",
    intro: "One row per cycle and candidate id, from the FEC's candidate summary: the campaign committee's own totals, not individual contributors and not ties. Exact dollars as filed. Blank figures are empty cells, never zero.",
  },
  caseFile: (cycle: number) => `Campaign receipts, ${cycle} cycle, as summarised by the FEC`,
} as const;
