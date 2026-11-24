// "Activity by year" money series: what is counted, stated exactly. Money records are counted only where the data
// gives a single year for them: records on full ties (by_year) and records on further (ledger) ties whose first and
// last year agree. A ledger tie spanning years has no per-year counts, so it is shown separately as a tie with a
// first or last record in the year, never as invented records. Opposing outside spending is not a tie and is left out.
import type { Edge } from "../types.ts";
import type { LedgerRow } from "../data/decode.ts";
import { sideOf } from "./money-totals.ts";

export type YearSeries = { records: Record<number, number>; spanTies: Record<number, number>; multiYearRecords: number };
type E = Pick<Edge, "family" | "note" | "via" | "by_year">;

const yearOf = (d: string | null) => (d ? Number(d.slice(0, 4)) || null : null);

export function moneyYearSeries(edges: E[], ledger: LedgerRow[]): YearSeries {
  const records: Record<number, number> = {}, spanTies: Record<number, number> = {};
  let multiYearRecords = 0;
  for (const e of edges) {
    if (e.family !== "money" || sideOf(e.note, e.via?.id) === "against") continue;
    for (const b of e.by_year) records[b.y] = (records[b.y] ?? 0) + b.n;
  }
  for (const r of ledger) {
    if (r.type === "sits_with" || sideOf(r.note, r.via?.id) === "against") continue;
    const a = yearOf(r.first), b = yearOf(r.last);
    if (a === null || b === null) continue;
    if (a === b) records[a] = (records[a] ?? 0) + r.count;
    else {
      multiYearRecords += r.count;
      spanTies[a] = (spanTies[a] ?? 0) + 1;
      spanTies[b] = (spanTies[b] ?? 0) + 1;
    }
  }
  return { records, spanTies, multiYearRecords };
}

/** Coverage in words for a year; the open year is "in progress", never "complete". */
export function coverWord(cover: "full" | "partial" | "none" | "n/a", year: number, currentYear: number, words: Record<string, string>, inProgress: string): string {
  return year === currentYear && (cover === "full" || cover === "partial") ? inProgress : words[cover];
}
