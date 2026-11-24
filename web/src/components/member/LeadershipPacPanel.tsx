"use client";
// One leadership PAC on the member page: its name and FEC committee link, a cycle selector (latest by default) and the
// spending by FEC category as horizontal bars with the dollar figure and share of spent. "No FEC category on the filing"
// is always the first row, with an explainer. Refunds are their own column and never subtracted. Bars are neutral
// (never red: red means a tie). Figures and the link come from lib/domain/finance.ts and lib/format.ts.
import { useId, useState } from "react";
import { barPercent, categoryRows, committeeUrl, cycleOf, defaultCycle, noCategoryShare, shareText, type PacGroup } from "@/lib/domain/finance";
import { plural, reportedMoney } from "@/lib/format";
import { FINANCE } from "@/lib/copy-finance";
import { Explain } from "@/components/shared/Explain";
import { ExternalIcon } from "@/components/shared/ExternalIcon";

export function LeadershipPacPanel({ group }: { group: PacGroup }) {
  const [cycle, setCycle] = useState<number>(defaultCycle(group));
  const selectId = useId();
  const y = cycleOf(group, cycle);
  const rows = categoryRows(y);
  const noneShare = noCategoryShare(y);
  const url = committeeUrl(group.id);
  return (
    <article className="fin__pac" data-testid="fin-pac" aria-label={group.name}>
      <header className="fin__pachead">
        <h4 className="fin__pacname">{group.name}</h4>
        <p className="fin__pacid mono">
          {group.id}
          {url && (
            <>
              {" · "}
              <a href={url} target="_blank" rel="noopener noreferrer">
                {FINANCE.fecLink} <ExternalIcon />
                <span className="visually-hidden"> for {group.name} (opens in a new tab)</span>
              </a>
            </>
          )}
        </p>
        <div className="fin__cycle no-print">
          <label htmlFor={selectId}>{FINANCE.pacCycle}</label>
          <select id={selectId} value={y.cycle} onChange={(e) => setCycle(Number(e.target.value))} data-testid="fin-cycle">
            {group.cycles.map((c) => <option key={c.cycle} value={c.cycle}>{c.cycle}</option>)}
          </select>
        </div>
      </header>
      <p className="fin__totals mono" data-testid="fin-pac-totals">
        {FINANCE.pacTotals(reportedMoney(y.total), plural(y.count, "row"), reportedMoney(y.refunds), plural(y.refund_count, "row"))}
      </p>
      {noneShare !== null && noneShare > 0 && (
        <p className="fin__nocat" data-testid="fin-nocat-line">
          <Explain term="nocategory">{FINANCE.pacNoCategoryLabel}</Explain>: {FINANCE.pacNoCategoryShare(shareText(noneShare))}
        </p>
      )}
      <div className="fin__cols" aria-hidden="true">
        <span>Category</span><span>{FINANCE.pacSpent}</span><span>{FINANCE.pacRefunds}</span>
      </div>
      <ul className="fin__bars" aria-label={FINANCE.pacChartLabel(group.name, y.cycle)}>
        {rows.map((r) => (
          <li key={r.key} className={r.isNone ? "fin__bar is-none" : "fin__bar"} data-testid={r.isNone ? "fin-row-nocat" : "fin-row"}>
            <span className="fin__label">{r.label}{r.category && <span className="sub mono"> {r.category}</span>}</span>
            <span className="fin__track" aria-hidden="true"><span className="fin__fill" style={{ width: `${barPercent(r.share)}%` }} /></span>
            <span className="fin__spent mono" data-label={FINANCE.pacSpent}>
              {reportedMoney(r.total)} <span className="sub">{r.share === null ? "share n/a" : `${shareText(r.share)} of spent`} · {plural(r.count, "row")}</span>
            </span>
            <span className="fin__refund mono" data-label={FINANCE.pacRefunds} data-testid="fin-refunds">
              {reportedMoney(r.refunds)} <span className="sub">{plural(r.refundCount, "row")}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="sub fin__refnote">{FINANCE.refundsNote}</p>
    </article>
  );
}
