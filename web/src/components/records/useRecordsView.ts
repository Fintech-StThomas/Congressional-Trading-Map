"use client";
// The full file's tables under the shared view (year window, date basis, assumptions, selected tie): one memoised
// result per table, from lib/domain/recordsview.ts. The selected tie's row is always kept in the ties table.
import { useMemo } from "react";
import { VIEW } from "@/lib/copy";
import { yearsText } from "@/lib/domain/viewstate";
import { TIE_COLS, TRADE_COLS_ALL, DOC_COLS, type Cell, type Col } from "@/lib/domain/records";
import { ASSET_COLS, LIABILITY_COLS } from "@/lib/domain/holdings";
import { viewTable, type TableKind, type TableView } from "@/lib/domain/recordsview";
import { useView } from "@/components/shared/useViewState";
import type { YearWindow } from "./DataTable";

export const COV_COLS: Col[] = [
  { key: "year", label: "Year", kind: "num", width: 80 },
  { key: "trades", label: "Trade coverage", kind: "text", width: 130 },
  { key: "money", label: "Money coverage", kind: "text", width: 130 },
  { key: "n_trades", label: "Trades in this file", kind: "num", width: 140 },
];

type Rows = { ties: Cell[][]; trades: Cell[][]; docs: Cell[][]; assets: Cell[][]; liabilities: Cell[][]; coverage: Cell[][] };
export type TableState = TableView & { years?: YearWindow };

export function useRecordsView(rows: Rows): { tables: Record<keyof Rows, TableState>; edge: string | null } {
  const view = useView();
  const tables = useMemo(() => {
    const edgeAt = TIE_COLS.findIndex((c) => c.key === "edge_id");
    const w = { years: view.years, basis: view.basis, assume: view.assume };
    const one = (kind: TableKind, cols: Col[], r: Cell[][], keep?: (row: Cell[]) => boolean): TableState => {
      const t = viewTable(kind, cols, r, { ...w, keep });
      if (!view.years) return t;
      const note = [kind === "ties" ? VIEW.recordYearsNote : "", kind === "trades" ? (view.basis === "public" ? VIEW.byPublic : VIEW.byEvent) + "." : "", t.excluded ? VIEW.leftOut(t.excluded) : ""].filter(Boolean).join(" ");
      return { ...t, years: { label: yearsText(view.years), total: t.total - t.excluded, note } };
    };
    return {
      ties: one("ties", TIE_COLS, rows.ties, view.edge ? (row) => row[edgeAt] === view.edge : undefined),
      trades: one("trades", TRADE_COLS_ALL, rows.trades),
      docs: one("docs", DOC_COLS, rows.docs),
      assets: one("assets", ASSET_COLS, rows.assets),
      liabilities: one("liabilities", LIABILITY_COLS, rows.liabilities),
      coverage: one("coverage", COV_COLS, rows.coverage),
    };
  }, [rows, view.years, view.basis, view.assume, view.edge]);
  return { tables, edge: view.edge };
}
