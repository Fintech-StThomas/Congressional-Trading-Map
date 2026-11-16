// Position timelines, the change since the first report, and leverage (House annual reports): types, decoding,
// sorting, filtering and wording rules. Browser-safe, no runtime imports beyond lib. Contract:
// docs/data-dictionary.md, "Holdings and net worth" (Position timelines; Change since first report; Leverage).
import type { Cell, Col } from "./records.ts";
import { signedShortMoney as usd } from "../format.ts";
import { POSITION_CLASSES } from "../copy.ts";

type Table = { cols: string[]; rows: unknown[][] };
const objs = <T,>(t: Table): T[] => t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])) as T);

export type Owner = "unspecified" | "spouse" | "joint" | "dependent" | "self";
export type Kind = "stock" | "fund" | "bond" | "option" | "unlabelled";
export type TransitionClass =
  | "consistent" | "unexplained_appearance" | "unexplained_disappearance" | "band_change_no_trade" | "contrary"
  | "traded_same_band" | "unchanged" | "not_comparable" | "traded_while_unlisted";
export type StatusCode = ["throughout", number, number] | ["from" | "until" | "again", number];

export type PositionsSummary = {
  assets: number; assets_with_trades: number; share_with_trades: number | null;
  transitions: Record<TransitionClass, number>;
  trades_matched: number; trades_before_first_report: number; trades_after_latest_report: number;
  trades_in_unlisted_assets: number; trades_undated: number;
};
export type PositionsFile = {
  member: string; source: string; years: number[];
  coverage: { year: number; status: string }[];
  docs: Record<string, string>;          // annual report id -> official PDF
  filings: Record<string, string | null>; // trade report id -> official PDF
  assets: Table; snapshots: Table; trades: Table; transitions: Table;
  summary: PositionsSummary;
};
export type Snap = { year: number; low: number; high: number | null; lines: number; unvalued: number; open_ended: number; owners: Owner[]; rows: string[]; doc: string };
export type PTrade = { id: string; date: string; action: "buy" | "sell" | "exchange" | "other"; low: number | null; high: number | null; owner: Owner; doc: string };
export type Transition = { from: number; to: number; gap: number; change: string | null; buys: number; sells: number; exchanges: number; sold_last_listed_year: number; class: TransitionClass; owner_change: boolean };
export type Position = {
  i: number; key: string; name: string; org: string | null; ticker: string | null; kind: Kind;
  first: number; last: number; years: number[]; trades: number; latest_low: number; latest_high: number | null;
  status: StatusCode[]; snaps: Map<number, Snap>; tradeList: PTrade[]; transitions: Transition[];
};

/** Columnar tables -> one object per asset with its snapshots, trades and transitions attached. */
export function decodePositions(p: PositionsFile): Position[] {
  const assets = objs<Omit<Position, "i" | "snaps" | "tradeList" | "transitions">>(p.assets).map((a, i) =>
    ({ ...a, i, snaps: new Map<number, Snap>(), tradeList: [] as PTrade[], transitions: [] as Transition[] }));
  for (const s of objs<Snap & { a: number }>(p.snapshots)) assets[s.a]?.snaps.set(s.year, s);
  for (const t of objs<PTrade & { a: number }>(p.trades)) assets[t.a]?.tradeList.push(t);
  for (const x of objs<Transition & { a: number }>(p.transitions)) assets[x.a]?.transitions.push(x);
  return assets;
}

/** A value band in words; a line without a value makes the upper bound unknown (range rules). */
export function bandText(low: number | null, high: number | null, unvalued = 0): string {
  if (low === null) return "no value given";
  if (unvalued) return low > 0 ? `at least ${usd(low)} (a line has no value)` : "no value given";
  if (high === null) return `over ${usd(Math.max(0, low - 1))}`;
  return `${usd(low)}–${usd(high)}`;
}

/** The status rule's codes in words: "held throughout", "appears from", "no longer listed after", "listed again in". */
export function statusText(s: StatusCode[]): string {
  return s.map((c) => c[0] === "throughout" ? `held throughout ${c[1] === c[2] ? c[1] : `${c[1]}–${c[2]}`}`
    : c[0] === "from" ? `appears from ${c[1]}` : c[0] === "until" ? `no longer listed after ${c[1]}` : `listed again in ${c[1]}`).join("; ");
}

// Official bands' lower bounds: the mark's size is the band's rank, not its dollar value (bands are not to scale).
const BAND_LOWS = [1, 1001, 15001, 50001, 100001, 250001, 500001, 1000001, 5000001, 25000001, 50000001];
export function bandRank(low: number): number {
  let r = 0;
  for (let i = 0; i < BAND_LOWS.length; i++) if (low >= BAND_LOWS[i]) r = i;
  return r / (BAND_LOWS.length - 1);
}

export type SortKey = "value" | "first" | "trades";
export type FilterKey = "all" | "stock" | "fund" | "traded";
export function sortPositions(xs: Position[], k: SortKey): Position[] {
  const v = (p: Position) => [p.last, p.latest_low, p.latest_high ?? Infinity] as const;
  return [...xs].sort((a, b) => {
    if (k === "first") return a.first - b.first || b.latest_low - a.latest_low || a.name.localeCompare(b.name);
    if (k === "trades") return b.trades - a.trades || b.latest_low - a.latest_low || a.name.localeCompare(b.name);
    const [la, lo, hi] = v(a), [lb, lo2, hi2] = v(b);
    return lb - la || lo2 - lo || hi2 - hi || a.name.localeCompare(b.name);
  });
}
export function filterPositions(xs: Position[], f: FilterKey): Position[] {
  if (f === "stock") return xs.filter((p) => p.kind === "stock");
  if (f === "fund") return xs.filter((p) => p.kind === "fund");
  if (f === "traded") return xs.filter((p) => p.trades > 0);
  return xs;
}

