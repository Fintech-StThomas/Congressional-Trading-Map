// Turns the compact columnar wire shapes (trades, ledger rows, organisation ties) into plain
// objects, once. Browser and server safe; pure, so tests/decode.test.mjs loads it directly.
import type { Columnar, Edge, EdgeType, LedgerTotals, MemberFileWire, OrgFileWire, Trade, TradeWire } from "../types.ts";

/** A trade as the site uses it: the contract Trade plus the resolved filing URL. */
export type TradeRow = Omit<Trade, "url"> & {
  url: string | null; ticker_source: string | null;
  /** A later House filing marks the transaction Deleted: the row is listed and marked, and counted nowhere (TradeFile.not_counted). */
  notCounted?: boolean;
  /** Why a null lag is null (TradeFile.lag_withheld): a reason, null when the file lists none for this row, undefined when the file has no such map (older builds). */
  lagWithheld?: "date_corrected" | "amended_unmatched" | null;
};

/** The two maps of a trade file that mark rows (both absent in files built before the owner decision of 2026-11-25). */
export type TradeMarks = { not_counted?: Record<string, string> | null; lag_withheld?: Record<string, string> | null };

function isColumnar(v: unknown): v is Columnar {
  return Boolean(v && typeof v === "object" && Array.isArray((v as Columnar).cols) && Array.isArray((v as Columnar).rows));
}

export function fromColumns<T>(c: Columnar): T[] {
  const { cols, rows } = c;
  const out: T[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const o: Record<string, unknown> = {};
    for (let j = 0; j < cols.length; j++) o[cols[j]] = r[j] ?? null;
    out[i] = o as T;
  }
  return out;
}

/** trades/<id>.json: a columnar table plus the filings map. */
export function decodeTradeFile(f: ({ cols: string[]; rows: unknown[][]; filings?: Record<string, string> } & TradeMarks) | null, limit?: number, opts: { listed?: boolean } = {}): TradeRow[] {
  if (!f) return [];
  const rows = decodeTrades({ trades: { cols: f.cols, rows: f.rows }, filings: f.filings }, undefined);
  const out = rows.map((r) => {
    const reason = f.lag_withheld ? f.lag_withheld[r.id] : undefined;
    return {
      ...r,
      ...(f.not_counted && f.not_counted[r.id] ? { notCounted: true } : {}),
      ...(f.lag_withheld ? { lagWithheld: reason === "date_corrected" || reason === "amended_unmatched" ? reason : null } : {}),
    } as TradeRow;
  });
  // By default only counted rows: feeds, /new, the embed card and release comparisons never see a deleted row.
  // The trades table and the full file ask for the listed rows (`listed`), which carry `notCounted`.
  const kept = opts.listed ? out : out.filter((r) => !r.notCounted);
  return limit != null ? kept.slice(0, limit) : kept;
}

/** A trade file with the not-counted rows taken out of its table (for figures computed from the raw columns); the file as published otherwise. */
export function countedWire<T extends { cols: string[]; rows: unknown[][] } & TradeMarks>(f: T | null | undefined): T | null {
  if (!f) return null;
  const nc = f.not_counted;
  if (!nc || !Object.keys(nc).length) return f;
  const at = f.cols.indexOf("id");
  return { ...f, rows: f.rows.filter((r) => !nc[String(r[at])]) };
}

export function tradeCount(file: { trades?: MemberFileWire["trades"] }): number {
  const t = file.trades;
  return isColumnar(t) ? t.rows.length : Array.isArray(t) ? t.length : 0;
}

/** Decode trades, optionally only the first `limit` rows (newest first, as filed). */
export function decodeTrades(file: { trades?: MemberFileWire["trades"]; filings?: Record<string, string> }, limit?: number): TradeRow[] {
  const t = file.trades;
  let list: TradeWire[];
  if (isColumnar(t)) list = fromColumns<TradeWire>(limit != null ? { cols: t.cols, rows: t.rows.slice(0, limit) } : t);
  else list = (Array.isArray(t) ? (limit != null ? t.slice(0, limit) : t) : []) as TradeWire[];
  const filings = file.filings ?? {};
  return list.map((x) => ({
    ...x,
    url: x.url ?? (x.doc ? filings[x.doc] ?? null : null),
    ticker_source: x.ticker_source ?? null,
  }));
}

export type LedgerRow = {
  type: EdgeType;
  /** The other end: an org id on a member's ledger, a member id on an org's. */
  other: string;
  otherKind: "org" | "member";
  via: { id: string; name: string } | null;
  exact: number | null;
  low: number | null;
  high: number | null;
  count: number;
  first: string | null;
  last: string | null;
  note: string | null;
  /** in: this member is the payee; out: the payer; both: undirected (LedgerRow.dir in the contract). */
  dir: "in" | "out" | "both";
};

function viaOf(v: unknown): LedgerRow["via"] {
  if (!v) return null;
  if (typeof v === "string") return { id: v, name: v };
  if (typeof v === "object" && v && "id" in v) {
    const o = v as { id: string; name?: string };
    return { id: o.id, name: o.name ?? o.id };
  }
  return null;
}

