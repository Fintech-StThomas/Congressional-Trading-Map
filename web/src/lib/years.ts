// The span of years the site draws. YEAR_MAX is the data's current year (wall-years.json `years[1]`),
// inlined at build time by next.config.ts, so server and browser always agree (no hydration mismatch on 1 January).
export const YEAR_MIN = 2000;
export const YEAR_MAX = Number(process.env.NEXT_PUBLIC_YEAR_MAX) || new Date().getFullYear();

/** House annual reports in the holdings source (docs/data-dictionary.md, Holdings and net worth). */
export const HOLDINGS_YEARS: [number, number] = [2013, 2025];
