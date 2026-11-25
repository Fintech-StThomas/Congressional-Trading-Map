// Compares one member's records between two archived data releases: trades (by event id), member-file ties (by edge
// id) and holdings (by report year). Pure and deterministic, no I/O. Rules (docs/PRODUCT-PLAN.md, R2.2):
//   * a higher filing `version` is a new filing version; the same version with a differing field is a source or
//     extraction change, never called an amendment;
//   * a record missing from the later release is "no longer in the data", never a sale or anything about the member;
//   * a record or year absent from a release is "not in that release's data", never zero;
//   * amounts stay ranges: before and after text, no midpoint, no computed difference.
import type { Edge } from "../types.ts";
import type { TradeRow } from "../data/decode.ts";
import { isReleaseId } from "../data/release.ts";
import { COMPARE } from "../copy.ts";
import { amountText, count, date, days, NOT_DISCLOSED, releaseShort } from "../format.ts";

// ---------------------------------------------------------------- the release index (releases/index.json)

export type ReleaseIndexEntry = { release_id: string; build_time: string; activated_at: string };
/** Same bounds as pipeline/release_history.py. */
export const MAX_RELEASES = 10_000;
export const MAX_BUILD_TIME = 100;

function validTimestamp(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) + "Z" === v;
}

/**
 * Validate releases/index.json strictly (docs/data-dictionary.md, "Release history index"): exactly
 * {schema_version: 1, releases: [...]}, each entry exactly {release_id, build_time, activated_at}, no duplicates, at
 * most MAX_RELEASES entries. Throws on anything else; returns the entries in file order (newest first).
 */
export function validateReleaseIndex(json: unknown): ReleaseIndexEntry[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("release index is not an object");
  const o = json as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "releases,schema_version") throw new Error("release index has unexpected keys");
  if (o.schema_version !== 1) throw new Error("release index has an unsupported schema_version");
  if (!Array.isArray(o.releases) || o.releases.length > MAX_RELEASES) throw new Error("release index has no usable list");
  const seen = new Set<string>();
  return o.releases.map((e: unknown) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("release index entry is not an object");
    const x = e as Record<string, unknown>;
    if (Object.keys(x).sort().join(",") !== "activated_at,build_time,release_id") throw new Error("release index entry has unexpected keys");
    if (!isReleaseId(x.release_id)) throw new Error("release index entry has a malformed release_id");
    if (typeof x.build_time !== "string" || !x.build_time.trim() || x.build_time.length > MAX_BUILD_TIME) throw new Error("release index entry has an unusable build_time");
    if (!validTimestamp(x.activated_at)) throw new Error("release index entry has a malformed activated_at");
    if (seen.has(x.release_id)) throw new Error("release index lists a release twice");
    seen.add(x.release_id);
    return { release_id: x.release_id, build_time: x.build_time, activated_at: x.activated_at as string };
  });
}

/** "14 Mar 2026 · 0123456789ab": how a release is named in a picker. */
export function releaseOptionLabel(e: Pick<ReleaseIndexEntry, "release_id" | "build_time">): string {
  return `${date(e.build_time)} · ${releaseShort(e.release_id)}`;
}

/** Default pair: the previous release to the newest listed. `from` is null when fewer than two are listed. */
export function defaultPair(entries: readonly ReleaseIndexEntry[]): { from: string | null; to: string | null } {
  return { to: entries[0]?.release_id ?? null, from: entries[1]?.release_id ?? null };
}

// ---------------------------------------------------------------- shared

/** One changed field, already written for display (ranges as ranges, a missing value as "not on file"). */
export type FieldChange = { field: string; label: string; before: string; after: string };

const same = (x: unknown, y: unknown) => (x ?? null) === (y ?? null);

function show(v: unknown, kind: "text" | "date" | "bool" | "days" = "text"): string {
  if (v === null || v === undefined || v === "") return COMPARE.none;
  if (kind === "bool") return v ? "yes" : "no";
  if (kind === "date") return date(String(v));
  if (kind === "days" && typeof v === "number") return days(v);
  return typeof v === "number" ? count(v) : String(v);
}

function rangeText(low: number | null | undefined, high: number | null | undefined, exact: number | null | undefined = null): string {
  return amountText({ low: low ?? null, high: high ?? null, exact: exact ?? null }) ?? NOT_DISCLOSED;
}

const byDateDesc = (x: string | null | undefined, y: string | null | undefined) => (x && y ? (x < y ? 1 : x > y ? -1 : 0) : x ? -1 : y ? 1 : 0);

