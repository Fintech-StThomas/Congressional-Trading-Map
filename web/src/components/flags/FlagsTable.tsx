"use client";
// The flagged-trades table on /flags: two views (two or more rules, the default; made public in the last 30 days),
// a rule filter, and 100 rows at a time. Rows arrive compact from the server (FlagsView) with name maps. Each row
// links to the member, the company, and the trade's row in the member's trades table. Badges are neutral outlines:
// red means a tie and nothing else.
import Link from "next/link";
import { useMemo, useState } from "react";
import { FLAGS, RULE_IDS, RULE_LABEL, RULE_SHORT, type RuleId } from "@/lib/copy-flags";
import { madePublicWithin, maskRules } from "@/lib/domain/flags";
import { amountText, count, date, NOT_DISCLOSED } from "@/lib/format";
import { memberHref, memberTradeHref, orgHref } from "@/lib/urls";
import { actionLabel } from "@/components/member/tradeLabels";

/** member, trade id, date, available, ticker, org, action, low, high, rule mask */
export type CompactFlagRow = [string, string, string | null, string | null, string | null, string | null, string, number | null, number | null, number];
export type FlagsTableData = { buildDate: string; members: Record<string, string>; orgs: Record<string, string>; rows: CompactFlagRow[]; labels: Record<string, string> };

const PAGE = 100;

export function RuleChips({ rules, labels }: { rules: RuleId[]; labels?: Record<string, string> }) {
  return (
    <span className="flagchips">
      {rules.map((r) => (
        <span key={r} className="flagchip" title={labels?.[r] ?? RULE_LABEL[r]}>{RULE_SHORT[r]}</span>
      ))}
    </span>
  );
}

export function FlagsTable({ data }: { data: FlagsTableData }) {
  const [view, setView] = useState<"multi" | "recent">("multi");
  const [rule, setRule] = useState<RuleId | "all">("all");
  const [limit, setLimit] = useState(PAGE);
  const bit = rule === "all" ? 0 : 1 << RULE_IDS.indexOf(rule);
  const rows = useMemo(
    () => data.rows.filter((r) => {
      const mask = r[9];
      const inView = view === "multi" ? maskRules(mask).length >= 2 : madePublicWithin(r[3], data.buildDate);
      return inView && (!bit || mask & bit);
    }),
    [data, view, bit],
  );
  const shown = rows.slice(0, limit);
  const pick = (v: "multi" | "recent") => { setView(v); setLimit(PAGE); };

  return (
    <div className="fl-table" data-testid="flags-table">
      <div className="fl-controls">
        <div className="fl-seg" role="group" aria-label={FLAGS.viewAria}>
          <button type="button" className="chip" aria-pressed={view === "multi"} onClick={() => pick("multi")} data-testid="flags-view-multi">{FLAGS.viewMulti}</button>
          <button type="button" className="chip" aria-pressed={view === "recent"} onClick={() => pick("recent")} data-testid="flags-view-recent">{FLAGS.viewRecent}</button>
        </div>
        <label className="fl-filter">
          <span>{FLAGS.ruleFilter}</span>
          <select value={rule} onChange={(e) => { setRule(e.target.value as RuleId | "all"); setLimit(PAGE); }} data-testid="flags-rule-filter">
            <option value="all">{FLAGS.anyRule}</option>
            {RULE_IDS.map((r) => <option key={r} value={r}>{data.labels[r] ?? RULE_LABEL[r]}</option>)}
          </select>
        </label>
        <p className="fl-count mono" aria-live="polite" data-testid="flags-count">{FLAGS.shown(count(shown.length), count(rows.length))}</p>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{FLAGS.none}</p>
      ) : (
        <div className="tablewrap fl-wrap">
          <table className="fl-rows">
            <caption className="visually-hidden">{FLAGS.tableTitle}</caption>
            <thead>
              <tr>
                <th scope="col">{FLAGS.cols.member}</th>
                <th scope="col">{FLAGS.cols.traded}</th>
                <th scope="col">{FLAGS.cols.made}</th>
                <th scope="col">{FLAGS.cols.company}</th>
                <th scope="col">{FLAGS.cols.action}</th>
                <th scope="col" className="num">{FLAGS.cols.range}</th>
                <th scope="col">{FLAGS.cols.rules}</th>
                <th scope="col"><span className="visually-hidden">{FLAGS.rowLink}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([m, id, d, avail, ticker, org, action, low, high, mask]) => (
                <tr key={`${m}|${id}`} data-testid="flags-row">
                  <td data-label={FLAGS.cols.member}><Link href={memberHref(m)}>{data.members[m] ?? m}</Link></td>
                  <td className="mono" data-label={FLAGS.cols.traded}>{date(d)}</td>
                  <td className="mono" data-label={FLAGS.cols.made}>{date(avail)}</td>
                  <td data-label={FLAGS.cols.company}>
                    <span>
                      {org ? <Link href={orgHref(org)}>{data.orgs[org] ?? org}</Link> : <span className="nd">{NOT_DISCLOSED}</span>}
                      {ticker && <span className="sub mono"> {ticker}</span>}
                    </span>
                  </td>
                  <td data-label={FLAGS.cols.action}>{actionLabel(action)}</td>
                  <td className="num mono" data-label={FLAGS.cols.range}>{amountText({ low, high, exact: null }) ?? <span className="nd">{NOT_DISCLOSED}</span>}</td>
                  <td data-label={FLAGS.cols.rules}><RuleChips rules={maskRules(mask)} labels={data.labels} /></td>
                  <td className="fl-open">
                    <Link href={memberTradeHref(m, id)} aria-label={`${FLAGS.rowLink}: ${data.members[m] ?? m}, ${date(d)}`} data-testid="flags-row-link">{FLAGS.rowLink}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <p className="fl-more">
          <button type="button" className="btn btn--small" onClick={() => setLimit((n) => n + PAGE)} data-testid="flags-more">{FLAGS.more(Math.min(PAGE, rows.length - limit))}</button>
        </p>
      )}
    </div>
  );
}
