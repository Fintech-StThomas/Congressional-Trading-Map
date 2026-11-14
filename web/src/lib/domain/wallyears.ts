// The wall for one year: who was serving, in which party and chamber, and that
// year's measures. Pure and free of runtime imports so tests can load it directly.
import type { WallRow } from "./party";

export type WallMeasure = "cases" | "trades" | "pac" | "oppose";
export const WALL_MEASURES: WallMeasure[] = ["cases", "trades", "pac", "oppose"];

/** wall-years.json as written by the pipeline (docs/data-dictionary.md, WallYears). */
export type WallYearsRaw = {
  years: [number, number];
  cols: string[];
  rows: unknown[][];
  first: { trades: { rep: number; sen: number }; cases: number; money: number };
};

/** [start year, end year, chamber, party, state], inclusive. */
export type YearTerm = [number, number, "sen" | "rep", WallRow["party"], string];

export type MemberYears = { terms: YearTerm[] } & Record<WallMeasure, Map<number, number>>;

export type WallYears = {
  years: [number, number];
  first: WallYearsRaw["first"];
  members: Map<string, MemberYears>;
};

function pairs(flat: unknown): Map<number, number> {
  const m = new Map<number, number>();
  if (!Array.isArray(flat)) return m;
  for (let i = 0; i + 1 < flat.length; i += 2) m.set(Number(flat[i]), Number(flat[i + 1]));
  return m;
}

export function decodeWallYears(raw: WallYearsRaw): WallYears {
  const at = Object.fromEntries(raw.cols.map((c, i) => [c, i]));
  const members = new Map<string, MemberYears>();
  for (const r of raw.rows) {
    members.set(String(r[at.id]), {
      terms: (r[at.terms] as YearTerm[]) ?? [],
      cases: pairs(r[at.cases]), trades: pairs(r[at.trades]), pac: pairs(r[at.pac]), oppose: pairs(r[at.oppose]),
    });
  }
  return { years: raw.years, first: raw.first, members };
}

/** The term in force in `year`: the latest-starting one when two overlap (a switch of party or chamber). */
export function termIn(terms: YearTerm[], year: number): YearTerm | null {
  let best: YearTerm | null = null;
  for (const t of terms) if (t[0] <= year && year <= t[1] && (!best || t[0] >= best[0])) best = t;
  return best;
}

/**
 * The wall rows for one year: only members serving that year, each placed by
 * that year's term, with that year's measures. Base rows supply names and photos.
 */
export function rowsForYear(base: WallRow[], wy: WallYears, year: number): WallRow[] {
  const out: WallRow[] = [];
  for (const r of base) {
    const m = wy.members.get(r.id);
    if (!m) continue;
    const t = termIn(m.terms, year);
    if (!t) continue;
    const [, , chamber, party, state] = t;
    out.push({
      ...r, chamber, party, state,
      district: chamber === "rep" && r.chamber === "rep" && state === r.state ? r.district : null,
      cases: m.cases.get(year) ?? 0, trades: m.trades.get(year) ?? 0, pac: m.pac.get(year) ?? 0, oppose: m.oppose.get(year) ?? 0,
      support: 0,
    });
  }
  return out;
}

/** One scale for every year, so markers stay comparable while the years play. */
export function yearScale(wy: WallYears, measure: WallMeasure): number {
  let max = 1;
  for (const m of wy.members.values()) for (const v of m[measure].values()) if (v > max) max = v;
  return max;
}

/**
 * Words for a year that predates the data for a measure: `none` means show no
 * markers at all; `partial` means markers show, with a caveat.
 */
export function yearGap(measure: WallMeasure, year: number, chamber: "all" | "sen" | "rep", first: WallYearsRaw["first"]):
  { level: "none" | "partial"; text: string } | null {
  const t = first.trades;
  if (measure === "trades" || measure === "cases") {
    const what = measure === "trades" ? "Household trade reports" : "Cases need a household trade, and trade reports";
    if (year < Math.min(t.sen, t.rep))
      return { level: "none", text: `${what} begin in July ${t.sen} (the STOCK Act). Nothing for ${year} exists to show.` };
    const repMissing = year < t.rep;
    if (repMissing && chamber === "rep")
      return { level: "none", text: `House trade filings in this dataset begin in ${t.rep}, so House ${measure} for ${year} cannot be shown.` };
    if (repMissing && chamber === "all")
      return { level: "partial", text: `House trade filings in this dataset begin in ${t.rep}; for ${year} only senators’ ${measure} appear.` };
    if (year === t.sen && chamber !== "rep")
      return { level: "partial", text: `Senate trade reports begin in July ${t.sen}; ${year} is a part year.` };
    return null;
  }
  if (year < first.money) return { level: "none", text: `Campaign-finance records here begin with the ${first.money + 1} cycle.` };
  return null;
}

/** Ids in `prev` that are not in `next`: the prints leaving the wall. */
export function leaving(prev: WallRow[], next: WallRow[]): WallRow[] {
  const keep = new Set(next.map((r) => r.id));
  return prev.filter((r) => !keep.has(r.id));
}
