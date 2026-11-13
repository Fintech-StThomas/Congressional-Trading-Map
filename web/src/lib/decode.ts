// Turns the compact wire shapes into plain objects, once. Browser and server safe.
import type { Columnar, EdgeType, LedgerTotals, MemberFileWire, OrgFileWire, Trade, TradeWire } from "./types";

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

export function tradeCount(file: Pick<MemberFileWire, "trades">): number {
  const t = file.trades;
  return isColumnar(t) ? t.rows.length : Array.isArray(t) ? t.length : 0;
}

/** Decode trades, optionally only the first `limit` rows (newest first, as filed). */
export function decodeTrades(file: Pick<MemberFileWire, "trades" | "filings">, limit?: number): TradeRow[] {
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

export function decodeLedger(file: Pick<MemberFileWire | OrgFileWire, "ledger">): LedgerRow[] {
  const l = file.ledger;
  if (!isColumnar(l)) return [];
  const isOrgSide = l.cols.includes("member");
  return fromColumns<Record<string, unknown>>(l).map((r) => ({
    type: r.type as EdgeType,
    other: String(isOrgSide ? r.member : r.org),
    otherKind: isOrgSide ? "member" : "org",
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

export function ledgerSize(file: Pick<MemberFileWire | OrgFileWire, "ledger">): number {
  return isColumnar(file.ledger) ? file.ledger.rows.length : 0;
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
