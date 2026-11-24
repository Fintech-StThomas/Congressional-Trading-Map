// Pure rules for the "Campaign money" section and the full file's finance tables: which loan rows come first, how a
// leadership PAC's cycles are grouped and chosen, category rows with their share of spending, the share with no FEC
// category, the raw-record tables and the coverage line. Missing is never zero (null is "not reported"); refunds are
// shown beside spending and never subtracted. No React and no runtime imports beyond lib helpers, so tests load it directly.
import type { CampaignFinance, LeadershipPacYear, LoanRow } from "../types.ts";
import { NOT_REPORTED, percent, reportedMoney } from "../format.ts";
import { FINANCE } from "../copy-finance.ts";
import { recordUrlFor, safeHttpUrl } from "../urls.ts";
import type { Cell, Col } from "./records.ts";

export const OFFICE_LABEL: Record<string, string> = { house: "House", senate: "Senate", president: "President" };

/** Whether there is anything to show: a block exists (an absent field is the same as null). */
export function hasFinance(cf: CampaignFinance | null | undefined): cf is CampaignFinance {
  return cf != null;
}

// ---------------------------------------------------------------- loans

/** Newest cycle first, then candidate id (a member can have a House and a presidential row in one cycle). */
export function loansNewestFirst(rows: LoanRow[]): LoanRow[] {
  return [...rows].sort((a, b) => b.cycle - a.cycle || a.candidate_id.localeCompare(b.candidate_id));
}

/** One loan row as the strings the page prints: exact dollars, or "not reported" for a blank figure. */
export function loanLine(r: LoanRow) {
  return {
    cycle: String(r.cycle),
    office: r.office ? OFFICE_LABEL[r.office] ?? r.office : NOT_REPORTED,
    candidateLoans: reportedMoney(r.candidate_loans),
    otherLoans: reportedMoney(r.other_loans),
    candidateRepaid: reportedMoney(r.candidate_loan_repayments),
    otherRepaid: reportedMoney(r.other_loan_repayments),
    debts: reportedMoney(r.debts_owed_by),
    through: r.through ? `through ${r.through}` : NOT_REPORTED,
  };
}

// ---------------------------------------------------------------- leadership PACs

export type PacGroup = { id: string; name: string; cycles: LeadershipPacYear[] };

/** One group per committee, its cycles newest first, the name from the newest cycle; groups ordered by newest cycle then name. */
export function pacGroups(rows: LeadershipPacYear[]): PacGroup[] {
  const by = new Map<string, LeadershipPacYear[]>();
  for (const r of rows) by.set(r.committee_id, [...(by.get(r.committee_id) ?? []), r]);
  return [...by.entries()]
    .map(([id, ys]) => {
      const cycles = ys.sort((a, b) => b.cycle - a.cycle);
      return { id, name: cycles[0].committee_name, cycles };
    })
    .sort((a, b) => b.cycles[0].cycle - a.cycles[0].cycle || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The cycle shown first: the latest the committee has. */
export function defaultCycle(g: PacGroup): number {
  return g.cycles[0].cycle;
}

/** The committee's row for a cycle, falling back to its latest when the cycle is not one of its own. */
export function cycleOf(g: PacGroup, cycle: number | null): LeadershipPacYear {
  return g.cycles.find((y) => y.cycle === cycle) ?? g.cycles[0];
}

export type CategoryRow = {
  key: string; category: string | null; label: string; isNone: boolean;
  total: number; count: number; refunds: number; refundCount: number;
  /** total / the committee-cycle's total spent; null when that total is 0 (no denominator). */
  share: number | null;
};

/** Category rows for one committee-cycle: "No FEC category on the filing" first, then the largest spending down. Refunds ride along, never netted. */
export function categoryRows(y: LeadershipPacYear): CategoryRow[] {
  const rows = y.categories.map((c): CategoryRow => ({
    key: c.category ?? "none", category: c.category, isNone: c.category === null,
    label: c.category === null ? FINANCE.pacNoCategoryLabel : c.label,
    total: c.total, count: c.count, refunds: c.refunds, refundCount: c.refund_count,
    share: y.total > 0 ? c.total / y.total : null,
  }));
  return rows.sort((a, b) => Number(b.isNone) - Number(a.isNone) || b.total - a.total || a.label.localeCompare(b.label));
}

/** Share of the committee-cycle's spending with no FEC category: null when nothing was spent; 0 when every row has one. */
export function noCategoryShare(y: LeadershipPacYear): number | null {
  if (!(y.total > 0)) return null;
  const none = y.categories.find((c) => c.category === null);
  return (none?.total ?? 0) / y.total;
}

/** "86%" or "n/a" (no denominator), never 0% for a missing share. */
export function shareText(share: number | null): string {
  return percent(share);
}

/** Width of a bar in percent, 0 to 100; no bar without a share. */
export function barPercent(share: number | null): number {
  return share === null ? 0 : Math.min(100, Math.max(0, share * 100));
}

/** The FEC committee page for a leadership PAC, or null. */
export function committeeUrl(id: string): string | null {
  return safeHttpUrl(recordUrlFor(`pac:${id}`));
}

// ---------------------------------------------------------------- coverage

/** "Cycles loaded: loans 2018; leadership PAC spending 2018; FEC purpose groups 2018." */
export function coverageLine(cf: CampaignFinance): string {
  const list = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b).join(", ") : FINANCE.coverageNone);
  return FINANCE.coverage(list(cf.coverage.loans_cycles), list(cf.coverage.leadership_pac_cycles), list(cf.coverage.purposes_cycles ?? []));
}

