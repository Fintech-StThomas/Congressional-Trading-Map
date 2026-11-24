// One all-in total per money kind for a member: full edges plus ledger ties, so a figure never leaves out the
// largest ties. Outside spending is split into "for" and "against" (opposing money is never added to support and
// is never a tie). Sizes follow the wall rule (exact, else high, else low per tie; see pipeline/assemble/wall.py),
// so pac / for / against equal the member's wall.json figures. Pure: no imports beyond types.
import type { Edge, EdgeType, LedgerTotals } from "../types.ts";
import type { LedgerRow } from "../data/decode.ts";

export type Side = "all" | "for" | "against" | "unstated" | "in" | "out";
/** A set of ties: counts, the wall-rule size (null when no tie has an amount) and the disclosed range. */
export type Part = { ties: number; records: number; size: number | null; low: number | null; high: number | null; allExact: boolean };
export type SideTotal = { side: Side; full: Part; ledger: Part; all: Part };
export type KindTotal = {
  type: EdgeType;
  sides: SideTotal[];
  /** Ties counted by ledger_totals but absent from the ledger rows (former members): their side is unknown. */
  unsplit: Part | null;
  /** True when ledger rows were cut: the split lines hold the listed ties only, so their dollars are at least the member's. */
  incomplete: boolean;
};

/** Money kinds shown, in order. Others in the money family follow when present. */
const SPLIT_BY_SIDE: EdgeType[] = ["outside_spending"];
/** Kinds whose ties run both ways: shown as received and paid out, never mixed. */
const SPLIT_BY_DIR: EdgeType[] = ["funds"];
/** Types whose wall figure counts only ties received by the member. */
const RECEIVED_ONLY: EdgeType[] = ["pac_money", "outside_spending"];
const MONEY_TYPES: EdgeType[] = ["pac_money", "outside_spending", "employee_money", "lobbyist_money", "paid_travel", "funds", "fundraises_with", "shared_donors"];

export const emptyPart = (): Part => ({ ties: 0, records: 0, size: null, low: null, high: 0, allExact: true });

type Amt = { exact: number | null; low: number | null; high: number | null };
const rank = (a: Amt): number | null => a.exact ?? a.high ?? a.low;

/** Adds one tie (or one ledger_totals entry, as `ties` ties) to a part. */
function add(p: Part, a: Amt, records: number, ties = 1, exactAll = a.exact != null): Part {
  const r = rank(a);
  const lo = a.exact ?? a.low;
  const hi = a.exact ?? a.high;
  return {
    ties: p.ties + ties, records: p.records + records,
    size: r == null ? p.size : (p.size ?? 0) + r,
    low: lo == null ? p.low : (p.low ?? 0) + lo,
    high: p.high === null || hi == null ? null : p.high + hi,
    allExact: p.allExact && exactAll,
  };
}
export function sumParts(a: Part, b: Part): Part {
  return {
    ties: a.ties + b.ties, records: a.records + b.records,
    size: a.size == null && b.size == null ? null : (a.size ?? 0) + (b.size ?? 0),
    low: a.low == null && b.low == null ? null : (a.low ?? 0) + (b.low ?? 0),
    high: a.high === null || b.high === null ? null : a.high + b.high,
    allExact: a.allExact && b.allExact,
  };
}

/** "for" or "against" from the edge note, else from a via id ending ":support" / ":oppose"; otherwise unstated. */
export function sideOf(note: string | null | undefined, viaId?: string | null): Side {
  const s = note === "support" || note === "oppose" ? note : viaId?.endsWith(":support") ? "support" : viaId?.endsWith(":oppose") ? "oppose" : null;
  return s === "support" ? "for" : s === "oppose" ? "against" : "unstated";
}

type Input = { member: string; edges: Pick<Edge, "type" | "family" | "to" | "note" | "via" | "amount" | "count">[]; ledger: LedgerRow[]; totals: LedgerTotals };

function emptyPartOf(rows: LedgerRow[]): Part {
  return rows.reduce((p, r) => add(p, r, r.count), emptyPart());
}

