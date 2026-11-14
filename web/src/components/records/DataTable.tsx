"use client";

import { useMemo, useRef, useState } from "react";
import { filterRows, sortRows, toCSV, type Cell, type Col } from "@/lib/records";

const ROW_H = 30;
const VIEW_H = 520;
const OVERSCAN = 12;

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function show(v: Cell, kind: Col["kind"]): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="rec__null">—</span>;
  if (kind === "bool") return v ? "yes" : "no";
  if (kind === "num" && typeof v === "number") return v.toLocaleString("en-US");
  if (kind === "links") {
    const urls = String(v).split(" ").filter(Boolean);
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
export function DataTable({ id, title, cols, rows, file }: { id: string; title: string; cols: Col[]; rows: Cell[][]; file: string }) {
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

  return (
    <div className="rec__table" data-testid={`rec-${id}`}>
      <div className="rec__bar">
        <p className="rec__count mono" aria-live="polite" data-testid={`rec-${id}-count`}>
          {filtered ? `${view.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows` : `${rows.length.toLocaleString("en-US")} rows`}
        </p>
        {filtered && (
          <button type="button" className="linkbtn" onClick={() => setFilters({})}>Clear filters</button>
        )}
        <button type="button" className="btn btn--small" data-testid={`rec-${id}-csv`} onClick={() => download(`${file}.csv`, toCSV(cols, view), "text/csv;charset=utf-8")}>
          Download CSV{filtered ? " (filtered)" : ""}
        </button>
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
              <tr key={start + j} aria-rowindex={start + j + 3}>
                {r.map((v, i) => (
                  <td key={i} className={cols[i].kind === "num" ? "is-num mono" : cols[i].kind === "date" ? "mono" : undefined} title={typeof v === "string" && v.length > 30 ? v : undefined}>
                    {show(v, cols[i].kind)}
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
