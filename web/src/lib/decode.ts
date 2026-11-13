// Turns the compact wire shapes into plain objects, once. Browser and server safe.
import type { Columnar, Edge, EdgeType, LedgerTotals, MemberFileWire, OrgFileWire, Trade, TradeWire } from "./types";

/** A trade as the site uses it: the contract Trade plus the resolved filing URL. */
export type TradeRow = Omit<Trade, "url"> & { url: string | null; ticker_source: string | null };

function isColumnar(v: unknown): v is Columnar {
  return Boolean(v && typeof v === "object" && Array.isArray((v as Columnar).cols) && Array.isArray((v as Columnar).rows));
}

function fromColumns<T>(c: Columnar): T[] {
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
export function decodeTradeFile(f: { cols: string[]; rows: unknown[][]; filings?: Record<string, string> } | null, limit?: number): TradeRow[] {
  if (!f) return [];
  return decodeTrades({ trades: { cols: f.cols, rows: f.rows }, filings: f.filings }, limit);
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
  }));
}

export function ledgerSize(file: { ledger?: Columnar }): number {
  return isColumnar(file.ledger) ? file.ledger.rows.length : 0;
}

/** Edge type -> family, for ties that arrive without a full Edge. */
export const FAMILY_OF: Record<EdgeType, Edge["family"]> = {
  traded: "holding", owns: "holding", position: "holding", traded_together: "holding",
  pac_money: "money", employee_money: "money", lobbyist_money: "money", outside_spending: "money",
  paid_travel: "money", funds: "money", fundraises_with: "money", shared_donors: "money",
  revolving_door: "people", oversees: "people", shared_staff: "people",
  sits_with: "context", legislates_with: "context",
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

/** A link to the official record that can be built from an id alone. */
export function recordUrlFor(id: string): string | null {
  const m = /^pac:(C\d{8})$/.exec(id);
  if (m) return `https://www.fec.gov/data/committee/${m[1]}/`;
  const c = /^co:(\d+)$/.exec(id);
  if (c) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c[1]}`;
  return null;
}
