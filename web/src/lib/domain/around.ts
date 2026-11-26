// What "Around this trade" may say about one trade, from what the page can see: which review-flag rules could not be
// checked for it (only reasons visible in the trade row and the member file; a rule that needs data the page does not
// load, such as the company's SIC code, is not listed), and the member's PAC money ties from the trade's company in
// its two-year cycle, from full edges (records by year) and ledger rows (totals with first and last dates only).
// Missing is never zero: a ledger row whose dates straddle the cycle is "may fall in the cycle", never in or out.
// Pure; tests/around.test.mjs loads it directly.
import type { TradeRow } from "../data/decode.ts";
import type { LedgerRow } from "../data/decode.ts";
import { AROUND, RULE_LABEL, type RuleId } from "../copy-flags.ts";
import { pacInCycle, type CycleMoney } from "./flags.ts";
import type { Edge } from "../types.ts";

/** A trade file from a build that ran the review flags (an object `flags`); older releases have none, and then no
 * part of the flags or the Around panel is shown. */
export function hasFlags(tf: { flags?: unknown } | null | undefined): boolean {
  return Boolean(tf && tf.flags && typeof tf.flags === "object" && !Array.isArray(tf.flags));
}

/** First day the committee rosters cover (config.FLAGS_COMMITTEE_FROM). */
export const COMMITTEE_FROM = "2025-01-03";

export type CheckContext = { fec: boolean; current: boolean };
export type NotChecked = { rule: RuleId; reason: string };

/** Rules that were not checked for this trade, for a reason visible in the row (and the member's FEC id and status). */
export function notChecked(t: Pick<TradeRow, "date" | "lag_days" | "low" | "ticker" | "org" | "action" | "asset_class">, c: CheckContext): NotChecked[] {
  const R = AROUND.reasons;
  const isCo = Boolean(t.org?.startsWith("co:"));
  const out: NotChecked[] = [];
  const add = (rule: RuleId, reason: string | null) => { if (reason) out.push({ rule, reason }); };
  add("late", t.lag_days == null ? R.noLag : null);
  add("large_amount", t.low == null ? R.noRange : null);
  add("pile_on", !t.date ? R.noDate : !t.ticker || !t.org ? R.noTicker : t.action !== "buy" && t.action !== "sell" ? R.notBuySell
    : t.asset_class === "fund" || t.asset_class === "bond" ? R.fundOrBond : null);
  add("money_both_ways", !t.date ? R.noDate : !isCo ? R.noCompany : !c.fec ? R.noFec : null);
  add("sector_overseen", !c.current ? R.former : !t.date || t.date < COMMITTEE_FROM ? R.beforeRoster : !isCo ? R.noCompany
    : t.asset_class === "fund" ? R.fund : null);
  return out;
}

/** "Not checked for this trade: <label> (<reason>); ..." or null when every rule could be checked as far as the page can tell. */
export function notCheckedText(list: NotChecked[]): string | null {
  return list.length ? AROUND.notChecked(list.map((x) => `${RULE_LABEL[x.rule]} (${x.reason})`).join("; ")) : null;
}

/** A ledger row's money as the panel lists it: the tie's totals, and whether its dates lie inside the cycle. */
export type LedgerMoney = { via: string | null; viaId: string | null; low: number | null; high: number | null; exact: number | null; n: number; first: string | null; last: string | null; whole: boolean };

export type PacTies = { edges: CycleMoney[]; ledger: LedgerMoney[] };

/** The member's pac_money ties from `org` with a record in the cycle (full edges) or dates touching it (ledger rows). */
export function pacTies(org: string, cycle: number, edges: Pick<Edge, "id" | "by_year" | "evidence" | "via">[], ledger: LedgerRow[]): PacTies {
  const years = [cycle - 1, cycle];
  const yr = (d: string | null) => (d ? Number(d.slice(0, 4)) : NaN);
  const out: PacTies = { edges: edges.map((e) => pacInCycle(e, cycle)).filter((x): x is CycleMoney => x !== null), ledger: [] };
  for (const r of ledger) {
    if (r.type !== "pac_money" || r.otherKind !== "org" || r.other !== org || r.dir !== "in") continue;
    const f = yr(r.first), l = yr(r.last);
    if (!Number.isFinite(f) || !Number.isFinite(l) || l < years[0] || f > years[1]) continue;
    const via = !r.via ? null : r.via.name && r.via.name !== r.via.id ? r.via.name : `FEC committee ${r.via.id.replace(/^pac:/, "")}`;
    out.ledger.push({ via, viaId: r.via?.id ?? null, low: r.low, high: r.high, exact: r.exact, n: r.count, first: r.first, last: r.last, whole: f >= years[0] && l <= years[1] });
  }
  return out;
}

/** The FEC page of a committee id carried as `pac:<id>` (provenance of a ledger row is derived, not stored). */
export function fecCommitteeUrl(viaId: string | null): string | null {
  const m = viaId ? /^pac:(C\d{8})$/.exec(viaId) : null;
  return m ? `https://www.fec.gov/data/committee/${m[1]}/` : null;
}

/** Which sentence the PAC block shows when it lists nothing: never "none" for a trade the money rule flagged. */
export function pacEmptyKind(flagged: boolean, trimmed: boolean): "flagged" | "trimmed" | "none" {
  return flagged ? "flagged" : trimmed ? "trimmed" : "none";
}