/** A member's ledger. Accepts cols with "kind"+"other" (current) or "org" (earlier draft). */
export function decodeLedger(file: { ledger?: Columnar }): LedgerRow[] {
  const l = file.ledger;
  if (!isColumnar(l)) return [];
  const hasKind = l.cols.includes("other");
  const isOrgSide = !hasKind && l.cols.includes("member");
  return fromColumns<Record<string, unknown>>(l).map((r) => ({
    type: r.type as EdgeType,
    other: String(hasKind ? r.other : isOrgSide ? r.member : r.org),
    otherKind: hasKind ? (r.kind === "member" ? "member" : "org") : isOrgSide ? "member" : "org",
    via: viaOf(r.via),
    exact: (r.exact as number | null) ?? null,
    low: (r.low as number | null) ?? null,
    high: (r.high as number | null) ?? null,
    count: Number(r.count ?? 0),
    first: (r.first as string | null) ?? null,
    last: (r.last as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    dir: r.dir === "in" || r.dir === "out" ? r.dir : "both",
  }));
}

export function ledgerSize(file: { ledger?: Columnar }): number {
  return isColumnar(file.ledger) ? file.ledger.rows.length : 0;
}

/** Edge type -> family, for ties that arrive without a full Edge. Fixed by the contract (EdgeType families). */
export const FAMILY_OF: Record<EdgeType, Edge["family"]> = {
  traded: "holding", owns: "holding", traded_together: "holding",
  pac_money: "money", employee_money: "money", lobbyist_money: "money", outside_spending: "money",
  paid_travel: "money", funds: "money", fundraises_with: "money", shared_donors: "money",
  position: "people", revolving_door: "people", shared_staff: "people",
  oversees: "context", sits_with: "context", legislates_with: "context",
};
const ORG_PAYS = new Set<EdgeType>(["pac_money", "employee_money", "lobbyist_money", "outside_spending", "paid_travel"]);

/** A tie drawn from a compact row. `_tie` says where its full record lives, if anywhere. */
export type TieEdge = Edge & { _tie?: { member: string; org: string; edge: string | null } };

/**
 * An organisation's ties. New shape: `ties` columnar rows pointing at full
 * edges in member files. Older shape: full `edges` (kept for compatibility).
 */
export function decodeOrgTies(file: OrgFileWire & { ties?: Columnar }): TieEdge[] {
  const orgId = file.org.id;
  if (isColumnar(file.ties)) {
    return fromColumns<Record<string, unknown>>(file.ties).map((r, i) => {
      const type = r.type as EdgeType;
      const member = String(r.member);
      const m = { kind: "member" as const, id: member };
      const o = { kind: "org" as const, id: orgId };
      const first = (r.first as string | null) ?? "";
      const last = (r.last as string | null) ?? first;
      const count = Number(r.count ?? 0);
      return {
        id: (r.edge as string | null) ?? `tie-${i}-${type}-${member}`,
        type,
        family: FAMILY_OF[type] ?? "money",
        basis: "filed",
        from: ORG_PAYS.has(type) ? o : m,
        to: ORG_PAYS.has(type) ? m : o,
        directed: true,
        via: r.via ? { id: String(r.via), name: String(r.via) } : null,
        amount: { low: (r.low as number | null) ?? null, high: (r.high as number | null) ?? null, exact: (r.exact as number | null) ?? null },
        count,
        first, last,
        by_year: [],
        evidence: [],
        evidence_total: count,
        stat: null,
        weak: false,
        // Org files carry no side for outside spending unless a `note` column exists; null means "not recorded here".
        note: (r.note as string | null) ?? null,
        _tie: { member, org: orgId, edge: (r.edge as string | null) ?? null },
      } satisfies TieEdge;
    });
  }
  return file.edges ?? [];
}

export function orgTieCount(file: OrgFileWire & { ties?: Columnar }): number {
  return isColumnar(file.ties) ? file.ties.rows.length : file.edges?.length ?? 0;
}

export function ledgerTotals(file: { ledger_totals?: LedgerTotals }): LedgerTotals {
  return file.ledger_totals ?? {};
}

/** Number of ties counted in `ledger_totals`, optionally leaving some types out (e.g. sits_with, which is not money). */
export function ledgerTieCount(totals: LedgerTotals | undefined, skip: string[] = []): number {
  return Object.entries(totals ?? {}).reduce((n, [type, t]) => n + (skip.includes(type) ? 0 : t?.edges ?? 0), 0);
}

/**
 * Every tie an organisation has: the listed `ties` rows plus the money ties that only
 * `ledger_totals` counts. The contract says ledger_totals covers the ties NOT listed, so the two add.
 */
export function orgTieTotal(file: OrgFileWire & { ties?: Columnar }): number {
  return orgTieCount(file) + ledgerTieCount(file.ledger_totals);
}

