import type { MemberSummary } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US");

export const NOT_DISCLOSED = "not disclosed";

export function money(n: number | null | undefined): string {
  return n == null ? NOT_DISCLOSED : usd.format(n);
}

function trim(v: number) {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(n / 1e6)}M`;
  if (abs >= 1e5) return `$${Math.round(n / 1e3)}K`;
  return usd.format(n);
}

export type Amount = { low: number | null; high: number | null; exact: number | null };

/** "$15,001–$50,000", "$2,500", or null when nothing was disclosed. */
export function amountText(a: Amount, compact = false): string | null {
  const f = compact ? compactMoney : (n: number) => usd.format(n);
  if (a.exact != null) return f(a.exact);
  if (a.low != null && a.high != null) return a.low === a.high ? f(a.low) : `${f(a.low)}–${f(a.high)}`;
  if (a.low != null) return `${f(a.low)} or more`;
  if (a.high != null) return `up to ${f(a.high)}`;
  return null;
}

export function count(n: number): string {
  return num.format(n);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${num.format(n)} ${n === 1 ? one : many}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date to "14 Mar 2021". Null stays "not disclosed". */
export function date(iso: string | null | undefined): string {
  if (!iso) return NOT_DISCLOSED;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y) return iso;
  if (!m) return String(y);
  return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

export function yearSpan(first: string | null, last: string | null): string {
  const a = first?.slice(0, 4);
  const b = last?.slice(0, 4);
  if (!a && !b) return NOT_DISCLOSED;
  if (!a || !b || a === b) return (a ?? b)!;
  return `${a}–${b}`;
}

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

/** "Senator, California" / "Representative, California 12th" / "Delegate, Guam". */
export function seat(m: Seat, long = true): string {
  const st = long ? stateName(m.state) : m.state;
  if (m.chamber === "sen") return long ? `Senator, ${st}` : `Sen. · ${m.state}`;
  const territory = m.state === "DC" || TERRITORIES.includes(m.state);
  const title = territory ? (m.state === "PR" ? "Resident Commissioner" : "Delegate") : "Representative";
  if (territory || m.district == null) return long ? `${title}, ${st}` : `Rep. · ${m.state}`;
  if (m.district === 0) return long ? `${title}, ${st} at large` : `Rep. · ${m.state}-AL`;
  return long ? `${title}, ${st} ${ordinal(m.district)}` : `Rep. · ${m.state}-${m.district}`;
}

export function served(s: [string, string | null]): string {
  const a = s[0]?.slice(0, 4) ?? "?";
  return s[1] ? `${a}–${s[1].slice(0, 4)}` : `${a}–present`;
}
