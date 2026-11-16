// Contextual coverage: which limits of the data apply to one member's view (or one tie), each as a separate fact
// with the measure it qualifies. Exact-identifier matches, reviewed matches, statistical derivations, completeness
// and freshness are different facts and are never merged into one sentence or a score. No percentage is written
// here: a share is printed only when meta.json carries the figures it is computed from.
// Pure; tests/coverage.test.mjs loads it directly.
import type { Edge, LedgerTotals, MemberFile, Meta } from "../types.ts";
import { COVERAGE } from "../copy.ts";
import { count, date, percentText, yearRanges } from "../format.ts";
import { coverageWords } from "./holdings.ts";
import { metaBuilt } from "../data/meta.ts";

export type CoverageScope = "holdings" | "trades" | "money" | "orgs" | "values" | "owner";
export type CoverageFact = { id: string; scope: CoverageScope; text: string };

/** What the facts need from meta.json, as plain numbers, so it can cross from the server to the browser. */
export type CoverageMeta = {
  built: string | null;
  /** PAC dollars in the whole build, and those from committees matched to a named company (meta.reports.fec.pac_money_match). */
  pac: { dollars: number; matched: number } | null;
  /** meta.unmatched: trades without a ticker, and trades whose ticker did not resolve. null when not recorded. */
  tradesNoTicker: number | null;
  tradesUnresolvedTicker: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Read the coverage-relevant numbers from meta.json, tolerating any shape: absent fields stay null. */
export function coverageMeta(meta: Meta | null | undefined): CoverageMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  const fec = (m.reports as Record<string, unknown> | undefined)?.fec as Record<string, unknown> | undefined;
  const match = fec?.pac_money_match as Record<string, unknown> | undefined;
  const dollars = num(match?.dollars);
  const matched = num(match?.dollars_matched_to_company);
  const un = m.unmatched as Record<string, unknown> | undefined;
  return {
    built: meta ? metaBuilt(meta) : null,
    pac: dollars !== null && dollars > 0 && matched !== null && matched <= dollars ? { dollars, matched } : null,
    tradesNoTicker: num(un?.trades_without_ticker),
    tradesUnresolvedTicker: num(un?.trades_with_unmatched_ticker),
  };
}

export type TradeValueStats = { total: number; openEnded: number; noValue: number };

/** Count trades filed as open-ended ("over" a figure: low set, high null) and trades with no value at all. */
export function tradeValueStats(t: { cols: string[]; rows: unknown[][] } | null | undefined): TradeValueStats | null {
  if (!t || !Array.isArray(t.cols) || !Array.isArray(t.rows)) return null;
  const lo = t.cols.indexOf("low"), hi = t.cols.indexOf("high");
  if (lo < 0 || hi < 0) return null;
  let openEnded = 0, noValue = 0;
  for (const r of t.rows) {
    const low = r[lo] ?? null, high = r[hi] ?? null;
    if (low === null && high === null) noValue++;
    else if (low !== null && high === null) openEnded++;
  }
  return { total: t.rows.length, openEnded, noValue };
}

export type CoverageInput = {
  member: { terms: { chamber: "sen" | "rep" }[]; served: [string, string | null] };
  coverage: MemberFile["coverage"];
  tradeSummary: { count: number; by_owner: Record<string, number> } | null | undefined;
  edges: Pick<Edge, "type" | "family" | "basis">[];
  ledgerTotals?: LedgerTotals | null;
  /** The holdings file's coverage list, or null when the member has no holdings file. */
  holdings: { coverage: { year: number; status: string }[] } | null;
  meta: CoverageMeta;
  tradeValues: TradeValueStats | null;
};

type Status = "full" | "partial" | "none" | "n/a";

function yearsWith(cov: { year: number; trades?: Status; money?: Status }[], key: "trades" | "money", status: Status, within: [number, number] | null): number[] {
  return cov.filter((c) => c[key] === status && (!within || (c.year >= within[0] && c.year <= within[1]))).map((c) => c.year);
}

