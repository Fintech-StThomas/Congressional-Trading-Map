// Disclosure timing rules (delays.json): decode the per-member table, re-derive a group from trade rows with
// exactly the pipeline's rules (pipeline/assemble/delays.py), shares that are null (never 0) without a
// denominator, and sort keys. Pure; observed elapsed days only, never a compliance finding.
import type { DelayBands, DelayGroup, DelayMemberCol, Delays } from "../types.ts";
import { fromColumns } from "../data/decode.ts";

/** The five band keys, in order; fixed text from the contract. */
export const BAND_KEYS = ["0-30", "31-45", "46-90", "91-365", "over-365"] as const;
export const MEMBER_BAND_COLS = ["b0_30", "b31_45", "b46_90", "b91_365", "b366_plus"] as const;
/** config.LATE_DAYS in the pipeline: the outer bound the 31-45 / 46-90 bands split on. */
export const THRESHOLD_DAYS = 45;
const OUTER_EDGES = [30, 90, 365] as const;

/** The columns every delays.json has, in the order of the earlier builds. `date_corrected` is the pipeline's LAST column
 *  and absent from archived releases; it is read by name when present, never required (old permalinks stay readable). */
const MEMBER_COLS: DelayMemberCol[] = [
  "id", "count", "dated", ...MEMBER_BAND_COLS, "negative", "undated", "amended", "median", "p90", "max", "first_year", "last_year",
];

/** The minimal trade fields the rules need (a decoded TradeRow satisfies it). `available` tells a withheld lag (date
 *  corrected: both dates present) from a missing date; leave it out and a null lag counts as undated. */
export type DelayTrade = {
  date: string | null; lag_days: number | null; amended: boolean; available?: string | null;
  /** Deleted by a later filing: in no group. */
  notCounted?: boolean;
  /** The file's reason for a withheld lag; undefined when the file has no such map (then both dates and no lag mean date_corrected). */
  lagWithheld?: "date_corrected" | "amended_unmatched" | null;
};

/** One member's row of delays.json, as an object. */
export type DelayMemberRow = {
  id: string; count: number; dated: number;
  b0_30: number; b31_45: number; b46_90: number; b91_365: number; b366_plus: number;
  negative: number; undated: number; amended: number;
  median: number | null; p90: number | null; max: number | null;
  first_year: number | null; last_year: number | null;
  /** null when the file predates the column (those trades are then inside `undated`): never shown as 0. */
  date_corrected: number | null;
  amended_unmatched: number | null;
};

// ---------------------------------------------------------------- the pipeline's rules

/** Index (0..4) of the band a non-negative lag falls in. The second edge is the threshold (45). */
export function bandIndex(lag: number, thresholdDays = THRESHOLD_DAYS): number {
  const edges = [OUTER_EDGES[0], thresholdDays, OUTER_EDGES[1], OUTER_EDGES[2]];
  for (let i = 0; i < edges.length; i++) if (lag <= edges[i]) return i;
  return edges.length;
}

/** Nearest rank: the value at 1-based position ceil(p * n / 100) of an ascending list; null when empty. No interpolation. */
export function nearestRank(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  // Integer ceiling of p*n/100, exact for integer p.
  const pos = Math.floor((p * n + 99) / 100);
  return sorted[Math.max(pos - 1, 0)];
}

type Acc = {
  count: number; bands: number[]; negative: number; undated: number; amended: number; dateCorrected: number; amendedUnmatched: number;
  lags: number[]; years: number[];
};

function accumulate(trades: readonly DelayTrade[], thresholdDays: number): Acc {
  const a: Acc = { count: 0, bands: [0, 0, 0, 0, 0], negative: 0, undated: 0, amended: 0, dateCorrected: 0, amendedUnmatched: 0, lags: [], years: [] };
  for (const t of trades) {
    if (t.notCounted) continue; // deleted by a later filing: listed, counted nowhere
    a.count++;
    if (t.amended) a.amended++;
    if (t.date) a.years.push(Number(String(t.date).slice(0, 4)));
    const lag = t.lag_days;
    if (lag === null || lag === undefined || Number.isNaN(lag)) {
      // Both dates present but no lag: withheld. The file says why (lag_withheld); a file without that map predates the
      // second reason, so there it is a corrected date (see the data dictionary, Trade.lag_days).
      const both = Boolean(t.date && t.available);
      if (both && t.lagWithheld === "amended_unmatched") a.amendedUnmatched++;
      else if (both && t.lagWithheld !== null) a.dateCorrected++;
      else a.undated++;
    } else if (lag < 0) a.negative++;
    else {
      a.bands[bandIndex(lag, thresholdDays)]++;
      a.lags.push(lag);
    }
  }
  a.lags.sort((x, y) => x - y);
  return a;
}

