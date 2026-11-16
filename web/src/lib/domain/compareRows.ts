// Tables and CSV for a release comparison (lib/domain/compare.ts): one table per class with changes, in the shape
// DataTable shows, and one CSV of every change. Wording comes from lib/copy.ts; amounts are before → after ranges.
import { COMPARE } from "../copy.ts";
import { amountText, NOT_DISCLOSED } from "../format.ts";
import { toCSV, type Cell, type Col } from "./records.ts";
import type { CompareResult, FieldChange, TradeChange } from "./compare.ts";

export type CompareTable = { id: string; section: "trades" | "ties" | "holdings"; title: string; body: string; cols: Col[]; rows: Cell[][] };

const col = (key: string, label: string, kind: Col["kind"] = "text", width = 120): Col => ({ key, label, kind, width });

/** "Public from: 3 Mar 2026 → 9 Mar 2026; Amount range: $1,001–$15,000 → $15,001–$50,000" */
export function fieldsText(fields: readonly FieldChange[]): string {
  return fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join("; ");
}

const rangeOf = (t: { low: number | null; high: number | null }) => amountText({ low: t.low, high: t.high, exact: null }) ?? NOT_DISCLOSED;
const assetOf = (t: TradeChange) => `${t.row.asset}${t.row.ticker ? ` (${t.row.ticker})` : ""}`;

const TRADE_COLS: Col[] = [
  col("id", "Event id", "text", 150), col("date", "Transaction date", "date", 110), col("available", "Public from", "date", 100),
  col("asset", "Asset as filed", "text", 240), col("action", "Action", "text", 76), col("owner", "Owner", "text", 90),
  col("amount", "Amount range", "text", 150), col("version", "Filing version", "text", 100), col("changes", "What changed", "text", 380),
];
const ADDED_COLS: Col[] = [...TRADE_COLS.slice(0, 8), col("origin", "Public relative to the earlier release", "text", 300)];

function tradeRow(t: TradeChange): Cell[] {
  const v = t.before ? `${t.before.version} → ${t.row.version}` : String(t.row.version);
  return [t.id, t.row.date, t.row.available, assetOf(t), t.row.action, t.row.owner, rangeOf(t.row), v, fieldsText(t.fields)];
}

/** Every table that has rows, in reading order: trades, ties, holdings. */
export function compareTables(r: CompareResult): CompareTable[] {
  const out: CompareTable[] = [];
  const tradeCls = [["amended_filing", TRADE_COLS], ["changed_same_version", TRADE_COLS], ["added", ADDED_COLS], ["removed", TRADE_COLS.slice(0, 8)]] as const;
  for (const [cls, cols] of tradeCls) {
    const list = r.trades.changes.filter((c) => c.cls === cls);
    if (!list.length) continue;
    const rows = list.map((t) => {
      const base = tradeRow(t);
      return cls === "added" ? [...base.slice(0, 8), t.origin ? COMPARE.origin[t.origin] : null] : cls === "removed" ? base.slice(0, 8) : base;
    });
    out.push({ id: `trades-${cls}`, section: "trades", title: `${COMPARE.heading.trades}: ${COMPARE.classes[cls].label}`, body: COMPARE.classes[cls].body, cols: [...cols], rows });
  }
  const edgeCols = [col("id", "Edge id", "text", 120), col("type", "Type", "text", 130), col("other", "Other end", "text", 160), col("amount", "Amount", "text", 190), col("count", "Records", "num", 80), col("what", "What changed", "text", 400)];
  for (const kind of ["changed", "added", "removed"] as const) {
    const list = r.edges.changes.filter((c) => c.kind === kind);
    if (!list.length) continue;
    const rows = list.map((c) => {
      const ev = [c.evidenceAdded.length ? `Evidence records added: ${c.evidenceAdded.join(", ")}` : "", c.evidenceRemoved.length ? `Evidence records no longer listed: ${c.evidenceRemoved.join(", ")}` : ""].filter(Boolean);
      return [c.id, c.edge.type, c.other, amountText(c.edge.amount ?? { low: null, high: null, exact: null }) ?? NOT_DISCLOSED, c.edge.count ?? null, [fieldsText(c.fields), ...ev].filter(Boolean).join("; ") || null];
    });
    out.push({ id: `ties-${kind}`, section: "ties", title: `${COMPARE.heading.ties}: ${COMPARE.edgeKinds[kind]}`, body: COMPARE.edgeNote, cols: edgeCols, rows });
  }
  if (r.holdings.changes.length) {
    const cols = [col("year", "Report year", "num", 90), col("change", "Change", "text", 230), col("docs", "Document used (earlier → later)", "text", 340), col("nw", "Net worth range (earlier → later)", "text", 380)];
    const rows = r.holdings.changes.map((h): Cell[] => [
      h.year, COMPARE.holdingsClasses[h.cls].label,
      `${h.docA ? `${h.docA}${h.docInfoA ? ` (${h.docInfoA})` : ""}` : "not in the earlier release’s data"} → ${h.docB ? `${h.docB}${h.docInfoB ? ` (${h.docInfoB})` : ""}` : "not in the later release’s data"}`,
      `${h.netWorthA ?? (h.cls === "year_added" ? "not in the earlier release’s data" : COMPARE.none)} → ${h.netWorthB ?? (h.cls === "year_removed" ? "not in the later release’s data" : COMPARE.none)}`,
    ]);
    out.push({ id: "holdings-years", section: "holdings", title: COMPARE.heading.holdings, body: Object.values(COMPARE.holdingsClasses).map((c) => `${c.label}: ${c.body}`).join(" "), cols, rows });
  }
  return out;
}

const CSV_COLS: Col[] = [
  col("section", "Section"), col("change", "Change"), col("record", "Record id"), col("description", "Record"), col("date", "Date", "date"),
  col("details", "What changed (earlier → later)"), col("note", "Note"),
];

/** One CSV of every change, header first, in the order of compareTables. */
export function compareCsv(r: CompareResult): string {
  const rows: Cell[][] = [];
  for (const t of r.trades.changes) {
    rows.push([COMPARE.heading.trades, COMPARE.classes[t.cls].label, t.id, assetOf(t), t.row.date, t.cls === "added" || t.cls === "removed" ? `Amount range: ${rangeOf(t.row)}` : fieldsText(t.fields), t.origin ? COMPARE.origin[t.origin] : null]);
  }
  for (const c of r.edges.changes) {
    const ev = [c.evidenceAdded.length ? `Evidence records added: ${c.evidenceAdded.join(", ")}` : "", c.evidenceRemoved.length ? `Evidence records no longer listed: ${c.evidenceRemoved.join(", ")}` : ""].filter(Boolean);
    rows.push(["Ties", COMPARE.edgeKinds[c.kind], c.id, `${c.edge.type} with ${c.other}`, null, [fieldsText(c.fields), ...ev].filter(Boolean).join("; ") || null, null]);
  }
  for (const h of r.holdings.changes) {
    rows.push(["Holdings", COMPARE.holdingsClasses[h.cls].label, `${h.year}`, `Report year ${h.year}`, null,
      `Document: ${h.docA ?? "not in the earlier release’s data"} → ${h.docB ?? "not in the later release’s data"}; Net worth range: ${h.netWorthA ?? COMPARE.none} → ${h.netWorthB ?? COMPARE.none}`, null]);
  }
  return toCSV(CSV_COLS, rows);
}
