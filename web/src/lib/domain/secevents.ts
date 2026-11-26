// SEC 8-K events beside a trade: item codes in plain words, the filings within 30 days either side of a trade date,
// and what the coverage lets the page say. Never "no filings" unless the company's coverage is complete over the whole
// window; an org file without `sec_coverage` means "not available". Pure; tests/flags.test.mjs loads it directly.
import type { SecCoverage, SecEvent } from "../types.ts";
import { AROUND, SEC_ITEM_LABEL } from "../copy-flags.ts";
import { date } from "../format.ts";
import { dayDiff } from "./flags.ts";

export const SEC_WINDOW_DAYS = 30;

/** "Entered a material agreement" for "1.01"; unknown codes read "Item <code>". */
export function itemLabel(code: string): string {
  return SEC_ITEM_LABEL[code] ?? `Item ${code}`;
}

/** Shift an ISO date by whole days (UTC, read from the string). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Events filed within `days` (inclusive) before or after the trade date, by date, each with its offset in days. */
export function eventsNear(events: SecEvent[] | null | undefined, tradeDate: string | null, days = SEC_WINDOW_DAYS): (SecEvent & { offset: number })[] {
  if (!events || !tradeDate) return [];
  const out: (SecEvent & { offset: number })[] = [];
  for (const e of events) {
    const off = dayDiff(tradeDate, e.date);
    if (off != null && Math.abs(off) <= days) out.push({ ...e, offset: off });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.accepted ?? "").localeCompare(b.accepted ?? "") || a.accession.localeCompare(b.accession));
}

export type SecState =
  | { kind: "no_company" }   // not an SEC company (no co: org)
  | { kind: "unavailable" }  // no sec_coverage: fetch failed, stage not run, older release
  | { kind: "undated" }      // no transaction date: no window
  | { kind: "outside"; from: string; to: string } // the window is not inside the span read
  | { kind: "partial"; from: string }             // inside the span, but older pages failed
  | { kind: "complete" };    // the list is complete over the window: an empty list means no 8-K was filed

/** What the coverage allows the panel to say about one trade's window. */
export function secState(org: string | null | undefined, coverage: SecCoverage | null | undefined, tradeDate: string | null, days = SEC_WINDOW_DAYS): SecState {
  if (!org || !org.startsWith("co:")) return { kind: "no_company" };
  if (!coverage || typeof coverage.from !== "string" || typeof coverage.to !== "string") return { kind: "unavailable" };
  if (!tradeDate) return { kind: "undated" };
  const lo = addDays(tradeDate, -days), hi = addDays(tradeDate, days);
  if (lo < coverage.from || hi > coverage.to) return { kind: "outside", from: coverage.from, to: coverage.to };
  if (!coverage.complete) return { kind: "partial", from: coverage.from };
  return { kind: "complete" };
}

/** The sentence for a state, or null when the list speaks for itself. `empty`: no event was found in the window. */
export function secStateText(s: SecState, empty: boolean): string | null {
  switch (s.kind) {
    case "no_company": return AROUND.secNoCompany;
    case "unavailable": return AROUND.secUnavailable;
    case "undated": return AROUND.secNoDate;
    case "outside": return AROUND.secOutside(date(s.from), date(s.to));
    case "partial": return empty ? AROUND.secMaybe : AROUND.secPartial(date(s.from));
    case "complete": return empty ? AROUND.secNone : null;
  }
}

/** The filing folder on EDGAR for an accession number of a co:<CIK> org (used when the org file is not loaded). */
export function secFilingUrl(org: string | null | undefined, accession: string): string | null {
  const cik = org && /^co:(\d+)$/.exec(org)?.[1];
  if (!cik || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
}

/** A registrant name as people search for it: SEC state tags ("/DE/") and legal suffixes dropped. */
export function searchName(name: string): string {
  return name
    .replace(/\/[A-Z]{2,3}\/?/g, " ")
    .replace(/[,.]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|holdings?|group|the|new)\b/gi, " ")
    .replace(/&\s*$/, "")
    .replace(/\s+/g, " ")
    .trim() || name.trim();
}

/** A news search for the company name over the trade date ±14 days (Google News date range). Only a link; nothing is stored. */
export function newsSearchUrl(name: string, tradeDate: string | null, days = 14): string | null {
  const q = searchName(name);
  if (!q) return null;
  const base = `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(q)}`;
  if (!tradeDate) return base;
  const us = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}/${d}/${y}`;
  };
  return `${base}&tbs=${encodeURIComponent(`cdr:1,cd_min:${us(addDays(tradeDate, -days))},cd_max:${us(addDays(tradeDate, days))}`)}`;
}
