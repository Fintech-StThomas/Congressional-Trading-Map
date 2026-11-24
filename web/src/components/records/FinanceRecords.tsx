"use client";
// The full file's campaign finance tables (loans by cycle; leadership PAC spending by committee, cycle and FEC category),
// and the FEC's purpose groups per committee and cycle (a blank total is a negative figure the FEC does not publish), each
// with CSV and "Cite this" through DataTable. Rows come from lib/domain/finance.ts; a blank figure is an empty cell,
// refunds are their own columns and are never subtracted. A null block is one plain line, never zeros.
import type { CampaignFinance } from "@/lib/types";
import { LOAN_COLS, PAC_COLS, coverageLine, loanRows, pacRows } from "@/lib/domain/finance";
import { PURPOSE_COLS, purposeTableRows } from "@/lib/domain/finance-purposes";
import { FINANCE } from "@/lib/copy-finance";
import { DataTable, type TableCite } from "./DataTable";

export function FinanceRecords({ id, cf, cite }: { id: string; cf: CampaignFinance | null | undefined; cite: TableCite }) {
  const purposeRowsList = purposeTableRows(cf);
  return (
    <section id="rec-money" className="rec__sec" aria-labelledby="rec-money-h" data-testid="rec-money">
      <h2 id="rec-money-h">{FINANCE.title}</h2>
      {!cf ? (
        <p className="rec__note" data-testid="rec-money-none">{FINANCE.records.none}</p>
      ) : (
        <>
          <p className="rec__note">{coverageLine(cf)} {FINANCE.notShown}</p>
          <h3 className="rec__h3">{FINANCE.records.loansTitle}</h3>
          <p className="rec__note">{FINANCE.records.loansIntro}</p>
          <DataTable id="loans" title={FINANCE.records.loansTitle} cols={LOAN_COLS} rows={loanRows(cf)} file={`${id}-loans`} cite={cite} />
          <h3 className="rec__h3">{FINANCE.records.pacTitle}</h3>
          <p className="rec__note">{FINANCE.records.pacIntro}</p>
          {cf.leadership_pac.length === 0 && <p className="rec__note" data-testid="rec-pac-none">{cf.coverage.leadership_pac_note ?? FINANCE.records.pacNone}</p>}
          <DataTable id="pac" title={FINANCE.records.pacTitle} cols={PAC_COLS} rows={pacRows(cf)} file={`${id}-leadership-pac`} cite={cite} />
          <h3 className="rec__h3">{FINANCE.records.purposesTitle}</h3>
          <p className="rec__note">{FINANCE.records.purposesIntro}</p>
          {cf.leadership_pac.length > 0 && purposeRowsList.length === 0 && <p className="rec__note" data-testid="rec-purposes-none">{FINANCE.records.purposesNone}</p>}
          <DataTable id="purposes" title={FINANCE.records.purposesTitle} cols={PURPOSE_COLS} rows={purposeRowsList} file={`${id}-fec-purpose-groups`} cite={cite} />
        </>
      )}
    </section>
  );
}
