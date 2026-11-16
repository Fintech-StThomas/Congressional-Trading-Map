"use client";
// A dense raw-records table: sortable headers, per-column filters, CSV of the rows in view, windowed rendering for 40,000+ rows.
// It can also take part in the shared view: rows already narrowed to a year window (`years`, which says so in its count,
// in its CSV citation and in a note), and one selectable column whose value is the selected row (`select`).
import { useEffect, useMemo, useRef, useState } from "react";
import { VIEW } from "@/lib/copy";
import { filterRows, sortRows, toCSV, type Cell, type Col } from "@/lib/domain/records";
import { safeHttpUrl } from "@/lib/urls";
import { download } from "@/components/shared/download";
import { CiteButton } from "@/components/shared/CiteButton";
import type { Citation } from "@/lib/domain/citation";

const ROW_H = 30;
const VIEW_H = 520;
const OVERSCAN = 12;

/** Kept exported from here (components/delays imports it); the implementation is shared with the citation panel. */
export { download };

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** The shared year window as this table was given it: the rows are already inside it. */
export type YearWindow = { label: string; total: number; note?: string };
/** One column whose value identifies a row; the selected row is highlighted, scrolled into view and can be changed. */
export type RowSelect = { col: string; selected: string | null; onSelect: (value: string | null) => void };

function show(v: Cell, kind: Col["kind"]): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="rec__null">—</span>;
  if (kind === "bool") return v ? "yes" : "no";
  if (kind === "num" && typeof v === "number") return v.toLocaleString("en-US");
  if (kind === "links") {
    // Only http(s) links become links; anything else in the data stays plain text.
    const urls = String(v).split(" ").map(safeHttpUrl).filter((u): u is string => Boolean(u));
    if (!urls.length) return String(v);
    return (
      <>
        <a href={urls[0]} target="_blank" rel="noreferrer">{host(urls[0])}</a>
        {urls.length > 1 && <span className="rec__more" title={urls.slice(1).join("\n")}> +{urls.length - 1}</span>}
      </>
    );
  }
  return String(v);
}

/**
 * A dense table for raw records: sortable headers, a filter per column, a row
 * count, CSV of the rows in view, and windowed rendering so 40,000 rows stay fast.
 */
export type TableCite = {
  /** Builds the citation for the rows in view; `ids` are read from the columns named in `idKeys`. */
  build: (t: { title: string; filters: { column: string; value: string }[]; shown: number; total: number; ids: { edge_ids?: string[]; trade_ids?: string[]; filing_docs?: string[] } }, retrieved: string) => Citation;
  idKeys: { edge_ids?: string; trade_ids?: string; filing_docs?: string };
};

