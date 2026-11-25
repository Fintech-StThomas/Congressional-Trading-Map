// The full file's tables under the shared view state: which rows fall in the year window, which have no date
// (reported apart, never dropped, never in a year), and which trades the assumptions leave out. Pure; tested in
// tests/viewstate.test.mjs. Ties are placed by the years of their records, trades by the chosen date basis.
import type { Cell, Col } from "./records.ts";
import { DEFAULT_ASSUMPTIONS, isDefault, tradeCounts, type Assumptions } from "./assume.ts";
import { overlaps, yearOf, type YearSpan } from "./datebasis.ts";
import type { DateBasis } from "./viewstate.ts";

export type TableKind = "ties" | "trades" | "docs" | "assets" | "liabilities" | "coverage";
export type TableWindow = {
  years: YearSpan | null; basis: DateBasis; assume: Assumptions;
  /** Rows that stay in the table whatever the window says (the selected tie must not vanish). */
  keep?: (row: Cell[]) => boolean;
};
export type TableView = {
  /** Rows to show: in the window (or every row when there is none), minus trades the assumptions leave out. */
  rows: Cell[][];
  /** Rows with no date under this basis, when a window is on; shown apart, never counted as a year. */
  undated: Cell[][];
  /** Trades left out by the assumptions. */
  excluded: number;
  /** Rows the table has before any filter. */
  total: number;
};

const at = (cols: Col[], key: string) => cols.findIndex((c) => c.key === key);

/** The years a row covers, or null when it has none. */
function span(kind: TableKind, cols: Col[], basis: DateBasis): (r: Cell[]) => YearSpan | null {
  if (kind === "ties") {
    const f = at(cols, "first"), l = at(cols, "last");
    return (r) => {
      const a = yearOf(r[f] as string | null), b = yearOf(r[l] as string | null);
      const lo = a ?? b, hi = b ?? a;
      return lo === null || hi === null ? null : [lo, hi];
    };
  }
  if (kind === "trades" || kind === "docs") {
    const i = at(cols, kind === "docs" ? "date" : basis === "public" ? "available" : "date");
    return (r) => {
      const y = yearOf(r[i] as string | null);
      return y === null ? null : [y, y];
    };
  }
  const i = at(cols, "year");
  return (r) => {
    const y = Number(r[i]);
    return r[i] === null || !Number.isInteger(y) ? null : [y, y];
  };
}

/** Apply the shared view to one table. Without a window and with default assumptions the rows pass through unchanged. */
export function viewTable(kind: TableKind, cols: Col[], rows: Cell[][], w: TableWindow, inner = false): TableView {
  // Trade rows a later filing marks Deleted stay listed (marked) but are counted nowhere: they take no part in the
  // assumption count, the year-window count or `total`, and are listed when they fall inside the window.
  const ncAt = kind === "trades" && !inner ? at(cols, "not_counted") : -1;
  const isNc = (r: Cell[]) => ncAt >= 0 && r[ncAt] != null;
  const listedOnly = rows.filter(isNc);
  if (listedOnly.length) {
    rows = rows.filter((r) => !isNc(r));
    const t = viewTable(kind, cols, rows, w, true);
    // Listed-only rows follow the same window; those with no date stay in the undated bucket, marked, not counted.
    const l = viewTable(kind, cols, listedOnly, { ...w, assume: DEFAULT_ASSUMPTIONS }, true);
    return { ...t, rows: [...t.rows, ...l.rows], undated: [...t.undated, ...l.undated] };
  }
  let kept = rows;
  let excluded = 0;
  if (kind === "trades" && !isDefault(w.assume)) {
    const [o, c, lo, late] = ["owner", "asset_class", "low", "late"].map((k) => at(cols, k));
    kept = rows.filter((r) => tradeCounts({ owner: String(r[o] ?? "unspecified"), asset_class: String(r[c] ?? "unknown"), low: (r[lo] as number | null) ?? null, late: (r[late] as boolean | null) ?? null, org: null }, w.assume));
    excluded = rows.length - kept.length;
  }
  if (!w.years) return { rows: kept, undated: [], excluded, total: rows.length };
  const of = span(kind, cols, w.basis);
  const shown: Cell[][] = [], undated: Cell[][] = [];
  for (const r of kept) {
    const s = of(r);
    if (s && overlaps(s, w.years)) shown.push(r);
    else if (w.keep?.(r)) shown.push(r);
    else if (!s) undated.push(r);
  }
  return { rows: shown, undated, excluded, total: rows.length };
}