// ---------------------------------------------------------------- the full file's tables

export const LOAN_COLS: Col[] = [
  { key: "cycle", label: "Cycle", kind: "text", width: 70 },
  { key: "candidate_id", label: "FEC candidate id", kind: "text", width: 130 },
  { key: "office", label: "Office", kind: "text", width: 90 },
  { key: "candidate_loans", label: "Loans from the candidate", kind: "num", width: 150 },
  { key: "other_loans", label: "Other loans", kind: "num", width: 110 },
  { key: "candidate_loan_repayments", label: "Candidate loans repaid", kind: "num", width: 150 },
  { key: "other_loan_repayments", label: "Other loans repaid", kind: "num", width: 130 },
  { key: "debts_owed_by", label: "Debts owed by the campaign", kind: "num", width: 170 },
  { key: "through", label: "Summary through", kind: "date", width: 120 },
];

/** Loan rows for the table and its CSV, newest cycle first; a blank figure is an empty cell, not 0. */
export function loanRows(cf: CampaignFinance | null | undefined): Cell[][] {
  if (!cf) return [];
  return loansNewestFirst(cf.loans).map((r) => [
    r.cycle, r.candidate_id, r.office ? OFFICE_LABEL[r.office] ?? r.office : null, r.candidate_loans, r.other_loans,
    r.candidate_loan_repayments, r.other_loan_repayments, r.debts_owed_by, r.through,
  ]);
}

export const PAC_COLS: Col[] = [
  { key: "committee_id", label: "Committee id", kind: "text", width: 110 },
  { key: "committee_name", label: "Committee", kind: "text", width: 220 },
  { key: "cycle", label: "Cycle", kind: "text", width: 70 },
  { key: "category", label: "FEC category code", kind: "text", width: 130 },
  { key: "label", label: "Category", kind: "text", width: 240 },
  { key: "total", label: "Spent", kind: "num", width: 110 },
  { key: "count", label: "Spending rows", kind: "num", width: 120 },
  { key: "refunds", label: "Refunds", kind: "num", width: 100 },
  { key: "refund_count", label: "Refund rows", kind: "num", width: 110 },
];

/** One row per committee, cycle and category (no-category row first in each), newest cycle first; refunds beside spending, never netted. */
export function pacRows(cf: CampaignFinance | null | undefined): Cell[][] {
  if (!cf) return [];
  return pacGroups(cf.leadership_pac).flatMap((g) =>
    g.cycles.flatMap((y) =>
      categoryRows(y).map((c): Cell[] => [y.committee_id, y.committee_name, y.cycle, c.category, c.label, c.total, c.count, c.refunds, c.refundCount]),
    ),
  );
}
