"use client";
// The /new table (client): the rows for the 7 days to the build date arrive formatted from the server; this component
// only filters by chamber and action, writes the count line and renders. Nothing is fetched in the browser.
import Link from "next/link";
import { useMemo, useState } from "react";
import { NEW } from "@/lib/copy-discovery";
import { DELAYS } from "@/lib/copy";
import { filterRows, actionsIn, type Chamber, type NewRow } from "@/lib/domain/newweek";
import { PartyTag } from "@/components/shared/Print";
import { ExternalIcon } from "@/components/shared/ExternalIcon";

type Props = { rows: NewRow[]; windowStart: string | null; windowEnd: string | null; files: number };

export function NewView({ rows, windowEnd, files }: Props) {
  const [chamber, setChamber] = useState<Chamber>("all");
  const [action, setAction] = useState("all");
  const actions = useMemo(() => actionsIn(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, { chamber, action }), [rows, chamber, action]);
  const actionLabel = (a: string) => rows.find((r) => r.action === a)?.actionText.replace(/ \(partial\)$/, "") ?? a;

  return (
    <div className="page" data-testid="new-page">
      <h1>{NEW.title}</h1>
      <p className="lede">{NEW.lede}</p>
      {windowEnd === null ? (
        <p className="empty" data-testid="new-nodate">{NEW.noBuildDate}</p>
      ) : (
        <>
          <p className="section__note">{NEW.bound(files)} {NEW.dated}</p>
          <div className="filters">
            <label>
              <span>{NEW.filterChamber}</span>
              <select value={chamber} onChange={(e) => setChamber(e.target.value as Chamber)} data-testid="new-chamber">
                <option value="all">{NEW.chambers.all}</option>
                <option value="rep">{NEW.chambers.rep}</option>
                <option value="sen">{NEW.chambers.sen}</option>
              </select>
            </label>
            <label>
              <span>{NEW.filterAction}</span>
              <select value={action} onChange={(e) => setAction(e.target.value)} data-testid="new-action">
                <option value="all">{NEW.actionAll}</option>
                {actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
              </select>
            </label>
            <p className="filters__count mono" aria-live="polite" data-testid="new-count">
              {NEW.count(shown.length, windowEnd)}
              {shown.length !== rows.length ? ` (${NEW.filtered(shown.length, rows.length)})` : ""}
            </p>
            <Link className="btn btn--small" href="/feed/trades.xml" prefetch={false} data-testid="new-feed-link">{NEW.subscribe}</Link>
          </div>
          {shown.length === 0 ? (
            <p className="empty" data-testid="new-empty">{NEW.empty}</p>
          ) : (
            <div className="tablewrap">
              <table className="ties" data-testid="new-table">
                <caption className="visually-hidden">{NEW.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{NEW.cols.available}</th>
                    <th scope="col">{NEW.cols.member}</th>
                    <th scope="col">{NEW.cols.action}</th>
                    <th scope="col">{NEW.cols.asset}</th>
                    <th scope="col" className="num">{NEW.cols.amount}</th>
                    <th scope="col">{NEW.cols.owner}</th>
                    <th scope="col">{NEW.cols.date}</th>
                    <th scope="col">{NEW.cols.lag}</th>
                    <th scope="col">{NEW.cols.filing}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} data-testid="new-row">
                      <td data-label={NEW.cols.available} className="mono">{r.availableText}</td>
                      <td data-label={NEW.cols.member}>
                        <Link href={r.member.href} className="ties__name">{r.member.name}</Link>
                        <span className="ties__sub"><PartyTag party={r.member.party} /> {r.member.seatText}</span>
                      </td>
                      <td data-label={NEW.cols.action}>{r.actionText}</td>
                      <td data-label={NEW.cols.asset}>
                        {r.org ? <Link href={r.org.href}>{r.asset}</Link> : r.asset}
                        <span className="ties__sub">{r.ticker ?? NEW.noTicker}</span>
                      </td>
                      <td data-label={NEW.cols.amount} className="num mono">{r.amountText}</td>
                      <td data-label={NEW.cols.owner}>{r.ownerText}</td>
                      <td data-label={NEW.cols.date} className="mono">{r.dateText}</td>
                      <td data-label={NEW.cols.lag} className="mono">
                        {r.lagText}
                        {r.over && <span className="late" title={DELAYS.overTitle} aria-label={DELAYS.overTitle}>{DELAYS.overChip}</span>}
                      </td>
                      <td data-label={NEW.cols.filing}>
                        {r.filing ? <a href={r.filing} target="_blank" rel="noopener noreferrer">{NEW.filingLink} <ExternalIcon /></a> : <span className="nd">{NEW.noFiling}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
