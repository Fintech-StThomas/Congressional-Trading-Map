"use client";
// "Further ties" on the member page: money ties published without evidence (ledger rows), sortable and searchable.
import Link from "next/link";
import { useMemo, useState } from "react";
import { recordUrlFor, memberHref, orgHref } from "@/lib/urls";
import { type LedgerRow } from "@/lib/data/decode";
import type { KindTotal } from "@/lib/domain/money-totals";
import { MoneyTotals } from "./MoneyTotals";
import { directionWord, TYPE_LABEL } from "@/lib/domain/edges";
import { amountText, count, yearSpan } from "@/lib/format";
import { IS_SAMPLE_CLIENT } from "@/lib/data/fetch";
import { ExternalIcon } from "@/components/shared/ExternalIcon";
import { FOLD_UI } from "@/lib/copy-ui";

type Props = {
  rows: LedgerRow[];
  names: Record<string, string>;
  /** All-in money totals (full ties plus this ledger), and the count of shared-committee rows. */
  money?: KindTotal[];
  seats?: number;
  /** For an org's ledger, the org's own record link applies to every row. */
  selfRecordUrl?: string | null;
};
type Key = "name" | "type" | "amount" | "count" | "last";
/** Rows shown before "Show all". */
const FIRST = 10;

/** Money ties that come without evidence arrays: one row per tie, linked to the official record by id. */
export function LedgerTable({ rows, names, money, seats = 0, selfRecordUrl }: Props) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "amount", dir: -1 });
  const [limit, setLimit] = useState(FIRST);
  const name = (r: LedgerRow) => names[r.other] ?? r.other;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => name(r).toLowerCase().includes(t) || r.other.toLowerCase().includes(t) || TYPE_LABEL[r.type]?.toLowerCase().includes(t)) : rows.slice();
    const val = (r: LedgerRow): number | string => {
      switch (sort.k) {
        case "name": return name(r);
        case "type": return TYPE_LABEL[r.type] ?? r.type;
        case "amount": return r.exact ?? r.high ?? r.low ?? -1;
        case "count": return r.count;
        case "last": return r.last ?? "";
      }
    };
    return f.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, names]);

  if (!rows.length) return null;

  const th = (k: Key, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortbtn" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "name" || k === "type" ? 1 : -1 }))}>
        {label}
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={sort.k === k ? `sorticon is-${sort.dir === 1 ? "up" : "down"}` : "sorticon"}>
          <path d="M2 4l3-3 3 3M2 6l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </th>
  );

  return (
    <div className="ledger" data-testid="ledger">
      {money && <MoneyTotals kinds={money} seats={seats} />}
      <div className="filters">
        <label className="filters__search">
          <span>Find in the ledger</span>
          <input type="search" value={q} placeholder="Committee or organisation name" onChange={(e) => { setQ(e.target.value); setLimit(FIRST); }} />
        </label>
        <p className="filters__count mono" aria-live="polite">
          {count(list.length)} of {count(rows.length)} rows
        </p>
      </div>
      <div className="tablewrap">
        <table className="ties ties--ledger">
          <caption className="visually-hidden">Ledger of further money ties, sortable</caption>
          <thead>
            <tr>
              {th("type", "Tie")}
              {th("name", "With")}
              {th("amount", "Amount", "num")}
              {th("count", "Records", "num")}
              {th("last", "Years")}
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r, i) => {
              const url = IS_SAMPLE_CLIENT ? null : selfRecordUrl !== undefined ? selfRecordUrl : recordUrlFor(r.other);
              return (
                <tr key={`${r.type}-${r.other}-${i}`}>
                  <td data-label="Tie">
                    {TYPE_LABEL[r.type] ?? r.type}
                    <span className="ties__dir">{directionWord(r.dir)}</span>
                    {r.note && <span className="sub"> · {r.note}</span>}
                  </td>
                  <td data-label="With">
                    <Link href={r.otherKind === "member" ? memberHref(r.other) : orgHref(r.other)}>{name(r)}</Link>
                    {r.via && <span className="sub"> · via {names[r.via.id] ?? r.via.name}</span>}
                  </td>
                  <td data-label="Amount" className="num mono">{amountText(r) ?? <span className="nd">not disclosed</span>}</td>
                  <td data-label="Records" className="num mono">{count(r.count)}</td>
                  <td data-label="Years" className="mono">{yearSpan(r.first, r.last)}</td>
                  <td data-label="Record">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {url.includes("fec.gov") ? "FEC filings" : "SEC filings"} <ExternalIcon />
                        <span className="visually-hidden"> for {name(r)} (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="nd">{IS_SAMPLE_CLIENT ? "sample: no record" : "search the source"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > FIRST && (
        <p className="more">
          {list.length > limit && (
            <button type="button" className="btn btn--small" onClick={() => setLimit(list.length)} data-testid="ledger-show-all">
              {FOLD_UI.showAll(list.length, "rows")}
            </button>
          )}
          {limit > FIRST && list.length <= limit && (
            <button type="button" className="btn btn--small" onClick={() => setLimit(FIRST)}>
              {FOLD_UI.showFewer(FIRST, "rows")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
