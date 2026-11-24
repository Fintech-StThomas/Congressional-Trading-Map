// "How the FEC groups this committee's spending": the FEC's own purpose groups for one leadership PAC cycle, as neutral
// bars with dollars, share of the groups' total and count. REFUNDS is a group like the others (nothing is subtracted).
// Three states: not available (null), none reported ([]), rows; a negative figure the FEC does not publish reads
// "not published", never zero. Bars are never red (red means a tie). Figures come from lib/domain/finance-purposes.ts.
import type { LeadershipPacYear } from "@/lib/types";
import { barPercent, shareText } from "@/lib/domain/finance";
import { purposeRows, purposeText, purposesState, purposesTotal } from "@/lib/domain/finance-purposes";
import { plural, reportedMoney } from "@/lib/format";
import { FINANCE } from "@/lib/copy-finance";

export function PacPurposes({ y, name }: { y: LeadershipPacYear; name: string }) {
  const state = purposesState(y);
  const rows = purposeRows(y);
  const total = purposesTotal(y);
  const count = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="fin__purposes" data-testid="fin-purposes">
      <h5 className="fin__h5">{FINANCE.purposesTitle}</h5>
      <p className="sub fin__purnote">{FINANCE.purposesNote}</p>
      {state === "unavailable" && <p className="fin__empty" data-testid="fin-purposes-unavailable">{FINANCE.purposesUnavailable}</p>}
      {state === "none" && <p className="fin__empty" data-testid="fin-purposes-none">{FINANCE.purposesNone}</p>}
      {state === "rows" && (
        <>
          <p className="fin__totals mono" data-testid="fin-purposes-total">{FINANCE.purposesTotal(reportedMoney(total), plural(count, "payment"), rows.filter((r) => r.total === null).length)}</p>
          <ul className="fin__bars fin__bars--purposes" aria-label={FINANCE.purposesChartLabel(name, y.cycle)}>
            {rows.map((r) => (
              <li key={r.key} className="fin__bar" data-testid="fin-purpose-row" data-purpose={r.purpose}>
                <span className="fin__label">{r.label}</span>
                <span className="fin__track" aria-hidden="true"><span className="fin__fill" style={{ width: `${barPercent(r.share)}%` }} /></span>
                <span className="fin__spent mono" data-label={FINANCE.purposeAmount}>
                  <span data-testid="fin-purpose-total">{purposeText(r)}</span>{" "}
                  <span className="sub">{r.share === null ? null : `${shareText(r.share)} of groups · `}{plural(r.count, "payment")}</span>
                </span>
              </li>
            ))}
          </ul>
          {rows.some((r) => r.isRefunds) && <p className="sub fin__refnote" data-testid="fin-purposes-refunds">{FINANCE.purposesRefundsNote}</p>}
        </>
      )}
    </div>
  );
}
