// Pure rules for the FEC committee totals of a leadership PAC-year (LeadershipPacYear.totals): the strings the member page prints
// ("not reported" for a figure the FEC summary lacks, never zero), the three states (absent in an old file, null = unavailable, an
// object), the "through <date>" text, the full file's columns and rows, and the compact printed line. Nothing is summed or derived
// here: every figure is the FEC's own. No React and no runtime imports beyond lib helpers, so tests load it directly.
import type { CampaignFinance, LeadershipPacYear } from "../types.ts";
import type { PacTotals } from "../types-finance.ts";
import { date, reportedMoney } from "../format.ts";
import { TOTALS } from "../copy-finance-totals.ts";
import { pacGroups, committeeUrl } from "./finance.ts";
import type { Cell, Col } from "./records.ts";

export type TotalsState = "absent" | "unavailable" | "figures";

/** absent = a file built before totals existed (the field is missing: render nothing, as before); unavailable = null; figures = an object. */
export function totalsState(y: LeadershipPacYear): TotalsState {
  return y.totals === undefined ? "absent" : y.totals === null ? "unavailable" : "figures";
}

export type TotalsLine = { key: string; label: string; value: string };

/** The five headline figures in reading order, each in whole dollars or "not reported"; [] when there are no totals. */
export function totalsLines(y: LeadershipPacYear): TotalsLine[] {
  const t = y.totals;
  if (!t) return [];
  return [
    { key: "receipts", label: TOTALS.labels.receipts, value: reportedMoney(t.receipts) },
    { key: "disbursements", label: TOTALS.labels.disbursements, value: reportedMoney(t.disbursements) },
    { key: "contributions", label: TOTALS.labels.contributions, value: reportedMoney(t.contributions_to_committees) },
    { key: "operating", label: TOTALS.labels.operating, value: reportedMoney(t.operating_expenditures) },
    { key: "cash", label: TOTALS.labels.cash, value: reportedMoney(t.cash_on_hand) },
  ];
}

/** "through 14 Oct 2026"; null when there are no totals. The date is read from the string, never through Date. */
export function throughText(y: LeadershipPacYear): string | null {
  return y.totals ? TOTALS.through(date(y.totals.coverage_end_date)) : null;
}

/** The compact printed line for one PAC-year, or null when it has no totals (nothing is invented). */
export function totalsCaseLine(y: LeadershipPacYear): string | null {
  const t = y.totals;
  if (!t) return null;
  const through = throughText(y) as string;
  const f = (label: string, v: number | null) => `${label} ${reportedMoney(v)}`;
  return `${TOTALS.caseFile(y.committee_name, y.committee_id, y.cycle, through)}: ${f("receipts", t.receipts)}; ${f("disbursements", t.disbursements)}; ${f("contributions to other committees and candidates", t.contributions_to_committees)}; ${f("operating expenditures", t.operating_expenditures)}; ${f("cash on hand", t.cash_on_hand)}.`;
}

export const TOTALS_COLS: Col[] = [
  { key: "committee_id", label: "Committee id", kind: "text", width: 110 },
  { key: "committee_name", label: "Committee", kind: "text", width: 220 },
  { key: "cycle", label: "Cycle", kind: "text", width: 70 },
  { key: "receipts", label: "Receipts", kind: "num", width: 120 },
  { key: "disbursements", label: "Total disbursements", kind: "num", width: 150 },
  { key: "contributions_to_committees", label: "Contributions to other committees and candidates", kind: "num", width: 260 },
  { key: "operating_expenditures", label: "Operating expenditures", kind: "num", width: 170 },
  { key: "contribution_refunds", label: "Refunds", kind: "num", width: 100 },
  { key: "other_disbursements", label: "Other disbursements", kind: "num", width: 160 },
  { key: "cash_on_hand", label: "Cash on hand at close", kind: "num", width: 150 },
  { key: "coverage_end_date", label: "Coverage end date", kind: "date", width: 130 },
  { key: "fec_page", label: "FEC committee page", kind: "links", width: 260 },
];

/** One row per committee and cycle, newest cycle first; a figure the FEC summary lacks is an empty cell, not 0. A year from an old file (no `totals` field) adds no row. */
export function totalsTableRows(cf: CampaignFinance | null | undefined): Cell[][] {
  if (!cf) return [];
  return pacGroups(cf.leadership_pac).flatMap((g) =>
    g.cycles.filter((y) => y.totals !== undefined).map((y): Cell[] => {
      const t: PacTotals | null = y.totals ?? null;
      return [y.committee_id, y.committee_name, y.cycle, t?.receipts ?? null, t?.disbursements ?? null, t?.contributions_to_committees ?? null,
        t?.operating_expenditures ?? null, t?.contribution_refunds ?? null, t?.other_disbursements ?? null, t?.cash_on_hand ?? null,
        t?.coverage_end_date ?? null, committeeUrl(y.committee_id)];
    }),
  );
}
