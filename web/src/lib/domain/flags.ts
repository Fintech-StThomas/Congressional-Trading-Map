// Review flags: reading flags.json defensively, its rows as objects, the two views (2+ rules, made public in the last
// 30 days), rule masks, the PAC cycle of a trade and the baseline line. Pure; tests/flags.test.mjs loads it directly.
// Missing is never zero: every reader returns null when the field is absent, so pages built from older releases hide
// the feature instead of showing 0.
import type { Edge, FlagDetail, FlagRule, ReviewFlags } from "../types.ts";
import { FALLBACK_STATEMENT, FLAGS, RULE_IDS, RULE_LABEL, type RuleId } from "../copy-flags.ts";
import { percent } from "../format.ts";

export const RECENT_DAYS = 30;

export function isRuleId(x: unknown): x is RuleId {
  return typeof x === "string" && (RULE_IDS as readonly string[]).includes(x);
}

/** flags.json when it has the published shape, else null (older builds have no such file). */
export function readFlags(raw: unknown): ReviewFlags | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<ReviewFlags>;
  if (!Array.isArray(f.rules) || !Array.isArray(f.cols) || !Array.isArray(f.rows) || typeof f.build_date !== "string") return null;
  return { ...(f as ReviewFlags), statement: typeof f.statement === "string" && f.statement ? f.statement : FALLBACK_STATEMENT };
}

/** The statement shown wherever flags are shown: from the data, else the fixed fallback. */
export function statementOf(x: { statement?: unknown } | null | undefined): string {
  return x && typeof x.statement === "string" && x.statement ? x.statement : FALLBACK_STATEMENT;
}

export type FlagRow = {
  member: string; id: string; date: string | null; available: string | null; ticker: string | null; org: string | null;
  action: string; low: number | null; high: number | null; rules: RuleId[];
  owner?: string | null; // owner as filed; undefined when the file has no owner column
};

export function decodeFlagRows(f: Pick<ReviewFlags, "cols" | "rows">): FlagRow[] {
  const at = (k: string) => f.cols.indexOf(k);
  const ix = { member: at("member"), id: at("id"), date: at("date"), available: at("available"), ticker: at("ticker"), org: at("org"), action: at("action"), low: at("low"), high: at("high"), rules: at("rules"), owner: at("owner") };
  const v = (r: unknown[], i: number) => (i < 0 ? null : r[i] ?? null);
  return f.rows.map((r) => ({
    member: String(v(r, ix.member) ?? ""),
    id: String(v(r, ix.id) ?? ""),
    date: v(r, ix.date) as string | null,
    available: v(r, ix.available) as string | null,
    ticker: v(r, ix.ticker) as string | null,
    org: v(r, ix.org) as string | null,
    action: String(v(r, ix.action) ?? "other"),
    low: v(r, ix.low) as number | null,
    high: v(r, ix.high) as number | null,
    rules: (Array.isArray(v(r, ix.rules)) ? (v(r, ix.rules) as unknown[]) : []).filter(isRuleId),
    ...(ix.owner >= 0 ? { owner: v(r, ix.owner) as string | null } : {}),
  }));
}

/** Whole days from ISO date a to ISO date b (b - a), read from the strings in UTC; null when either is missing or malformed. */
export function dayDiff(a: string | null | undefined, b: string | null | undefined): number | null {
  const p = (s: string | null | undefined) => {
    const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const x = p(a), y = p(b);
  return x == null || y == null ? null : Math.round((y - x) / 86400000);
}

/** The contract's window: build_date - 30 < available <= build_date. An undated trade is never in it. */
export function madePublicWithin(available: string | null, buildDate: string, days = RECENT_DAYS): boolean {
  const d = dayDiff(available, buildDate);
  return d != null && d >= 0 && d < days;
}

export type FlagView = "multi" | "recent";

export function selectRows(rows: FlagRow[], view: FlagView, buildDate: string, rule: RuleId | null = null): FlagRow[] {
  return rows.filter((r) => (view === "multi" ? r.rules.length >= 2 : madePublicWithin(r.available, buildDate)) && (!rule || r.rules.includes(rule)));
}

export function ruleMask(rules: readonly string[]): number {
  let m = 0;
  for (const r of rules) {
    const i = (RULE_IDS as readonly string[]).indexOf(r);
    if (i >= 0) m |= 1 << i;
  }
  return m;
}

export function maskRules(mask: number): RuleId[] {
  return RULE_IDS.filter((_, i) => mask & (1 << i));
}

/** A rule's label: from flags.json when given, else the fixed label. */
export function ruleLabel(id: RuleId, rules?: FlagRule[] | null): string {
  return rules?.find((r) => r.id === id)?.label ?? RULE_LABEL[id];
}

/** Met rules of one trade in the fixed order, from TradeFile.flags[tradeId]. */
export function metRules(detail: Record<string, FlagDetail> | null | undefined): RuleId[] {
  return detail ? RULE_IDS.filter((id) => detail[id] !== undefined) : [];
}

/** "x% met; about y% would by chance" when a baseline is published, else null (hidden). */
export function baselineText(rule: FlagRule): string | null {
  const b = rule.baseline;
  const ev = rule.counts?.evaluated;
  if (!b || !ev) return null;
  const share = b.expected_share ?? (b.expected_met != null ? b.expected_met / ev : null);
  if (share == null) return null;
  const met = percent(rule.counts.met / ev);
  return b.kind === "descriptive" ? FLAGS.baselineDescriptive(met, percent(share)) : FLAGS.baseline(met, percent(share));
}

/** The FEC two-year cycle of an ISO date: year + year % 2. */
export function cycleOf(iso: string | null | undefined): number | null {
  const y = iso ? Number(iso.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 0 ? y + (y % 2) : null;
}

export type CycleMoney = { edge: string; via: string | null; low: number; high: number; exact: number | null; n: number; evidence: { date: string | null; label: string; url: string | null }[] };

/** A pac_money edge's records in one cycle (years cycle-1 and cycle); null when nothing falls in it. */
export function pacInCycle(e: Pick<Edge, "id" | "by_year" | "evidence" | "via">, cycle: number): CycleMoney | null {
  const years = (e.by_year ?? []).filter((b) => b.y === cycle || b.y === cycle - 1);
  if (!years.length) return null;
  const sum = (k: "low" | "high") => years.reduce((s, b) => s + (b[k] ?? 0), 0);
  const exact = years.every((b) => b.exact != null) ? years.reduce((s, b) => s + (b.exact ?? 0), 0) : null;
  const inCycle = (d: string | null) => (d ? [cycle - 1, cycle].includes(Number(d.slice(0, 4))) : false);
  return {
    edge: e.id, via: e.via?.name ?? null, low: sum("low"), high: sum("high"), exact, n: years.reduce((s, b) => s + (b.n ?? 0), 0),
    evidence: (e.evidence ?? []).filter((x) => inCycle(x.date)).map((x) => ({ date: x.date, label: x.label, url: x.url ?? null })),
  };
}
