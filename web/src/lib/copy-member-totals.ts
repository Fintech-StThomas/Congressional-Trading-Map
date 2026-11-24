// Wording for the member page's money totals, the year chart, and missing-value labels on the holdings section.
// New strings only; the older fixed wording stays in copy.ts and copy-ui.ts.
export const MONEY_TOTALS = {
  heading: "Money totals, all in",
  note: "Each total adds the ties listed with their records above and the further ties below, so no large tie is left out. Spending for and against a member is kept apart: money spent against a member is not a tie, so it is counted in spenders, not ties, and is never added to support.",
  smallerOnly: "smaller ties only",
  smallerRows: "smaller rows only",
  unsplit: "not split for the remaining rows",
  incomplete: "listed ties only, at least",
  incompleteRows: "listed rows only, at least",
  atLeast: "at least",
  missingSide: (what: string) => `No rows of ${what} are listed, but some may be among the remaining rows.`,
  against: "spender",
  noAmount: "no amount",
  sides: { all: "", for: " · for the member", against: " · against the member", unstated: " · side not stated", in: " · received", out: " · paid" },
  seats: "Same committee",
} as const;

export const YEAR_CHART = {
  note: "Bars show trades reported and money records per year. Money records are counted only where a record carries a single year: those on listed ties, and those on further ties whose records all fall in one year. Spending against a member is not counted as a tie. A further tie spanning several years is counted in its first and last year in the last row, not as records. Shading shows how complete the underlying data is for that year.",
  moneyLabel: "Money records (dated to one year)",
  moneyUnit: "money records dated to this year",
  spanLabel: "Further ties with a first or last record",
  spanUnit: "further ties with a first or last record this year",
  multiYear: (n: number) => `${n.toLocaleString("en-US")} money records sit on further ties that span several years; they are not placed on a year.`,
  inProgress: "in progress (year not finished)",
} as const;

export const HOLDINGS_MISSING = {
  residenceNone: "not identified in the filing",
  netWorthNote: "A mortgage is subtracted unless its filed type or creditor text names a residence; text cut off at a line break can hide that, so a home mortgage may be included in the subtraction.",
  unbounded: "unbounded below",
  unboundedTip: (y: number, top: string | null) => `${y}: ${top ? `up to ${top}, ` : ""}unbounded below (an open-ended liability)`,
} as const;