/** The facts that apply to this member, in a fixed order. */
export function coverageFacts(i: CoverageInput): CoverageFact[] {
  const out: CoverageFact[] = [];
  const add = (id: string, scope: CoverageScope, text: string) => out.push({ id, scope, text });
  const chambers = new Set(i.member.terms.map((t) => t.chamber));

  // ---- holdings: missing is not none
  if (!i.holdings) {
    add(chambers.has("rep") ? "holdings-house-none" : "holdings-senate", "holdings", chambers.has("rep") ? COVERAGE.houseNoReport : COVERAGE.senateHoldings);
  } else {
    const missing = i.holdings.coverage.filter((c) => c.status !== "used");
    if (missing.length) {
      const groups = new Map<string, number[]>();
      for (const c of missing) groups.set(coverageWords(c.status), [...(groups.get(coverageWords(c.status)) ?? []), c.year]);
      const list = [...groups.entries()].map(([why, ys]) => `${yearRanges(ys)} (${why})`).join("; ");
      add("holdings-years", "holdings", COVERAGE.holdingsMissing(list));
    }
    if (chambers.has("sen")) add("holdings-senate-years", "holdings", COVERAGE.senateYears);
  }

  // ---- completeness by year (n/a only inside the years served, where it means "no reports existed")
  const first = Number(i.member.served[0]?.slice(0, 4)) || 0;
  const last = i.member.served[1] ? Number(i.member.served[1].slice(0, 4)) : 9999;
  const within: [number, number] = [first, last];
  const years = (key: "trades" | "money", s: Status) => yearsWith(i.coverage ?? [], key, s, s === "n/a" ? within : null);
  const group = (id: string, scope: CoverageScope, ys: number[], text: (y: string) => string) => {
    if (ys.length) add(id, scope, text(yearRanges(ys)));
  };
  group("trades-partial", "trades", years("trades", "partial"), COVERAGE.tradesPartial);
  group("trades-none", "trades", years("trades", "none"), COVERAGE.tradesNone);
  group("trades-na", "trades", years("trades", "n/a"), COVERAGE.tradesNa);
  group("money-partial", "money", years("money", "partial"), COVERAGE.moneyPartial);
  group("money-none", "money", years("money", "none"), COVERAGE.moneyNone);
  group("money-na", "money", years("money", "n/a"), COVERAGE.moneyNa);

  // ---- freshness
  const nTrades = i.tradeSummary?.count ?? 0;
  if (nTrades > 0 || (i.coverage ?? []).length) {
    add("fresh", "trades", i.meta.built ? COVERAGE.fresh(date(i.meta.built)) : COVERAGE.freshUnknown);
  }

  // ---- owner and values
  const unspecified = i.tradeSummary?.by_owner?.unspecified ?? 0;
  if (unspecified > 0) add("owner-unspecified", "owner", COVERAGE.owner(unspecified, count(nTrades)));
  if (i.tradeValues && i.tradeValues.openEnded > 0) add("values-open-ended", "values", COVERAGE.openEnded(count(i.tradeValues.openEnded)));
  if (i.tradeValues && i.tradeValues.noValue > 0) add("values-no-value", "values", COVERAGE.noValue(count(i.tradeValues.noValue)));

  // ---- statistical derivation (a different kind of tie from a filed record)
  const derived = i.edges.filter((e) => e.basis === "derived");
  if (derived.some((e) => e.family === "money")) add("derived-money", "money", COVERAGE.derivedMoney);
  if (derived.some((e) => e.family !== "money")) add("derived-trades", "trades", COVERAGE.derivedTrades);

  // ---- organisations: how a match is made (exact vs reviewed), and what is left unattached
  const orgTies = i.edges.length > 0 || Object.keys(i.ledgerTotals ?? {}).length > 0;
  if (orgTies) {
    add("orgs-exact", "orgs", COVERAGE.orgsExact);
    add("orgs-reviewed", "orgs", COVERAGE.orgsReviewed);
  }
  const noTicker = i.meta.tradesNoTicker, unresolved = i.meta.tradesUnresolvedTicker;
  if ((noTicker ?? 0) > 0 || (unresolved ?? 0) > 0) {
    add("orgs-ticker", "orgs", COVERAGE.orgsTicker(noTicker ? count(noTicker) : null, unresolved ? count(unresolved) : null));
  }
  const hasPac = i.edges.some((e) => e.type === "pac_money") || Boolean(i.ledgerTotals?.pac_money);
  if (hasPac && i.meta.pac) add("orgs-pac-share", "money", COVERAGE.pacShare(percentText(i.meta.pac.matched / i.meta.pac.dollars)));
  return out;
}

/** The facts that apply to one tie (shown in the evidence drawer and recorded in its citation). */
export function edgeFacts(edge: Edge, ledgerOnly: boolean): CoverageFact[] {
  const out: CoverageFact[] = [];
  const add = (id: string, scope: CoverageScope, text: string) => out.push({ id, scope, text });
  if (ledgerOnly) add("tie-ledger-only", "orgs", COVERAGE.tie.ledgerOnly);
  if (edge.basis === "derived") add("tie-derived", edge.family === "money" ? "money" : "trades", COVERAGE.tie.derived);
  if (edge.weak) add("tie-weak", "orgs", COVERAGE.tie.weak);
  if (!ledgerOnly && edge.evidence_total > edge.evidence.length) add("tie-partial-list", "orgs", COVERAGE.tie.partialList);
  const a = edge.amount;
  if (a.exact === null && a.low === null && a.high === null) add("tie-no-amount", "values", COVERAGE.tie.noAmount);
  else if (a.exact === null && a.low !== null && a.high === null) add("tie-open-ended", "values", COVERAGE.tie.openEnded);
  if ([edge.from, edge.to].some((n) => n.kind === "org" && /^pac:/.test(n.id))) add("tie-committee", "orgs", COVERAGE.tie.committee);
  return out;
}

/** Facts for one place on a page, in their fixed order. */
export function factsFor(facts: CoverageFact[], scopes: CoverageScope[]): CoverageFact[] {
  return facts.filter((f) => scopes.includes(f.scope));
}