// ---------------------------------------------------------------- trades

export type TradeClass = "amended_filing" | "changed_same_version" | "added" | "removed";
export type AddedOrigin = "public_after" | "public_before" | "unknown";

export type TradeChange = {
  cls: TradeClass;
  id: string;
  /** The row to show: the later release's row, or the earlier one's for a removed record. */
  row: TradeRow;
  /** Earlier release's row for the two "same record" classes, else null. */
  before: TradeRow | null;
  fields: FieldChange[];
  /** Only for `added`. */
  origin: AddedOrigin | null;
};

export type TradeComparison = {
  changes: TradeChange[];
  unchanged: number;
  counts: Record<TradeClass, number>;
  origins: Record<AddedOrigin, number>;
  total: { a: number; b: number };
};

const TRADE_FIELDS: { key: keyof TradeRow; label: string; kind?: "text" | "date" | "bool" | "days" }[] = [
  { key: "version", label: "Filing version" }, { key: "amended", label: "Marked amended", kind: "bool" },
  { key: "date", label: "Transaction date", kind: "date" }, { key: "available", label: "Public from", kind: "date" },
  { key: "lag_days", label: "Days to public", kind: "days" }, { key: "late", label: "Over 45 days", kind: "bool" },
  { key: "owner", label: "Owner" }, { key: "action", label: "Action" }, { key: "partial", label: "Partial sale", kind: "bool" },
  { key: "ticker", label: "Ticker" }, { key: "ticker_source", label: "Ticker source" }, { key: "asset", label: "Asset as filed" },
  { key: "asset_class", label: "Asset class" }, { key: "org", label: "Organisation id" }, { key: "doc", label: "Filing id" }, { key: "notCounted", label: "Not counted (deleted by a later filing)", kind: "bool" },
];

/** Field-by-field differences of two rows with the same id. Amount is one field: the range before and after. */
export function tradeFieldChanges(a: TradeRow, b: TradeRow): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of TRADE_FIELDS) {
    if (!same(a[f.key], b[f.key])) out.push({ field: f.key, label: f.label, before: show(a[f.key], f.kind), after: show(b[f.key], f.kind) });
    if (f.key === "date" && (!same(a.low, b.low) || !same(a.high, b.high))) {
      out.push({ field: "amount", label: "Amount range", before: rangeText(a.low, a.high), after: rangeText(b.low, b.high) });
    }
  }
  return out;
}
const counted = (m: Map<string, TradeRow>) => [...m.values()].filter((r) => !r.notCounted).length;
/** One row per id; if a file repeats an id, the highest version wins, then the first. */
function byId(rows: readonly TradeRow[]): Map<string, TradeRow> {
  const m = new Map<string, TradeRow>();
  for (const r of rows) {
    const cur = m.get(r.id);
    if (!cur || (r.version ?? 0) > (cur.version ?? 0)) m.set(r.id, { ...r, notCounted: Boolean(r.notCounted) }); // listed rows carry the mark: a trade that becomes not counted is a change, never "removed"
  }
  return m;
}

/**
 * When did an added trade become public, relative to release A's build date? `available` is a date; the build time is
 * a timestamp. Strictly later date: after. Earlier date: before. The same day, or a missing/unreadable date: unknown.
 */
export function addedOrigin(available: string | null | undefined, buildTimeA: string | null | undefined): AddedOrigin {
  const av = /^\d{4}-\d{2}-\d{2}/.exec(available ?? "")?.[0];
  const bd = /^\d{4}-\d{2}-\d{2}/.exec(buildTimeA ?? "")?.[0];
  if (!av || !bd || av === bd) return "unknown";
  return av > bd ? "public_after" : "public_before";
}