function bandsOf(b: number[]): DelayBands {
  return { "0-30": b[0], "31-45": b[1], "46-90": b[2], "91-365": b[3], "over-365": b[4] };
}

/** One group (a member, a year) re-derived from decoded trade rows: bands, negative and undated counted apart, never banded. */
export function delayGroupFromTrades(trades: readonly DelayTrade[], thresholdDays = THRESHOLD_DAYS): DelayGroup {
  const a = accumulate(trades, thresholdDays);
  return {
    count: a.count, dated: a.count - a.undated - a.dateCorrected - a.amendedUnmatched, bands: bandsOf(a.bands), negative: a.negative, undated: a.undated,
    date_corrected: a.dateCorrected, amended_unmatched: a.amendedUnmatched, amended: a.amended, median: nearestRank(a.lags, 50), p90: nearestRank(a.lags, 90), max: a.lags.length ? a.lags[a.lags.length - 1] : null,
  };
}

/** One member's delays.json row re-derived from their trade file (what the pipeline validator does). */
export function delayRowFromTrades(id: string, trades: readonly DelayTrade[], thresholdDays = THRESHOLD_DAYS): DelayMemberRow {
  const a = accumulate(trades, thresholdDays);
  const g = delayGroupFromTrades(trades, thresholdDays);
  return {
    id, count: g.count, dated: g.dated, b0_30: a.bands[0], b31_45: a.bands[1], b46_90: a.bands[2], b91_365: a.bands[3], b366_plus: a.bands[4],
    negative: g.negative, undated: g.undated, amended: g.amended, median: g.median, p90: g.p90, max: g.max,
    first_year: a.years.length ? Math.min(...a.years) : null, last_year: a.years.length ? Math.max(...a.years) : null,
    date_corrected: a.dateCorrected, amended_unmatched: a.amendedUnmatched,
  };
}

// ---------------------------------------------------------------- shares and counts

/** Trades more than `threshold` days after the transaction date (the bands above 31-45). */
export function overCount(b: DelayBands): number {
  return b["46-90"] + b["91-365"] + b["over-365"];
}

/** n / d as a fraction in [0, 1], or null when there is no denominator (missing is never zero). */
export function share(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Over-45-days trades as a share of dated trades (negative lags are dated, so they are in the denominator). */
export function overShare(over: number, dated: number): number | null {
  return share(over, dated);
}

// ---------------------------------------------------------------- the file

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The members table as objects; [] when the table is missing or does not carry the contract's columns. */
export function decodeDelayMembers(table: Delays["members"] | null | undefined): DelayMemberRow[] {
  if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) return [];
  if (!MEMBER_COLS.every((c) => table.cols.includes(c))) return [];
  return fromColumns<Record<string, unknown>>(table).map((r) => ({
    id: String(r.id), count: num(r.count), dated: num(r.dated),
    b0_30: num(r.b0_30), b31_45: num(r.b31_45), b46_90: num(r.b46_90), b91_365: num(r.b91_365), b366_plus: num(r.b366_plus),
    negative: num(r.negative), undated: num(r.undated), amended: num(r.amended),
    median: numOrNull(r.median), p90: numOrNull(r.p90), max: numOrNull(r.max),
    first_year: numOrNull(r.first_year), last_year: numOrNull(r.last_year),
    date_corrected: table.cols.includes("date_corrected") ? num(r.date_corrected) : null,
    amended_unmatched: table.cols.includes("amended_unmatched") ? num(r.amended_unmatched) : null,
  }));
}

function isGroup(g: unknown): g is DelayGroup {
  const o = g as DelayGroup | null;
  return Boolean(o && typeof o.count === "number" && typeof o.dated === "number" && o.bands && typeof o.bands === "object");
}

