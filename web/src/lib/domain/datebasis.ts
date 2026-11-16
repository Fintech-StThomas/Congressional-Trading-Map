// Which date a trade is counted by: the transaction date as filed ("event") or the date the public could first
// see it ("public"). Pure. The two bases are never mixed in one count, and a row without the chosen date goes in an
// "undated" bucket of its own: never dropped, never counted as a year, never filled from the other date.
import type { DateBasis } from "./viewstate.ts";

export type Dated = { date?: string | null; available?: string | null };
export type YearSpan = [number, number];

/** The calendar year of an ISO date, or null when there is none (or it is malformed). */
export function yearOf(iso: string | null | undefined): number | null {
  const m = typeof iso === "string" ? /^(\d{4})-\d{2}-\d{2}/.exec(iso) : null;
  return m ? Number(m[1]) : null;
}

/** The year a trade belongs to under one basis; null = undated under that basis. */
export function basisYear(t: Dated, basis: DateBasis): number | null {
  return yearOf(basis === "public" ? t.available : t.date);
}

export type YearCounts = { byYear: Record<number, number>; undated: number; total: number };

/** Per-year counts under one basis, with the undated rows apart (they add to `total`, not to any year). */
export function countByBasis(rows: Iterable<Dated>, basis: DateBasis): YearCounts {
  const out: YearCounts = { byYear: {}, undated: 0, total: 0 };
  for (const t of rows) {
    out.total++;
    const y = basisYear(t, basis);
    if (y === null) out.undated++;
    else out.byYear[y] = (out.byYear[y] ?? 0) + 1;
  }
  return out;
}

/** Both bases from a columnar trade file (`cols` has date and available), without building row objects. */
export function countWire(f: { cols: string[]; rows: unknown[][] } | null): Record<DateBasis, YearCounts> | null {
  if (!f) return null;
  const d = f.cols.indexOf("date"), a = f.cols.indexOf("available");
  const rows = f.rows.map((r) => ({ date: (d < 0 ? null : (r[d] as string | null)) ?? null, available: (a < 0 ? null : (r[a] as string | null)) ?? null }));
  return { event: countByBasis(rows, "event"), public: countByBasis(rows, "public") };
}

/** Does a span of years overlap the window? */
export function overlaps(span: YearSpan, years: YearSpan): boolean {
  return !(span[1] < years[0] || span[0] > years[1]);
}

/**
 * Rows inside a year window under one basis. With no window every row is kept. With a window, dated rows in it are
 * `shown`, and rows without the chosen date are `undated` (reported apart, not in `shown`, not in any year).
 */
export function splitByYears<T extends Dated>(rows: T[], years: YearSpan | null, basis: DateBasis): { shown: T[]; undated: T[] } {
  const undated: T[] = [];
  if (!years) {
    for (const t of rows) if (basisYear(t, basis) === null) undated.push(t);
    return { shown: rows, undated };
  }
  const shown: T[] = [];
  for (const t of rows) {
    const y = basisYear(t, basis);
    if (y === null) undated.push(t);
    else if (y >= years[0] && y <= years[1]) shown.push(t);
  }
  return { shown, undated };
}