/** All-in money totals per kind, for the kinds the member has any tie of. */
export function moneyTotals(i: Input): KindTotal[] {
  const out: KindTotal[] = [];
  for (const type of MONEY_TYPES) {
    const edges = i.edges.filter((e) => e.type === type && (!RECEIVED_ONLY.includes(type) || e.to.id === i.member));
    const rows = i.ledger.filter((r) => r.type === type);
    const t = i.totals[type];
    if (!edges.length && !rows.length && !t?.edges) continue;
    const bySide = SPLIT_BY_SIDE.includes(type), byDir = SPLIT_BY_DIR.includes(type), split = bySide || byDir;
    const keyOf = (side: Side): Side => (split ? side : "all");
    const dirKey = (out: boolean): Side => (out ? "out" : "in");
    const full = new Map<Side, Part>(), led = new Map<Side, Part>();
    const put = (m: Map<Side, Part>, side: Side, a: Amt, n: number) => m.set(side, add(m.get(side) ?? emptyPart(), a, n));
    for (const e of edges) put(full, byDir ? dirKey(e.to.id !== i.member) : keyOf(sideOf(e.note, e.via?.id)), e.amount, e.count);
    // A ledger row the member pays (dir out) is not money received: the wall leaves it out too.
    const rowAll = emptyPartOf(rows);
    for (const r of rows) if (!RECEIVED_ONLY.includes(type) || r.dir !== "out") put(led, byDir ? dirKey(r.dir === "out") : keyOf(sideOf(r.note, r.via?.id)), r, r.count);
    // ledger_totals covers every tie that is not a full edge; rows may be cut for former members.
    let unsplit: Part | null = null;
    const missing = t ? t.edges - rows.length : 0;
    if (t && missing > 0) {
      const rowPart = rowAll; // every row, including ones the wall leaves out: the remainder is totals minus all rows
      const left = (v: number | null, r: number | null) => (v == null ? null : Math.max(0, v - (r ?? 0)));
      const size = left(rank(t), rowPart.size);
      unsplit = { ties: missing, records: Math.max(0, t.records - rowPart.records), size, low: left(t.low, rowPart.low), high: t.high == null || rowPart.high == null ? null : Math.max(0, t.high - rowPart.high), allExact: t.exact != null };
      if (!split) { led.set("all", sumParts(led.get("all") ?? emptyPart(), unsplit)); unsplit = null; }
    }
    const sides: Side[] = bySide ? ["for", "against", "unstated"] : byDir ? ["in", "out"] : ["all"];
    const list = sides
      .map((side): SideTotal => {
        const f = full.get(side) ?? emptyPart(), l = led.get(side) ?? emptyPart();
        return { side, full: f, ledger: l, all: sumParts(f, l) };
      })
      .filter((s) => s.all.ties > 0);
    out.push({ type, sides: list, unsplit, incomplete: unsplit !== null });
  }
  return out;
}

/** The three figures wall.json carries for a member, rebuilt from the totals: pac, support (for), oppose (against). */
export function wallFigures(totals: KindTotal[]): { pac: number; support: number; oppose: number } {
  const sz = (t: EdgeType, s: Side) => totals.find((k) => k.type === t)?.sides.find((x) => x.side === s)?.all.size ?? 0;
  return { pac: sz("pac_money", "all"), support: sz("outside_spending", "for"), oppose: sz("outside_spending", "against") };
}

/** A part's amount in words: one figure when every tie is exact, else the disclosed range; never $0 for no amount. */
export function partAmountText(p: Part, fmt: (n: number) => string, none: string): string {
  if (p.size === null && p.low === null) return none;
  if (p.allExact && p.size !== null) return fmt(p.size);
  if (p.low !== null && p.high !== null) return p.low === p.high ? fmt(p.low) : `${fmt(p.low)}–${fmt(p.high)}`;
  if (p.low !== null) return `${fmt(p.low)} or more`;
  return p.high !== null ? `up to ${fmt(p.high)}` : none;
}
