"use client";
// One table of changes. Short lists are a plain table (prints in full); long ones use the sortable, filterable
// DataTable (windowed, so it prints only what is in view; the CSV holds every row).
import { DataTable } from "@/components/records/DataTable";
import { safeHttpUrl } from "@/lib/urls";
import { count } from "@/lib/format";
import type { CompareTable } from "@/lib/domain/compareRows";

const PLAIN_MAX = 100;

export function ChangeTable({ t }: { t: CompareTable }) {
  if (t.rows.length > PLAIN_MAX) return <DataTable id={t.id} title={t.title} cols={t.cols} rows={t.rows} file={t.id} />;
  return (
    <div className="cmp__scroll" tabIndex={0} role="region" aria-label={`${t.title}: table, scrolls`}>
      <table className="cmp__table" data-testid={`cmp-${t.id}`}>
        <caption className="visually-hidden">{t.title}, {count(t.rows.length)} rows</caption>
        <thead>
          <tr>{t.cols.map((c) => <th key={c.key} scope="col" className={c.kind === "num" ? "is-num" : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => {
                const url = typeof v === "string" ? safeHttpUrl(v) : null;
                return (
                  <td key={j} className={t.cols[j].kind === "num" ? "is-num mono" : t.cols[j].kind === "date" ? "mono" : undefined}>
                    {v === null || v === "" ? <span className="rec__null">—</span> : url ? <a href={url} rel="noreferrer">{url}</a> : typeof v === "number" ? count(v) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