export function DataTable({ id, title, cols, rows, file, cite, years, select }: { id: string; title: string; cols: Col[]; rows: Cell[][]; file: string; cite?: TableCite; years?: YearWindow; select?: RowSelect }) {
  const [sort, setSort] = useState<{ i: number; desc: boolean } | null>(null);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const view = useMemo(() => {
    const f = filterRows(rows, cols, filters);
    return sort ? sortRows(f, sort.i, sort.desc) : f;
  }, [rows, cols, filters, sort]);
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const end = Math.min(view.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN);
  const width = cols.reduce((s, c) => s + (c.width ?? 120), 0);
  const filtered = view.length !== rows.length;
  const selAt = select ? cols.findIndex((c) => c.key === select.col) : -1;
  const selectedId = select?.selected ?? null;
  const selIndex = useMemo(() => (selectedId && selAt >= 0 ? view.findIndex((r) => r[selAt] === selectedId) : -1), [view, selectedId, selAt]);
  const picked = useRef<string | null>(null);
  // A tie selected elsewhere (arriving with `e`): scroll the table and the page to its row. Not after a click here.
  useEffect(() => {
    if (selIndex < 0 || !box.current) return;
    if (picked.current === select?.selected) {
      picked.current = null;
      return;
    }
    const el = box.current;
    el.scrollTop = Math.max(0, selIndex * ROW_H - VIEW_H / 2);
    setTop(Math.max(0, el.scrollTop - 74));
    const t = window.setTimeout(() => el.querySelector("tr.is-selected")?.scrollIntoView({ block: "center" }), 0);
    return () => window.clearTimeout(t);
  }, [selIndex, select?.selected]);
  const total = years ? years.total : rows.length;

  return (
    <div className="rec__table" data-testid={`rec-${id}`}>
      <div className="rec__bar">
        <p className="rec__count mono" aria-live="polite" data-testid={`rec-${id}-count`}>
          {filtered || years ? `${view.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} rows` : `${rows.length.toLocaleString("en-US")} rows`}
        </p>
        {years && <p className="rec__yearnote" data-testid={`rec-${id}-years`}>{VIEW.filtered(years.label)}. {years.note}</p>}
        {filtered && (
          <button type="button" className="linkbtn" onClick={() => setFilters({})}>Clear filters</button>
        )}
        <button type="button" className="btn btn--small" data-testid={`rec-${id}-csv`} onClick={() => download(`${file}.csv`, toCSV(cols, view), "text/csv;charset=utf-8")}>
          Download CSV{filtered ? " (filtered)" : ""}
        </button>
        {cite && (
          <CiteButton
            testId={`cite-${id}`}
            build={(retrieved) => {
              const col = (key?: string) => (key ? cols.findIndex((c) => c.key === key) : -1);
              const ids = (key?: string) => {
                const i = col(key);
                return i < 0 ? undefined : [...new Set(view.map((r) => r[i]).filter((v): v is string => typeof v === "string" && v !== ""))];
              };
              return cite.build({
                title,
                filters: [
                  ...(years ? [{ column: VIEW.yearsLabel, value: years.label }] : []),
                  ...Object.entries(filters).filter(([, q]) => q.trim()).map(([i, q]) => ({ column: cols[Number(i)].label, value: q.trim() })),
                ],
                shown: view.length, total,
                ids: { edge_ids: ids(cite.idKeys.edge_ids), trade_ids: ids(cite.idKeys.trade_ids), filing_docs: ids(cite.idKeys.filing_docs) },
              }, retrieved);
            }}
          />
        )}
      </div>
      <div
        className="rec__scroll"
        ref={box}
        style={{ maxHeight: VIEW_H + 74 }}
        onScroll={(e) => setTop(Math.max(0, (e.currentTarget as HTMLDivElement).scrollTop - 74))}
        tabIndex={0}
        role="region"
        aria-label={`${title}: table, scrolls`}
      >
        <table style={{ width }} aria-rowcount={view.length + 2}>
          <colgroup>
            {cols.map((c) => <col key={c.key} style={{ width: c.width ?? 120 }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} scope="col" aria-sort={sort?.i === i ? (sort.desc ? "descending" : "ascending") : "none"} className={c.kind === "num" ? "is-num" : undefined}>
                  <button type="button" onClick={() => setSort((s) => (s?.i === i ? (s.desc ? null : { i, desc: true }) : { i, desc: false }))}>
                    {c.label}
                    <span className="rec__arrow" aria-hidden="true">{sort?.i === i ? (sort.desc ? "↓" : "↑") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
            <tr className="rec__filters">
              {cols.map((c, i) => (
                <th key={c.key} scope="col">
                  <input
                    type="search"
                    value={filters[i] ?? ""}
                    placeholder={c.kind === "num" ? ">1000" : c.kind === "bool" ? "yes/no" : "filter"}
                    aria-label={`Filter ${c.label}`}
                    onChange={(e) => setFilters((f) => ({ ...f, [i]: e.target.value }))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {start > 0 && <tr aria-hidden="true" style={{ height: start * ROW_H }} />}
            {view.slice(start, end).map((r, j) => (
              <tr key={start + j} aria-rowindex={start + j + 3} className={select && select.selected && r[selAt] === select.selected ? "is-selected" : undefined} data-row={select && selAt >= 0 && typeof r[selAt] === "string" ? String(r[selAt]) : undefined}>
                {r.map((v, i) => (
                  <td key={i} className={cols[i].kind === "num" ? "is-num mono" : cols[i].kind === "date" ? "mono" : undefined} title={typeof v === "string" && v.length > 30 ? v : undefined}>
                    {select && i === selAt && typeof v === "string" && v ? (
                      <button
                        type="button"
                        className="rec__pick mono"
                        aria-pressed={select.selected === v}
                        aria-label={select.selected === v ? VIEW.clearTie : VIEW.selectTie(v)}
                        onClick={() => {
                          picked.current = select.selected === v ? null : v;
                          select.onSelect(select.selected === v ? null : v);
                        }}
                      >
                        {v}
                      </button>
                    ) : (
                      show(v, cols[i].kind)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {end < view.length && <tr aria-hidden="true" style={{ height: (view.length - end) * ROW_H }} />}
            {view.length === 0 && (
              <tr><td colSpan={cols.length} className="rec__none">{rows.length ? "No rows match these filters." : "None on file."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