/** delays.json as read, or null when it is absent or not the contract's shape (older data builds have none). */
export function readDelays(raw: unknown): Delays | null {
  const d = raw as Delays | null;
  if (!d || typeof d !== "object" || !isGroup(d.totals) || !d.members || !Array.isArray(d.members.cols)) return null;
  if (!d.by_chamber || !isGroup(d.by_chamber.rep) || !isGroup(d.by_chamber.sen)) return null;
  if (!d.by_year || typeof d.by_year !== "object") return null;
  return d;
}

/** The band counts of a member row, in band order. */
export function memberBands(r: DelayMemberRow): number[] {
  return [r.b0_30, r.b31_45, r.b46_90, r.b91_365, r.b366_plus];
}

export function memberOver(r: DelayMemberRow): number {
  return r.b46_90 + r.b91_365 + r.b366_plus;
}

// ---------------------------------------------------------------- the member table

/** A row of the site-wide member table: the file's row plus what the member index adds. */
export type DelayViewRow = {
  id: string; name: string; party: "D" | "R" | "I" | null; place: string | null; state: string | null; chamber: "sen" | "rep" | null; current: boolean | null;
  count: number; dated: number; over: number; overShare: number | null;
  median: number | null; p90: number | null; max: number | null; undated: number; amended: number;
  /** null for a file that predates the column (never shown as 0). */
  dateCorrected: number | null;
  amendedUnmatched: number | null;
};

export type DelaySortKey = "name" | "count" | "dated" | "over" | "overShare" | "median" | "p90" | "max" | "undated" | "amended" | "dateCorrected" | "amendedUnmatched";

export type MemberLabel = { name: string; party: "D" | "R" | "I"; state: string; chamber: "sen" | "rep"; current: boolean };

/** Join the file's rows to the member index; a member missing from the index keeps its id as the name. */
export function viewRows(rows: readonly DelayMemberRow[], who: (id: string) => MemberLabel | undefined): DelayViewRow[] {
  return rows.map((r) => {
    const m = who(r.id);
    const over = memberOver(r);
    return {
      id: r.id, name: m?.name ?? r.id, party: m?.party ?? null,
      place: m ? `${m.state} · ${m.chamber === "sen" ? "Senate" : "House"}${m.current ? "" : " · former"}` : null, state: m?.state ?? null, chamber: m?.chamber ?? null, current: m?.current ?? null,
      count: r.count, dated: r.dated, over, overShare: overShare(over, r.dated),
      median: r.median, p90: r.p90, max: r.max, undated: r.undated, amended: r.amended, dateCorrected: r.date_corrected, amendedUnmatched: r.amended_unmatched,
    };
  });
}

/** Sort a copy: missing values (null) always last whichever way it runs; ties by name then id. */
export function sortViewRows(rows: readonly DelayViewRow[], key: DelaySortKey, desc: boolean): DelayViewRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va === null && vb === null) return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export type DelayFilter = { chamber: "all" | "sen" | "rep"; currentOnly: boolean; query: string };

export function filterViewRows(rows: readonly DelayViewRow[], f: DelayFilter): DelayViewRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) => (f.chamber === "all" || r.chamber === f.chamber) && (!f.currentOnly || r.current === true) && (!q || r.name.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------- CSV

export const DELAY_CSV_HEADERS = [
  "member_id", "member", "party", "state", "chamber", "current", "trades", "dated", "over_45_days", "over_45_days_share_of_dated",
  "median_days", "p90_days", "max_days", "undated", "date_corrected", "amended_unmatched", "amended", "note",
];

function cell(v: string | number | boolean | null): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the rows in view. Missing values are empty cells, never 0; every row carries `note` (the caveat). */
export function delaysCsv(rows: readonly DelayViewRow[], note: string): string {
  const lines = [DELAY_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.name, r.party, r.state, r.chamber, r.current, r.count, r.dated, r.over,
      r.overShare === null ? null : Number(r.overShare.toFixed(4)), r.median, r.p90, r.max, r.undated, r.dateCorrected, r.amendedUnmatched, r.amended, note,
    ].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
