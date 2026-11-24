// The compact "Campaign money" block of the printed case file: loans per cycle and, for each leadership PAC, its latest
// cycle's categories with refunds in their own column. Server component; figures come from lib/domain/finance.ts.
// Renders nothing when the member has no FEC campaign summary (no zeros are invented).
import type { CampaignFinance } from "@/lib/types";
import { categoryRows, committeeUrl, coverageLine, cycleOf, defaultCycle, loanLine, loansNewestFirst, pacGroups, shareText } from "@/lib/domain/finance";
import { purposeRows, purposeText } from "@/lib/domain/finance-purposes";
import { plural, reportedMoney } from "@/lib/format";
import { FINANCE } from "@/lib/copy-finance";

const TOP_CATEGORIES = 8;
const TOP_PURPOSES = 6;

export function CaseFileMoney({ cf }: { cf: CampaignFinance | null | undefined }) {
  if (!cf) return null;
  const loans = loansNewestFirst(cf.loans).slice(0, 6);
  const groups = pacGroups(cf.leadership_pac);
  return (
    <section className="cf__sec" data-testid="cf-money">
      <h3>{FINANCE.title}</h3>
      <p className="cf__note">{coverageLine(cf)} {FINANCE.notShown}</p>
      {loans.length > 0 ? (
        <table className="cf__table">
          <caption className="cf__cap">{FINANCE.loansTitle}. {FINANCE.loansNote}</caption>
          <thead><tr><th>Cycle</th><th>Office</th><th className="num">From the candidate</th><th className="num">Other</th><th className="num">Candidate repaid</th><th className="num">Other repaid</th><th className="num">Debts owed</th></tr></thead>
          <tbody>
            {loans.map((r) => {
              const l = loanLine(r);
              return (
                <tr key={`${r.cycle}-${r.candidate_id}`}>
                  <td className="mono">{l.cycle}</td><td>{l.office}</td><td className="num mono">{l.candidateLoans}</td><td className="num mono">{l.otherLoans}</td>
                  <td className="num mono">{l.candidateRepaid}</td><td className="num mono">{l.otherRepaid}</td><td className="num mono">{l.debts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="cf__note">{FINANCE.loansNone}</p>
      )}
      {groups.length === 0 ? (
        <p className="cf__note">{cf.coverage.leadership_pac_note}</p>
      ) : (
        groups.map((g) => {
          const y = cycleOf(g, defaultCycle(g));
          const rows = categoryRows(y);
          const url = committeeUrl(g.id);
          const purposes = purposeRows(y);
          return (
            <div key={g.id}>
            {purposes.length > 0 && (
              <table className="cf__table" data-testid="cf-purposes">
                <caption className="cf__cap">{FINANCE.purposesTitle}: {g.name} ({g.id}), {y.cycle} cycle. {FINANCE.purposesNote} {FINANCE.purposesRefundsNote}</caption>
                <thead><tr><th>FEC group</th><th className="num">Total</th><th className="num">Share</th><th className="num">Payments</th></tr></thead>
                <tbody>
                  {purposes.slice(0, TOP_PURPOSES).map((r) => (
                    <tr key={r.key}><td>{r.label}</td><td className="num mono">{purposeText(r)}</td><td className="num mono">{shareText(r.share)}</td><td className="num mono">{plural(r.count, "payment")}</td></tr>
                  ))}
                  {purposes.length > TOP_PURPOSES && <tr><td colSpan={4} className="cf__small">{purposes.length - TOP_PURPOSES} more groups are in the full file.</td></tr>}
                </tbody>
              </table>
            )}
            <table className="cf__table">
              <caption className="cf__cap">{FINANCE.opexTitle} ({FINANCE.pacTitle}): {g.name} ({g.id}), {y.cycle} cycle{url ? ` · ${url}` : ""}. Spent {reportedMoney(y.total)}; refunds {reportedMoney(y.refunds)}, not subtracted.</caption>
              <thead><tr><th>FEC category</th><th className="num">Spent</th><th className="num">Share</th><th className="num">Refunds</th></tr></thead>
              <tbody>
                {rows.slice(0, TOP_CATEGORIES).map((r) => (
                  <tr key={r.key}><td>{r.label}</td><td className="num mono">{reportedMoney(r.total)}</td><td className="num mono">{shareText(r.share)}</td><td className="num mono">{reportedMoney(r.refunds)}</td></tr>
                ))}
                {rows.length > TOP_CATEGORIES && <tr><td colSpan={4} className="cf__small">{rows.length - TOP_CATEGORIES} more categories are in the full file.</td></tr>}
              </tbody>
            </table>
            </div>
          );
        })
      )}
    </section>
  );
}
