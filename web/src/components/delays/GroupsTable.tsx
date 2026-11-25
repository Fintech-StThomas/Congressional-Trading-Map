// A table of delay groups (chambers or years): one row per group with every band, the over-45-days count and share,
// the apart-from-bands counts, and the percentile figures. Missing figures read "n/a", never 0.
import { DELAYS } from "@/lib/copy";
import { DELAYS_AMEND } from "@/lib/copy-amend";
import { BAND_KEYS, overCount, overShare } from "@/lib/domain/delays";
import { count, days, percent } from "@/lib/format";
import type { DelayGroup } from "@/lib/types";

export type GroupRow = { key: string; label: string; g: DelayGroup };

export function GroupsTable({ id, heading, note, first, rows }: { id: string; heading: string; note: string; first: string; rows: GroupRow[] }) {
  // Files built before the date-corrected bucket have no such count: the column is left out rather than shown as 0.
  const corrected = rows.some((r) => r.g.date_corrected !== undefined);
  const unmatched = rows.some((r) => r.g.amended_unmatched !== undefined);
  return (
    <section className="dl-sec" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      <p className="dl-sub">{note}</p>
      <div className="dl-scroll" tabIndex={0} role="region" aria-label={`${heading}: table, scrolls`}>
        <table className="dl-table dl-groups">
          <thead>
            <tr>
              <th scope="col">{first}</th>
              <th scope="col" className="dl-num">Trades</th>
              {BAND_KEYS.map((k) => <th key={k} scope="col" className="dl-num">{DELAYS.bandLabels[k].replace(" days", "")}</th>)}
              <th scope="col" className="dl-num">{DELAYS.overLabel}</th>
              <th scope="col" className="dl-num">Share of dated</th>
              <th scope="col" className="dl-num">Before stated date</th>
              <th scope="col" className="dl-num">No date</th>
              {corrected && <th scope="col" className="dl-num">{DELAYS_AMEND.column}</th>}
              {unmatched && <th scope="col" className="dl-num">{DELAYS_AMEND.unmatchedColumn}</th>}
              <th scope="col" className="dl-num">Median</th>
              <th scope="col" className="dl-num">90th pct.</th>
              <th scope="col" className="dl-num">Longest</th>
              <th scope="col" className="dl-num">Amended</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, g }) => {
              const over = overCount(g.bands);
              return (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td className="dl-num mono">{count(g.count)}</td>
                  {BAND_KEYS.map((k) => <td key={k} className="dl-num mono">{count(g.bands[k])}</td>)}
                  <td className="dl-num mono">{count(over)}</td>
                  <td className="dl-num mono">{percent(overShare(over, g.dated))}</td>
                  <td className="dl-num mono">{count(g.negative)}</td>
                  <td className="dl-num mono">{count(g.undated)}</td>
                  {corrected && <td className="dl-num mono">{g.date_corrected === undefined ? "n/a" : count(g.date_corrected)}</td>}
                  {unmatched && <td className="dl-num mono">{g.amended_unmatched === undefined ? "n/a" : count(g.amended_unmatched)}</td>}
                  <td className="dl-num mono">{days(g.median)}</td>
                  <td className="dl-num mono">{days(g.p90)}</td>
                  <td className="dl-num mono">{days(g.max)}</td>
                  <td className="dl-num mono">{count(g.amended)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
