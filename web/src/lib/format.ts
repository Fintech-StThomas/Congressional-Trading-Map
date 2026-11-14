// Every number, money figure, range, date and seat the site prints goes through here.
// Pure and free of runtime imports (types only), so tests/format.test.mjs loads it directly.
import type { Amount, MemberSummary } from "./types.ts";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US");

export const NOT_DISCLOSED = "not disclosed";

// ---------------------------------------------------------------- money

/** "$12,500"; null stays "not disclosed" (missing is never zero). */
export function money(n: number | null | undefined): string {
  return n == null ? NOT_DISCLOSED : usd.format(n);
}

function trim(v: number) {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

/** "$2.79M", "$364K", "$4,500": short figures for board cards and labels. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(n / 1e6)}M`;
  if (abs >= 1e5) return `$${Math.round(n / 1e3)}K`;
  return usd.format(n);
}

/** "$4.1M", "$118K", "$9.5K", "$750": always short, for the wall, party splits and reach labels. */
export function shortMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return compactMoney(n);
  if (a >= 1e4) return `$${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n)}`;
}

/** "$1.2M", "−$40K": signed short figures for holdings and disclosed net worth (which can be negative). */
export function signedShortMoney(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
}

/**
 * A disclosed amount in words: the exact figure when filed, else the range.
 * "$15,001–$50,000", "$2,500", "$1,000,001 or more" (open-ended), "up to $X", or null when nothing was disclosed.
 * Never a midpoint.
 */
export function amountText(a: Amount, compact = false): string | null {
  const f = compact ? compactMoney : (n: number) => usd.format(n);
  if (a.exact != null) return f(a.exact);
  if (a.low != null && a.high != null) return a.low === a.high ? f(a.low) : `${f(a.low)}–${f(a.high)}`;
  if (a.low != null) return `${f(a.low)} or more`;
  if (a.high != null) return `up to ${f(a.high)}`;
  return null;
}

/** The single figure used to rank or size an amount: exact, else high, else low (the contract's rule). */
export function rankAmount(a: Amount): number | null {
  return a.exact ?? a.high ?? a.low;
}

// ---------------------------------------------------------------- counts

export function count(n: number): string {
  return num.format(n);
}

/** "1 trade", "1,204 trades". */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${num.format(n)} ${n === 1 ? one : many}`;
}

/** "a, b and c" */
export function andList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------- dates

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date to "14 Mar 2021", read from the string (never through Date, so no time-zone shift). Null stays "not disclosed". */
export function date(iso: string | null | undefined): string {
  if (!iso) return NOT_DISCLOSED;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y) return iso;
  if (!m) return String(y);
  return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** "2014–2016" from two ISO dates, one year when they match. */
export function yearSpan(first: string | null, last: string | null): string {
  const a = first?.slice(0, 4);
  const b = last?.slice(0, 4);
  if (!a && !b) return NOT_DISCLOSED;
  if (!a || !b || a === b) return a ?? b ?? NOT_DISCLOSED;
  return `${a}–${b}`;
}

/** "2014–2016" from a [first, last] year pair, one year when they match. */
export function yearRange(years: [number, number]): string {
  return years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`;
}

/** A member's service: "2013–present" or "2001–2011". */
export function served(s: [string, string | null]): string {
  const a = s[0]?.slice(0, 4) ?? "?";
  return s[1] ? `${a}–${s[1].slice(0, 4)}` : `${a}–present`;
}

// ---------------------------------------------------------------- places and seats

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

export const TERRITORIES = ["PR", "GU", "VI", "AS", "MP"];

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

export const PARTY_NAMES = { D: "Democrat", R: "Republican", I: "Independent" } as const;

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type Seat = Pick<MemberSummary, "chamber" | "state" | "district">;

/** "Senator, California" / "Representative, California 12th" / "Delegate, Guam"; short: "Sen. · CA", "Rep. · CA-12". */
export function seat(m: Seat, long = true): string {
  const st = long ? stateName(m.state) : m.state;
  if (m.chamber === "sen") return long ? `Senator, ${st}` : `Sen. · ${m.state}`;
  const territory = m.state === "DC" || TERRITORIES.includes(m.state);
  const title = territory ? (m.state === "PR" ? "Resident Commissioner" : "Delegate") : "Representative";
  if (territory || m.district == null) return long ? `${title}, ${st}` : `Rep. · ${m.state}`;
  if (m.district === 0) return long ? `${title}, ${st} at large` : `Rep. · ${m.state}-AL`;
  return long ? `${title}, ${st} ${ordinal(m.district)}` : `Rep. · ${m.state}-${m.district}`;
}
