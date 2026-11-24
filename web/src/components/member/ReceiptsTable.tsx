"use client";
// "Campaign receipts, as summarised by the FEC": one row per cycle and candidate id, newest first, the latest few visible and
// the rest behind the shared "Show all" control (the same folding as the loans table). Every figure comes pre-formatted from
// lib/domain/finance-receipts.ts ("not reported" for a blank). Neutral colours only; each candidate id links to its FEC page.
import { useState } from "react";
import type { ReceiptsRow } from "@/lib/types";
import { candidateLinks, receiptsLine, receiptsNewestFirst } from "@/lib/domain/finance-receipts";
import { FOLD_UI } from "@/lib/copy-ui";
import { RECEIPTS } from "@/lib/copy-finance-receipts";

/** Rows visible before "Show all". */
const FIRST = 3;

export function ReceiptsTable({ rows }: { rows: ReceiptsRow[] }) {
  const [all, setAll] = useState(false);
  const list = receiptsNewestFirst(rows);
  const shown = all ? list : list.slice(0, FIRST);
  const links = candidateLinks(rows);
  const cell = (v: string) => (v === "not reported" ? <span className="nd">{v}</span> : v);
  const C = RECEIPTS.cols;
  return (
    <div data-testid="fin-receipts">
      <div className="tablewrap fin__wrap">
        <table className="fin__table">
          <caption className="visually-hidden">{RECEIPTS.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{C.cycle}</th>
              <th scope="col" className="num">{C.total}</th>
              <th scope="col" className="num">{C.individuals}</th>
              <th scope="col" className="num">{C.committees}</th>
              <th scope="col" className="num">{C.party}</th>
              <th scope="col" className="num">{C.candidate}</th>
              <th scope="col" className="num">{C.cash}</th>
              <th scope="col">{C.through}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const l = receiptsLine(r);
              return (
                <tr key={`${r.cycle}-${r.candidate_id}`} data-testid="fin-receipt-row">
                  <td data-label={C.cycle} className="mono">{l.cycle}{links.length > 1 && <span className="sub"> · {l.office}</span>}</td>
                  <td data-label={C.total} className="num mono">{cell(l.total)}</td>
                  <td data-label={C.individuals} className="num mono">{cell(l.individuals)}</td>
                  <td data-label={C.committees} className="num mono">{cell(l.committees)}</td>
                  <td data-label={C.party} className="num mono">{cell(l.party)}</td>
                  <td data-label={C.candidate} className="num mono">{cell(l.candidate)}</td>
                  <td data-label={C.cash} className="num mono">{cell(l.cash)}</td>
                  <td data-label={C.through} className="mono">{cell(l.through.replace(/^through /, ""))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > FIRST && (
        <p className="more more--fold no-print">
          <button type="button" className="btn btn--small" aria-expanded={all} onClick={() => setAll((a) => !a)} data-testid="fin-receipts-fold">
            {all ? FOLD_UI.showFewer(FIRST, RECEIPTS.showAll) : FOLD_UI.showAll(list.length, RECEIPTS.showAll)}
          </button>
        </p>
      )}
      <p className="fin__links sub" data-testid="fin-receipts-links">
        {links.map((l, i) => (
          <span key={l.id}>{i > 0 && " · "}{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{RECEIPTS.fecLink(l.id)}</a> : l.id}</span>
        ))}
      </p>
      <p className="section__note">{RECEIPTS.cashNote}</p>
    </div>
  );
}
