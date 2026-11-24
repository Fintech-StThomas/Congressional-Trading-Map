// CSV of the ties table on an organisation page, as listed and in the order and filter in view. Missing amounts and
// dates are empty cells, never 0; every row carries the note. Pure; tests/citation-page.test.mjs loads it.
import { toCSV, type Cell, type Col } from "./records.ts";
import { TYPE_LABEL } from "./edges.ts";
import type { Edge } from "../types.ts";

const COLS: Col[] = [
  { key: "member_id", label: "member_id", kind: "text" },
  { key: "member", label: "member", kind: "text" },
  { key: "party", label: "party", kind: "text" },
  { key: "state", label: "state", kind: "text" },
  { key: "tie", label: "tie", kind: "text" },
  { key: "low", label: "amount_low", kind: "num" },
  { key: "high", label: "amount_high", kind: "num" },
  { key: "exact", label: "amount_exact", kind: "num" },
  { key: "records", label: "records", kind: "num" },
  { key: "first", label: "first", kind: "date" },
  { key: "last", label: "last", kind: "date" },
  { key: "tie_id", label: "tie_id", kind: "text" },
  { key: "note", label: "note", kind: "text" },
];

export type OrgCsvRow = { edge: Pick<Edge, "id" | "type" | "amount" | "count" | "first" | "last">; member: { id: string; name: string | null; party: string | null; state: string | null } };

export function orgTiesCsv(rows: readonly OrgCsvRow[], note: string): string {
  const cells: Cell[][] = rows.map(({ edge: e, member: m }) => [
    m.id, m.name, m.party, m.state, TYPE_LABEL[e.type] ?? e.type, e.amount.low ?? null, e.amount.high ?? null, e.amount.exact ?? null,
    e.count, e.first || null, e.last || null, e.id, note,
  ]);
  return toCSV(COLS, cells);
}
