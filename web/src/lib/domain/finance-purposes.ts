// Pure rules for the FEC purpose groups of a leadership PAC-year (LeadershipPacYear.purposes), the sponsor-link line and
// the full file's purpose table. Missing is never zero: a null group total is "not published", null purposes mean "not
// available", [] means the FEC returned no groups. Shares use only the published totals; order is kept as given.
// Nothing is netted: REFUNDS is a group like the others. No React, so tests load it directly.
import type { CampaignFinance, LeadershipPacYear } from "../types.ts";
import { reportedMoney } from "../format.ts";
import { FINANCE } from "../copy-finance.ts";
import { pacGroups } from "./finance.ts";
import type { Cell, Col } from "./records.ts";

/** The FEC's group labels, written in sentence case. */
const PURPOSE_LABELS: Record<string, string> = {
  CONTRIBUTIONS: "Contributions",
  ADMINISTRATIVE: "Administrative",
  ADVERTISING: "Advertising",
  TRAVEL: "Travel",
  TRANSFERS: "Transfers",
  REFUNDS: "Refunds",
  OTHER: "Other",
};

/** A group label in sentence case; a label not in the fixed mapping is shown as given, lower-cased with a capital first letter. */
export function purposeLabel(purpose: string): string {
  const known = PURPOSE_LABELS[purpose.trim().toUpperCase()];
  if (known) return known;
  const t = purpose.trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : purpose;
}

export type PurposesState = "unavailable" | "none" | "rows";

/** unavailable = null (not fetched or not covered); none = the FEC returned no groups; rows = at least one group. */
export function purposesState(y: LeadershipPacYear): PurposesState {
  const p = y.purposes ?? null;
  return p === null ? "unavailable" : p.length === 0 ? "none" : "rows";
}

export type PurposeRow = {
  key: string; purpose: string; label: string; isRefunds: boolean;
  total: number | null; count: number; published: boolean;
  /** total / the sum of the published group totals; null for an unpublished total or when that sum is 0. */
  share: number | null;
};

/** The groups of a PAC-year in the order given (the FEC's order, largest first, unpublished last), with shares of the published total. */
export function purposeRows(y: LeadershipPacYear): PurposeRow[] {
  const ps = y.purposes ?? [];
  const denom = purposesTotal(y) ?? 0;
  return ps.map((p, i): PurposeRow => ({
    key: `${p.purpose}-${i}`, purpose: p.purpose, label: purposeLabel(p.purpose), isRefunds: p.purpose.trim().toUpperCase() === "REFUNDS",
    total: p.total, count: p.count, published: p.total !== null,
    share: p.total !== null && denom > 0 ? p.total / denom : null,
  }));
}

/** Sum of the published group totals; null when there are no groups (nothing to add up, never 0). */
export function purposesTotal(y: LeadershipPacYear): number | null {
  const ps = y.purposes ?? [];
  if (ps.length === 0) return null;
  return ps.reduce((s, p) => s + (p.total ?? 0), 0);
}

/** The figures of one group row as the strings the page prints: dollars or "not published (negative figure)". */
export function purposeText(r: PurposeRow): string {
  return r.total === null ? FINANCE.purposesNotPublished : reportedMoney(r.total);
}

/** How the PAC is linked to the member: the phrase for each method in the "+"-joined sponsor_link, joined by "; ". An unknown method is skipped; no phrase at all gives null. */
export function sponsorLinkText(link: string): string | null {
  const phrases = link.split("+").map((m) => FINANCE.sponsorLink[m.trim()]).filter((x): x is string => Boolean(x));
  return phrases.length ? phrases.join("; ") : null;
}

export const PURPOSE_COLS: Col[] = [
  { key: "committee_id", label: "Committee id", kind: "text", width: 110 },
  { key: "committee_name", label: "Committee", kind: "text", width: 220 },
  { key: "cycle", label: "Cycle", kind: "text", width: 70 },
  { key: "purpose", label: "FEC purpose group", kind: "text", width: 160 },
  { key: "total", label: "Total (blank = not published)", kind: "num", width: 170 },
  { key: "count", label: "Disbursements", kind: "num", width: 120 },
];

/** One row per committee, cycle and group in the FEC's order, newest cycle first; a negative figure the FEC does not publish is an empty cell, not 0. Cycles without groups add no rows. */
export function purposeTableRows(cf: CampaignFinance | null | undefined): Cell[][] {
  if (!cf) return [];
  return pacGroups(cf.leadership_pac).flatMap((g) =>
    g.cycles.flatMap((y) => (y.purposes ?? []).map((p): Cell[] => [y.committee_id, y.committee_name, y.cycle, p.purpose, p.total, p.count])),
  );
}

/** The operating-spending category table is folded when more than this share of it has no FEC category. */
export const FOLD_NO_CATEGORY_ABOVE = 0.9;

/** Whether to fold the category table: more than 90% of the operating spending has no FEC category. */
export function foldCategories(y: LeadershipPacYear): boolean {
  const none = y.categories.find((c) => c.category === null);
  return y.total > 0 && (none?.total ?? 0) / y.total > FOLD_NO_CATEGORY_ABOVE;
}
