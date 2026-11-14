// Holdings and net worth (House annual reports): types and wording. Browser-safe,
// no runtime imports. Contract: docs/data-dictionary.md, "Holdings and net worth".
import type { Cell, Col } from "./records";

type Table = { cols: string[]; rows: unknown[][] };
export type BandSum = { n: number; unvalued: number; open_ended: number; low: number; high: number | null; high_valued: number | null };
export type NetWorth = {
  low: number | null; high: number | null; high_valued: number | null;
  label: "range" | "valued items only" | "at least" | "unbounded";
  unvalued_assets: number; open_ended_assets: number; open_ended_liabilities: number;
};
export type HoldingsYear = {
  doc: string; assets: Table; liabilities: Table;
  totals: { assets: BandSum; liabilities: BandSum; liabilities_residence_secured: BandSum; assets_by_owner: Record<string, BandSum> };
  net_worth: NetWorth;
};
export type HoldingsFile = {
  member: { id: string; name: string; chamber: "rep"; state: string; party: string };
  net_worth_definition: { name: string; rule: string; excludes: string[]; caveats: string[]; instructions: string };
  docs: Record<string, { url: string; filed: string; amendment: boolean; report_year: number; used: boolean }>;
  years: Record<string, HoldingsYear>;
  portfolio: Table & { year: number };
  coverage: { year: number; status: string }[];
};

export const HOLDINGS_YEARS: [number, number] = [2013, 2025];
export const SENATE_NOTE = "No annual-report data for senators yet: the source has House annual reports only.";

function usd(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
}
export { usd as compactUsd };

/** The figure in words: always a "disclosed net worth range", never "net worth". */
export function netWorthText(nw: NetWorth): string {
  const unval = nw.unvalued_assets ? `; ${nw.unvalued_assets} ${nw.unvalued_assets === 1 ? "item carries" : "items carry"} no value` : "";
  if (nw.label === "range" && nw.low !== null && nw.high !== null) return `${usd(nw.low)} to ${usd(nw.high)}`;
  if (nw.label === "at least" && nw.low !== null) return `at least ${usd(nw.low)}${unval}`;
  if (nw.label === "valued items only" && nw.low !== null && nw.high_valued !== null) return `${usd(nw.low)} to ${usd(nw.high_valued)}, valued items only${unval}`;
  if (nw.low !== null) return `at least ${usd(nw.low)}${unval}`;
  return "not computable (an open-ended liability)";
}

/** Why a year is missing, in words. */
export function coverageWords(status: string): string {
  if (status === "used") return "used";
  if (status === "no_annual_report_in_dataset") return "no annual report in the source";
  if (status.startsWith("not_extracted:")) return `not extracted (${status.slice(14).replace(/_/g, " ")})`;
  return status.replace(/_/g, " ");
}

export function rowsOf<T extends Record<string, unknown>>(t: Table): T[] {
  return t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])) as T);
}

export const ASSET_COLS: Col[] = [
  ["year", "Report year", "num", 80], ["asset", "Asset as filed", "text", 280], ["ticker", "Ticker", "text", 70], ["org", "Org id", "text", 100],
  ["category", "Category", "text", 80], ["owner", "Owner as filed", "text", 100], ["low", "Low $", "num", 100], ["high", "High $", "num", 100],
  ["income_type", "Income type", "text", 120], ["income_low", "Income low $", "num", 100], ["income_high", "Income high $", "num", 100],
  ["location", "Location", "text", 120], ["doc", "Filing id", "text", 90], ["url", "Filing", "links", 120],
].map(([key, label, kind, width]) => ({ key, label, kind, width }) as Col);

export const LIABILITY_COLS: Col[] = [
  ["year", "Report year", "num", 80], ["creditor", "Creditor as filed", "text", 220], ["type", "Type as filed", "text", 200], ["owner", "Owner as filed", "text", 100],
  ["low", "Low $", "num", 100], ["high", "High $", "num", 100], ["incurred", "Incurred", "text", 90], ["residence_secured", "Residence-secured", "bool", 110],
  ["doc", "Filing id", "text", 90], ["url", "Filing", "links", 120],
].map(([key, label, kind, width]) => ({ key, label, kind, width }) as Col);

/** Every asset or liability row across report years, newest year first, with its filing link. */
export function holdingRows(h: HoldingsFile, which: "assets" | "liabilities"): Cell[][] {
  const cols = which === "assets" ? ASSET_COLS : LIABILITY_COLS;
  const out: Cell[][] = [];
  for (const y of Object.keys(h.years).sort().reverse()) {
    for (const r of rowsOf<Record<string, Cell>>(h.years[y][which])) {
      const doc = String(r.doc ?? h.years[y].doc);
      out.push(cols.map((c) => (c.key === "year" ? Number(y) : c.key === "url" ? h.docs[doc]?.url ?? null : (r[c.key] ?? null) as Cell)));
    }
  }
  return out;
}
