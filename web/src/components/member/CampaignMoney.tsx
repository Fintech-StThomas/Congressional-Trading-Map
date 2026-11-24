// "Campaign money" on the member page: campaign receipts per cycle (the FEC summary's totals, not ties), loans the candidate reported making to their own campaign (per cycle) and each
// linked leadership PAC's spending by FEC category, from MemberFile.campaign_finance. A null block is one plain line, never
// zeros. Placed after Activity, before Holdings. Wording is lib/copy-finance.ts; figures come from lib/domain/finance.ts.
import type { CampaignFinance } from "@/lib/types";
import { coverageLine, pacGroups } from "@/lib/domain/finance";
import { receiptsOf } from "@/lib/domain/finance-receipts";
import { FINANCE } from "@/lib/copy-finance";
import { RECEIPTS } from "@/lib/copy-finance-receipts";
import { LoansTable } from "@/components/member/LoansTable";
import { ReceiptsTable } from "@/components/member/ReceiptsTable";
import { LeadershipPacPanel } from "@/components/member/LeadershipPacPanel";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import "@/styles/finance.css";

export function CampaignMoney({ cf }: { cf: CampaignFinance | null | undefined }) {
  if (!cf) {
    return (
      <section className="section fin" id="money" aria-labelledby="money-h" data-testid="campaign-money">
        <h2 id="money-h">{FINANCE.title}</h2>
        <p className="section__note" data-testid="fin-none">{FINANCE.noSummary}</p>
      </section>
    );
  }
  const groups = pacGroups(cf.leadership_pac);
  const receipts = receiptsOf(cf);
  return (
    <section className="section fin" id="money" aria-labelledby="money-h" data-testid="campaign-money">
      <h2 id="money-h">{FINANCE.title}</h2>
      <p className="section__note">{FINANCE.intro}</p>
      <p className="fin__coverage sub" data-testid="fin-coverage">{coverageLine(cf)}</p>

      {receipts && (
        <>
          <h3 className="fin__h3">{RECEIPTS.title}</h3>
          <p className="section__note">{RECEIPTS.note}</p>
          {receipts.length === 0 ? (
            <p className="fin__empty" data-testid="fin-receipts-none">{RECEIPTS.none}</p>
          ) : (
            <ErrorBoundary label="receipts table"><ReceiptsTable rows={receipts} /></ErrorBoundary>
          )}
        </>
      )}

      <h3 className="fin__h3">{FINANCE.loansTitle}</h3>
      <p className="section__note">{FINANCE.loansNote}</p>
      {cf.loans.length === 0 ? (
        <p className="fin__empty" data-testid="fin-loans-none">{FINANCE.loansNone}</p>
      ) : (
        <ErrorBoundary label="loans table"><LoansTable rows={cf.loans} /></ErrorBoundary>
      )}

      <h3 className="fin__h3">{FINANCE.pacTitle}</h3>
      {groups.length === 0 ? (
        <p className="fin__empty" data-testid="fin-pac-none">{cf.coverage.leadership_pac_note}</p>
      ) : (
        <>
          <p className="section__note">{FINANCE.pacNote}</p>
          <ErrorBoundary label="leadership PAC spending">
            {groups.map((g) => <LeadershipPacPanel key={g.id} group={g} />)}
          </ErrorBoundary>
        </>
      )}
      <p className="notshown fin__notshown"><span className="notshown__k">{FINANCE.notShownLabel}</span> {FINANCE.notShown}</p>
    </section>
  );
}
