// Pure rules for the campaign receipts table (member page, full file, printed case file): newest cycle first, the strings the page
// prints ("not reported" for a blank, never zero), the FEC candidate page link for an exact candidate id, the full file's columns
// and rows, and the compact line for the latest cycle. No React and no runtime imports beyond lib helpers, so tests load it directly.
import type { CampaignFinance, ReceiptsRow } from "../types.ts";
import { NOT_REPORTED, reportedMoney } from "../format.ts";
import { RECEIPTS } from "../copy-finance-receipts.ts";
import { safeHttpUrl } from "../urls.ts";
import { OFFICE_LABEL } from "./finance.ts";
import type { Cell, Col } from "./records.ts";

// FEC candidate ids are H/S + 8 characters or P + 8 digits; the sample site's invented ids are a little longer, so the shape is checked loosely (URL-safe, exact id, no search).
const CANDIDATE_ID = /^[HSP][0-9A-Z]{8,10}$/;

/** A block's receipts rows; null when the field is absent (a file built before receipts existed: say nothing), [] only for a real empty list. */
export function receiptsOf(cf: CampaignFinance | null | undefined): ReceiptsRow[] | null {
  return cf?.receipts ?? null;
}

/** Newest cycle first, then candidate id (a member can have a House and a presidential row in one cycle). */
export function receiptsNewestFirst(rows: ReceiptsRow[]): ReceiptsRow[] {
  return [...rows].sort((a, b) => b.cycle - a.cycle || a.candidate_id.localeCompare(b.candidate_id));
}

/** The FEC page of a candidate, built from the exact id only: null for anything that is not an FEC candidate id. */
export function candidateUrl(id: string): string | null {
  return CANDIDATE_ID.test(id) ? safeHttpUrl(`https://www.fec.gov/data/candidate/${id}/`) : null;
}

/** The distinct candidate ids of the rows, newest row's id first, each with its FEC page. */
export function candidateLinks(rows: ReceiptsRow[]): { id: string; url: string | null; office: string | null }[] {
  const seen = new Set<string>();
  const out: { id: string; url: string | null; office: string | null }[] = [];
  for (const r of receiptsNewestFirst(rows)) {
    if (seen.has(r.candidate_id)) continue;
    seen.add(r.candidate_id);
    out.push({ id: r.candidate_id, url: candidateUrl(r.candidate_id), office: r.office ? OFFICE_LABEL[r.office] ?? r.office : null });
  }
  return out;
}

/** One row as the strings the page prints: whole dollars, or "not reported" for a blank figure. */
export function receiptsLine(r: ReceiptsRow) {
  return {
    cycle: String(r.cycle),
    office: r.office ? OFFICE_LABEL[r.office] ?? r.office : NOT_REPORTED,
    total: reportedMoney(r.total_receipts),
    individuals: reportedMoney(r.from_individuals),
    committees: reportedMoney(r.from_other_committees),
    party: reportedMoney(r.from_party_committees),
    candidate: reportedMoney(r.from_candidate),
    cash: reportedMoney(r.cash_on_hand),
    through: r.through ? `through ${r.through}` : NOT_REPORTED,
  };
}

/** The compact printed line for the latest cycle's rows ("2024: total receipts $10,223,364; ..."), or null when there are none. */
export function latestReceiptsLine(rows: ReceiptsRow[]): { cycle: number; rows: ReceiptsRow[] } | null {
  const sorted = receiptsNewestFirst(rows);
  if (!sorted.length) return null;
  const cycle = sorted[0].cycle;
  return { cycle, rows: sorted.filter((r) => r.cycle === cycle) };
}

export const RECEIPT_COLS: Col[] = [
  { key: "cycle", label: RECEIPTS.cols.cycle, kind: "text", width: 70 },
  { key: "candidate_id", label: "FEC candidate id", kind: "text", width: 130 },
  { key: "office", label: "Office", kind: "text", width: 90 },
  { key: "total_receipts", label: RECEIPTS.cols.total, kind: "num", width: 130 },
  { key: "from_individuals", label: RECEIPTS.cols.individuals, kind: "num", width: 130 },
  { key: "from_other_committees", label: RECEIPTS.cols.committees, kind: "num", width: 190 },
  { key: "from_party_committees", label: RECEIPTS.cols.party, kind: "num", width: 150 },
  { key: "from_candidate", label: RECEIPTS.cols.candidate, kind: "num", width: 140 },
  { key: "transfers_from_authorised", label: "Transfers from authorised committees", kind: "num", width: 210 },
  { key: "total_disbursements", label: "Total disbursements", kind: "num", width: 150 },
  { key: "cash_on_hand", label: RECEIPTS.cols.cash, kind: "num", width: 120 },
  { key: "through", label: "Coverage end date", kind: "date", width: 130 },
  { key: "fec_page", label: "FEC candidate page", kind: "links", width: 260 },
];

/** Rows for the full file's table and its CSV, newest cycle first; a blank figure is an empty cell, not 0. */
export function receiptsRows(cf: CampaignFinance | null | undefined): Cell[][] {
  return receiptsNewestFirst(receiptsOf(cf) ?? []).map((r) => [
    r.cycle, r.candidate_id, r.office ? OFFICE_LABEL[r.office] ?? r.office : null, r.total_receipts, r.from_individuals,
    r.from_other_committees, r.from_party_committees, r.from_candidate, r.transfers_from_authorised, r.total_disbursements,
    r.cash_on_hand, r.through, candidateUrl(r.candidate_id),
  ]);
}