/** Trades of release A against release B, keyed by trade id. `buildTimeA` is release A's build time (for `added`). */
export function compareTrades(a: readonly TradeRow[], b: readonly TradeRow[], opts: { buildTimeA?: string | null } = {}): TradeComparison {
  const A = byId(a), B = byId(b);
  const changes: TradeChange[] = [];
  let unchanged = 0;
  for (const [id, rb] of B) {
    const ra = A.get(id);
    if (!ra) {
      changes.push({ cls: "added", id, row: rb, before: null, fields: [], origin: addedOrigin(rb.available, opts.buildTimeA) });
      continue;
    }
    const fields = tradeFieldChanges(ra, rb);
    if (!fields.length) unchanged++;
    else changes.push({ cls: (rb.version ?? 0) > (ra.version ?? 0) ? "amended_filing" : "changed_same_version", id, row: rb, before: ra, fields, origin: null });
  }
  for (const [id, ra] of A) if (!B.has(id)) changes.push({ cls: "removed", id, row: ra, before: null, fields: [], origin: null });
  const order: TradeClass[] = ["amended_filing", "changed_same_version", "added", "removed"];
  changes.sort((x, y) => order.indexOf(x.cls) - order.indexOf(y.cls) || byDateDesc(x.row.date, y.row.date) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const counts = { amended_filing: 0, changed_same_version: 0, added: 0, removed: 0 };
  const origins = { public_after: 0, public_before: 0, unknown: 0 };
  for (const c of changes) {
    counts[c.cls]++;
    if (c.origin) origins[c.origin]++;
  }
  return { changes, unchanged, counts, origins, total: { a: counted(A), b: counted(B) } };
}

// ---------------------------------------------------------------- ties (member-file edges)

export type EdgeKind = "added" | "removed" | "changed";
export type EdgeChange = {
  kind: EdgeKind;
  id: string;
  edge: Edge;
  /** The other end of the tie ("id → id" when the member is not given). */
  other: string;
  fields: FieldChange[];
  evidenceAdded: string[];
  evidenceRemoved: string[];
};
export type EdgeComparison = { changes: EdgeChange[]; unchanged: number; counts: Record<EdgeKind, number>; total: { a: number; b: number } };

const records = (e: Edge): Set<string> => new Set((e.evidence ?? []).map((v) => v.record).filter((r): r is string => typeof r === "string" && r !== ""));
const sortedDiff = (x: Set<string>, y: Set<string>) => [...x].filter((v) => !y.has(v)).sort();

function otherEnd(e: Edge, member?: string): string {
  if (!member) return `${e.from.id} → ${e.to.id}`;
  return e.from.id === member ? e.to.id : e.from.id;
}

/** Ties of the two member files, keyed by edge id: added, removed, or changed (amount, count, first/last, evidence ids). */
export function compareEdges(a: readonly Edge[], b: readonly Edge[], member?: string): EdgeComparison {
  const A = new Map(a.map((e) => [e.id, e])), B = new Map(b.map((e) => [e.id, e]));
  const changes: EdgeChange[] = [];
  let unchanged = 0;
  for (const [id, eb] of B) {
    const ea = A.get(id);
    if (!ea) {
      changes.push({ kind: "added", id, edge: eb, other: otherEnd(eb, member), fields: [], evidenceAdded: [], evidenceRemoved: [] });
      continue;
    }
    const fields: FieldChange[] = [];
    const push = (field: string, label: string, x: string, y: string) => fields.push({ field, label, before: x, after: y });
    if (!same(ea.amount?.low, eb.amount?.low) || !same(ea.amount?.high, eb.amount?.high) || !same(ea.amount?.exact, eb.amount?.exact)) {
      push("amount", "Amount", rangeText(ea.amount?.low, ea.amount?.high, ea.amount?.exact), rangeText(eb.amount?.low, eb.amount?.high, eb.amount?.exact));
    }
    if (!same(ea.count, eb.count)) push("count", "Records", show(ea.count), show(eb.count));
    if (!same(ea.first, eb.first)) push("first", "First record", show(ea.first, "date"), show(eb.first, "date"));
    if (!same(ea.last, eb.last)) push("last", "Last record", show(ea.last, "date"), show(eb.last, "date"));
    if (!same(ea.evidence_total, eb.evidence_total)) push("evidence_total", "Evidence records counted", show(ea.evidence_total), show(eb.evidence_total));
    const ra = records(ea), rb = records(eb);
    const evidenceAdded = sortedDiff(rb, ra), evidenceRemoved = sortedDiff(ra, rb);
    if (!fields.length && !evidenceAdded.length && !evidenceRemoved.length) unchanged++;
    else changes.push({ kind: "changed", id, edge: eb, other: otherEnd(eb, member), fields, evidenceAdded, evidenceRemoved });
  }
  for (const [id, ea] of A) if (!B.has(id)) changes.push({ kind: "removed", id, edge: ea, other: otherEnd(ea, member), fields: [], evidenceAdded: [], evidenceRemoved: [] });
  const order: EdgeKind[] = ["changed", "added", "removed"];
  changes.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || (x.edge.type < y.edge.type ? -1 : x.edge.type > y.edge.type ? 1 : 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const c of changes) counts[c.kind]++;
  return { changes, unchanged, counts, total: { a: A.size, b: B.size } };
}

// ---------------------------------------------------------------- holdings

type NetWorthLike = { low?: number | null; high?: number | null; high_valued?: number | null; label?: string | null } | null | undefined;
type DocLike = { filed?: string | null; amendment?: boolean | null } | undefined;
/** The part of holdings/<id>.json this comparison reads. */
export type HoldingsLike = { docs?: Record<string, DocLike>; years?: Record<string, { doc?: string | null; net_worth?: NetWorthLike } | undefined> } | null | undefined;

export type HoldingsClass = "doc_changed" | "net_worth_changed" | "year_added" | "year_removed";
export type HoldingsYearChange = {
  year: number;
  cls: HoldingsClass;
  docA: string | null; docB: string | null;
  /** "filed 3 May 2021, an amendment" or null when the document is not described in the file. */
  docInfoA: string | null; docInfoB: string | null;
  netWorthA: string | null; netWorthB: string | null;
};
export type HoldingsComparison = {
  presentA: boolean; presentB: boolean;
  changes: HoldingsYearChange[];
  unchanged: number;
  counts: Record<HoldingsClass, number>;
};

function netWorthText(n: NetWorthLike): string | null {
  if (!n) return null;
  const base = rangeText(n.low, n.high);
  return n.label && n.label !== "range" ? `${base} (${n.label})` : base;
}

function docInfo(h: HoldingsLike, doc: string | null): string | null {
  const d = doc ? h?.docs?.[doc] : undefined;
  if (!d) return null;
  return `${d.filed ? `filed ${date(d.filed)}` : "filing date not on file"}${d.amendment ? ", an amendment" : ""}`;
}

/** Holdings of the two releases per report year (either may be null: no file). A missing year is "not in that release's data". */
export function compareHoldings(a: HoldingsLike, b: HoldingsLike): HoldingsComparison {
  const ya = a?.years ?? {}, yb = b?.years ?? {};
  const years = [...new Set([...Object.keys(ya), ...Object.keys(yb)])].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
  const changes: HoldingsYearChange[] = [];
  let unchanged = 0;
  for (const y of years) {
    const x = ya[y], z = yb[y];
    const docA = x?.doc ?? null, docB = z?.doc ?? null;
    const nwA = netWorthText(x?.net_worth), nwB = netWorthText(z?.net_worth);
    const base = { year: Number(y), docA, docB, docInfoA: docInfo(a, docA), docInfoB: docInfo(b, docB), netWorthA: nwA, netWorthB: nwB };
    if (x && !z) changes.push({ ...base, cls: "year_removed" });
    else if (!x && z) changes.push({ ...base, cls: "year_added" });
    else if (docA !== docB) changes.push({ ...base, cls: "doc_changed" });
    else if (nwA !== nwB) changes.push({ ...base, cls: "net_worth_changed" });
    else unchanged++;
  }
  const counts = { doc_changed: 0, net_worth_changed: 0, year_added: 0, year_removed: 0 };
  for (const c of changes) counts[c.cls]++;
  return { presentA: Boolean(a), presentB: Boolean(b), changes, unchanged, counts };
}

// ---------------------------------------------------------------- the whole comparison

/** What is read from one release for the member. */
export type MemberSide = { buildTime: string | null; edges: readonly Edge[]; trades: readonly TradeRow[]; holdings: HoldingsLike };

export type CompareResult = {
  member: string;
  trades: TradeComparison;
  edges: EdgeComparison;
  holdings: HoldingsComparison;
  summary: {
    trades: Record<TradeClass | "unchanged", number> & { added_public_after: number; added_public_before: number; added_unknown: number };
    edges: Record<EdgeKind | "unchanged", number>;
    holdings: Record<HoldingsClass | "unchanged", number>;
    /** Changes listed in all three sections. */
    changed: number;
  };
};

export function compareMember(member: string, a: MemberSide, b: MemberSide): CompareResult {
  const trades = compareTrades(a.trades, b.trades, { buildTimeA: a.buildTime });
  const edges = compareEdges(a.edges, b.edges, member);
  const holdings = compareHoldings(a.holdings, b.holdings);
  return {
    member, trades, edges, holdings,
    summary: {
      trades: { ...trades.counts, unchanged: trades.unchanged, added_public_after: trades.origins.public_after, added_public_before: trades.origins.public_before, added_unknown: trades.origins.unknown },
      edges: { ...edges.counts, unchanged: edges.unchanged },
      holdings: { ...holdings.counts, unchanged: holdings.unchanged },
      changed: trades.changes.length + edges.changes.length + holdings.changes.length,
    },
  };
}
