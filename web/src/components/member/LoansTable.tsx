"use client";
// "Loans to own campaign" rows, one per cycle and candidate id, newest first: the latest few visible, the rest behind
// the shared "Show all" control. Every figure comes pre-formatted from lib/domain/finance.ts ("not reported" for a blank).
import { useState } from "react";
import type { LoanRow } from "@/lib/types";
import { loanLine, loansNewestFirst } from "@/lib/domain/finance";
import { FOLD_UI } from "@/lib/copy-ui";
import { FINANCE } from "@/lib/copy-finance";

/** Rows visible before "Show all". */
const FIRST = 3;

export function LoansTable({ rows }: { rows: LoanRow[] }) {
  const [all, setAll] = useState(false);
  const list = loansNewestFirst(rows);
  const shown = all ? list : list.slice(0, FIRST);
  const cell = (v: string) => (v === "not reported" ? <span className="nd">{v}</span> : v);
  return (
    <div data-testid="fin-loans">
      <div className="tablewrap fin__wrap">
        <table className="fin__table">
          <caption className="visually-hidden">Loans to own campaign by election cycle, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Cycle</th>
              <th scope="col">Office</th>
              <th scope="col" className="num">Loans from the candidate</th>
              <th scope="col" className="num">Other loans</th>
              <th scope="col" className="num">Candidate loans repaid</th>
              <th scope="col" className="num">Other loans repaid</th>
              <th scope="col" className="num">Debts owed</th>
              <th scope="col">Summary</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const l = loanLine(r);
              return (
                <tr key={`${r.cycle}-${r.candidate_id}`} data-testid="fin-loan-row">
                  <td data-label="Cycle" className="mono">{l.cycle}</td>
                  <td data-label="Office">{cell(l.office)}</td>
                  <td data-label="Loans from the candidate" className="num mono">{cell(l.candidateLoans)}</td>
                  <td data-label="Other loans" className="num mono">{cell(l.otherLoans)}</td>
                  <td data-label="Candidate loans repaid" className="num mono">{cell(l.candidateRepaid)}</td>
                  <td data-label="Other loans repaid" className="num mono">{cell(l.otherRepaid)}</td>
                  <td data-label="Debts owed" className="num mono">{cell(l.debts)}</td>
                  <td data-label="Summary" className="mono">{cell(l.through)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > FIRST && (
        <p className="more more--fold no-print">
          <button type="button" className="btn btn--small" aria-expanded={all} onClick={() => setAll((a) => !a)} data-testid="fin-loans-fold">
            {all ? FOLD_UI.showFewer(FIRST, FINANCE.showAll) : FOLD_UI.showAll(list.length, FINANCE.showAll)}
          </button>
        </p>
      )}
    </div>
  );
}
