// First/latest disclosed ranges and debt history, with the annual reports behind each figure.
import { HOLDINGS_NOT_SHOWN } from "@/lib/copy";
import { bandText, levYears, marginRows, recurringCreditors, shareText, tenureText } from "@/lib/domain/positions";
import type { HoldingsFile } from "@/lib/domain/holdings";
import { safeHttpUrl } from "@/lib/urls";
import { residenceCell } from "@/lib/domain/holdings-missing";

function Report({ h, doc, children }: { h: HoldingsFile; doc: string; children: React.ReactNode }) {
  const url = safeHttpUrl(h.docs[doc]?.url);
  return url ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
}

export function FinancialProfile({ h }: { h: HoldingsFile }) {
  const change = h.tenure_change ? tenureText(h.tenure_change) : null;
  const leverage = h.leverage;
  return <>
    <h3 className="hold__h">Change since first report</h3>
    {change && h.tenure_change ? <div data-testid="tenure-change">
      <p>{change.lead}</p><p>{change.change}</p>{change.caveat && <p>{change.caveat}</p>}
      <p className="hold__small"><Report h={h} doc={h.tenure_change.doc_first}>First report ({h.tenure_change.first_year})</Report> · <Report h={h} doc={h.tenure_change.doc_latest}>Latest report ({h.tenure_change.latest_year})</Report></p>
    </div> : <p className="hold__small">A comparison needs at least two annual reports and a data build with the comparison available.</p>}
    <p className="hold__small">{HOLDINGS_NOT_SHOWN.change}</p>
    {leverage && <div data-testid="leverage">
      <h3 className="hold__h">Liabilities over time</h3>
      <p className="hold__small">Highest debt during each report year, rather than debt at year end. Residence-secured debt is included in total debt and excluded from the share of disclosed assets. A year with no liability identified as residence-secured says so; that is not the same as none owed.</p>
      <div className="tablewrap"><table className="ties hold__table"><thead><tr><th>Report year</th><th>Total debt band</th><th>Residence-secured</th><th>Other debt / disclosed assets</th><th>Filed types</th></tr></thead>
        <tbody>{levYears(leverage).map((y) => <tr key={y.year}>
          <th scope="row"><Report h={h} doc={h.years[String(y.year)].doc}>{y.year}</Report></th>
          <td>{bandText(y.low, y.high)}</td><td>{residenceCell(h.years[String(y.year)]?.totals?.liabilities_residence_secured?.n, y.residence_low, y.residence_high)}</td><td>{shareText(y.share_low, y.share_high)}</td>
          <td>{Object.entries(y.by_type).map(([b, v]) => `${leverage.buckets[b]}: ${bandText(v[1], v[2])}`).join("; ") || "None disclosed"}</td>
        </tr>)}</tbody>
      </table></div>
      {recurringCreditors(leverage).length > 0 && <p className="hold__small">Creditors in multiple reports: {recurringCreditors(leverage).map((c) => `${c.creditor} (${c.years.join(", ")})`).join("; ")}.</p>}
      {marginRows(leverage).length > 0 && <details><summary>Margin and securities-backed loans ({marginRows(leverage).length})</summary><ul>{marginRows(leverage).map((r, i) => <li key={i}><Report h={h} doc={r.doc}>{r.year} · {r.creditor} · {r.type} · {r.owner} · {bandText(r.low, r.high)}</Report></li>)}</ul></details>}
      <p className="hold__small">{HOLDINGS_NOT_SHOWN.liabilities}</p>
    </div>}
  </>;
}
