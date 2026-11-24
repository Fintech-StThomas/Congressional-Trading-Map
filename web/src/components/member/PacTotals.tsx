// "Money in and out, as summarised by the FEC": the FEC's committee summary for one leadership PAC cycle (receipts, total
// disbursements, contributions to other committees and candidates, operating expenditures, cash on hand, through <date>), a link to
// the FEC committee page and a one-line note on how the figures relate to the purpose groups and the operating-spending table.
// Neutral colours only (red means a tie). A file built before totals existed renders nothing; null totals say "not reported".
// Figures and strings come from lib/domain/finance-totals.ts; nothing is computed here.
import "@/styles/finance-totals.css";
import type { LeadershipPacYear } from "@/lib/types";
import { committeeUrl } from "@/lib/domain/finance";
import { throughText, totalsLines, totalsState } from "@/lib/domain/finance-totals";
import { TOTALS } from "@/lib/copy-finance-totals";
import { ExternalIcon } from "@/components/shared/ExternalIcon";

export function PacTotals({ y, name }: { y: LeadershipPacYear; name: string }) {
  const state = totalsState(y);
  if (state === "absent") return null;
  const through = throughText(y);
  const url = committeeUrl(y.committee_id);
  return (
    <div className="fin__totalsbox" data-testid="fin-totals">
      <h5 className="fin__h5">{TOTALS.title}</h5>
      {state === "unavailable" ? (
        <p className="fin__empty" data-testid="fin-totals-unavailable">{TOTALS.unavailable}</p>
      ) : (
        <>
          <dl className="fin__figs" aria-label={`${name}, ${y.cycle} cycle: ${TOTALS.title}`}>
            {totalsLines(y).map((l) => (
              <div key={l.key} className="fin__fig" data-testid={`fin-totals-${l.key}`}>
                <dt>{l.label}</dt>
                <dd className="mono">{l.value}</dd>
              </div>
            ))}
          </dl>
          <p className="sub fin__through" data-testid="fin-totals-through">
            {through}
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {TOTALS.fecLink} <ExternalIcon />
                  <span className="visually-hidden"> for {name} (opens in a new tab)</span>
                </a>
              </>
            )}
          </p>
        </>
      )}
      {state === "figures" && <p className="sub fin__purnote" data-testid="fin-totals-note">{TOTALS.note}</p>}
      <p className="sub fin__purnote" data-testid="fin-totals-reconcile">{TOTALS.reconcile}</p>
    </div>
  );
}