/** Year columns for the grid: every year from the first to the last report the member could have filed. */
export function gridYears(p: PositionsFile): number[] {
  const ys = [...p.coverage.map((c) => c.year), ...p.years];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** What a year without a snapshot means for this member: no report available, or not in office. */
export function yearState(p: PositionsFile, y: number): "report" | "no_report" | "not_serving" {
  if (p.years.includes(y)) return "report";
  return p.coverage.some((c) => c.year === y) ? "no_report" : "not_serving";
}

// ---------------------------------------------------------------- records view: the full transition table
export const TRANSITION_COLS: Col[] = [
  ["asset", "Asset", "text", 240], ["key", "Asset key", "text", 140], ["kind", "Class", "text", 80],
  ["from", "From report", "num", 90], ["to", "To report", "num", 80], ["gap", "Years with no report between", "num", 120],
  ["from_band", "Band then", "text", 130], ["to_band", "Band now", "text", 130], ["change", "Band change", "text", 90],
  ["buys", "Purchases filed", "num", 90], ["sells", "Sales filed", "num", 80], ["exchanges", "Exchanges filed", "num", 90],
  ["sold_last_listed_year", "Sales in last listed year", "num", 110], ["class", "Class of transition", "text", 220],
  ["owner_change", "Owner changed", "bool", 90], ["urls", "Annual reports", "links", 160],
].map(([key, label, kind, width]) => ({ key, label, kind, width }) as Col);

export function transitionRows(p: PositionsFile, xs: Position[]): Cell[][] {
  const out: Cell[][] = [];
  for (const a of xs) {
    for (const x of a.transitions) {
      const sa = a.snaps.get(x.from), sb = a.snaps.get(x.to);
      const urls = [p.docs[sa?.doc ?? ""], p.docs[sb?.doc ?? ""]].filter(Boolean).join(" ");
      out.push([a.name, a.key, a.kind, x.from, x.to, x.gap, sa ? bandText(sa.low, sa.high, sa.unvalued) : "not listed",
        sb ? bandText(sb.low, sb.high, sb.unvalued) : "not listed", x.change, x.buys, x.sells, x.exchanges,
        x.sold_last_listed_year, POSITION_CLASSES[x.class]?.label ?? x.class, x.owner_change, urls || null]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- change since first report, leverage
export type RangeFig = { low: number | null; high: number | null; high_valued: number | null; label: string };
export type TenureChange = {
  first_year: number; latest_year: number; years_between: number; reports_between: number;
  first: RangeFig; latest: RangeFig; change: { low: number | null; high: number | null };
  known: boolean; comparable: boolean; doc_first: string; doc_latest: string;
};
export type Leverage = {
  by_year: Table; buckets: Record<string, string>;
  recurring_creditors: Table; margin_loans: Table; bucket_rows: Record<string, number>;
};
export type LevYear = { year: number; n: number; low: number; high: number | null; residence_low: number; residence_high: number | null;
  share_low: number | null; share_high: number | null; by_type: Record<string, [number, number, number | null]> };
export type MarginRow = { year: number; creditor: string; type: string; owner: string; low: number; high: number | null; doc: string };
export const levYears = (l: Leverage) => objs<LevYear>(l.by_year);
export const marginRows = (l: Leverage) => objs<MarginRow>(l.margin_loans);
export const recurringCreditors = (l: Leverage) => objs<{ creditor: string; years: number[] }>(l.recurring_creditors);

function figText(f: RangeFig): string {
  if (f.label === "range" && f.low !== null && f.high !== null) return `${usd(f.low)} to ${usd(f.high)}`;
  if (f.label === "valued items only" && f.low !== null && f.high_valued !== null) return `${usd(f.low)} to ${usd(f.high_valued)} (valued items only)`;
  if (f.low !== null) return `at least ${usd(f.low)}`;
  return "not computable";
}

/** The "Change since first report" statement, worded from the rule: ranges only, no percentages, no rates. */
export function tenureText(t: TenureChange): { lead: string; change: string; caveat: string | null } {
  const lead = `Disclosed net worth range in ${t.first_year}: ${figText(t.first)}. In ${t.latest_year}: ${figText(t.latest)}.`;
  const span = `${t.years_between} ${t.years_between === 1 ? "year" : "years"} apart`;
  const change = t.known && t.change.low !== null && t.change.high !== null
    ? `The filings allow any change between ${usd(t.change.low)} and ${usd(t.change.high)} over those ${span.replace(" apart", "")}.`
    : `The change cannot be stated as a range (${span}): at least one of the two figures is not a full range, because a band is open-ended or an item carries no value.`;
  const caveat = t.comparable ? null
    : `The two years are not directly comparable: ${t.first_year} is “${t.first.label}” and ${t.latest_year} is “${t.latest.label}”.`;
  return { lead, change, caveat };
}

export function shareText(lo: number | null, hi: number | null): string {
  const pc = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  if (lo === null && hi === null) return "not computable";
  if (lo === null) return `up to ${pc(hi!)}`;
  if (hi === null) return `at least ${pc(lo)}`;
  return `${pc(lo)}–${pc(hi)}`;
}
