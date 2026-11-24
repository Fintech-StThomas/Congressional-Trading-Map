"use client";
// The member table on /delays: sortable columns, a name search, chamber and current-members filters, CSV of the rows in view.
// The shared DataTable cannot do this (member links, "n/a" for missing shares, a chamber filter, caveat in the file).
import Link from "next/link";
import { useMemo, useState } from "react";
import { DELAYS } from "@/lib/copy";
import { DELAYS_AMEND } from "@/lib/copy-amend";
import { delaysCsv, filterViewRows, sortViewRows, type DelayFilter, type DelaySortKey, type DelayViewRow } from "@/lib/domain/delays";
import { count, days, percent } from "@/lib/format";
import { memberHref } from "@/lib/urls";
import { download } from "@/components/records/DataTable";
import { PartyTag } from "@/components/shared/Print";
import { Segmented, Switch } from "@/components/shared/ChipSelect";

const PAGE = 200;
const COLS: { k: DelaySortKey; label: string; num: boolean }[] = [
  { k: "name", label: "Member", num: false },
  { k: "count", label: "Trades", num: true },
  { k: "dated", label: "With both dates", num: true },
  { k: "over", label: DELAYS.overLabel, num: true },
  { k: "overShare", label: "Share of dated", num: true },
  { k: "median", label: "Median", num: true },
  { k: "p90", label: "90th pct.", num: true },
  { k: "max", label: "Longest", num: true },
  { k: "undated", label: "No date", num: true },
  { k: "dateCorrected", label: DELAYS_AMEND.column, num: true },
  { k: "amended", label: "Amended", num: true },
];

export function MembersTable({ rows }: { rows: DelayViewRow[] }) {
  const [sort, setSort] = useState<{ k: DelaySortKey; desc: boolean }>({ k: "count", desc: true });
  const [filter, setFilter] = useState<DelayFilter>({ chamber: "all", currentOnly: false, query: "" });
  const [limit, setLimit] = useState(PAGE);
  // A file built before the date-corrected bucket has no such count: leave the column out rather than show 0.
  const cols = useMemo(() => (rows.some((r) => r.dateCorrected !== null) ? COLS : COLS.filter((c) => c.k !== "dateCorrected")), [rows]);
  const view = useMemo(() => sortViewRows(filterViewRows(rows, filter), sort.k, sort.desc), [rows, filter, sort]);
  const shown = view.slice(0, limit);
  const filtered = view.length !== rows.length;
  const change = (f: Partial<DelayFilter>) => {
    setFilter((cur) => ({ ...cur, ...f }));
    setLimit(PAGE);
  };

  return (
    <div className="dl-members" data-testid="delays-members">
      <div className="dl-filters">
        <label className="dl-search">
          <span>Search by name</span>
          <input type="search" value={filter.query} onChange={(e) => change({ query: e.target.value })} placeholder="Name" />
        </label>
        <Segmented
          label="Chamber"
          name="dl-chamber"
          value={filter.chamber}
          options={[{ value: "all", label: "Both chambers", short: "Both" }, { value: "sen", label: "Senate" }, { value: "rep", label: "House" }]}
          onChange={(chamber) => change({ chamber })}
        />
        <Switch label="Current members only" on={filter.currentOnly} onChange={(currentOnly) => change({ currentOnly })} />
        <p className="dl-count mono" aria-live="polite" data-testid="delays-members-count">
          {filtered ? `${count(view.length)} of ${count(rows.length)} members` : `${count(rows.length)} members`}
        </p>
        <button
          type="button"
          className="btn btn--small"
          data-testid="delays-csv"
          onClick={() => download(`${DELAYS.csvFile}.csv`, delaysCsv(view, DELAYS.csvNote), "text/csv;charset=utf-8")}
        >
          Download CSV{filtered ? " (filtered)" : ""}
        </button>
      </div>
      <div className="dl-scroll" tabIndex={0} role="region" aria-label="Disclosure timing by member: table, scrolls">
        <table className="dl-table dl-membertable">
          <caption className="visually-hidden">Disclosure timing by member. Column buttons sort the table.</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} scope="col" className={c.num ? "dl-num" : undefined} aria-sort={sort.k === c.k ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button type="button" onClick={() => setSort((s) => ({ k: c.k, desc: s.k === c.k ? !s.desc : c.k !== "name" }))}>
                    {c.label}
                    <span className="dl-arrow" aria-hidden="true">{sort.k === c.k ? (sort.desc ? "↓" : "↑") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <Link href={memberHref(r.id)}>{r.name}</Link>
                  <span className="dl-note">
                    {r.party && <PartyTag party={r.party} />} {r.place ?? ""}
                  </span>
                </th>
                <td className="dl-num mono">{count(r.count)}</td>
                <td className="dl-num mono">{count(r.dated)}</td>
                <td className="dl-num mono">{count(r.over)}</td>
                <td className="dl-num mono">{percent(r.overShare)}</td>
                <td className="dl-num mono">{days(r.median)}</td>
                <td className="dl-num mono">{days(r.p90)}</td>
                <td className="dl-num mono">{days(r.max)}</td>
                <td className="dl-num mono">{count(r.undated)}</td>
                {cols.length === COLS.length && <td className="dl-num mono">{r.dateCorrected === null ? "n/a" : count(r.dateCorrected)}</td>}
                <td className="dl-num mono">{count(r.amended)}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={cols.length} className="dl-none">No members match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {view.length > shown.length && (
        <p className="dl-more">
          Showing {count(shown.length)} of {count(view.length)}.{" "}
          <button type="button" className="linkbtn" onClick={() => setLimit((n) => n + PAGE)}>Show {count(Math.min(PAGE, view.length - shown.length))} more</button>{" "}
          <button type="button" className="linkbtn" onClick={() => setLimit(view.length)}>Show all</button>
        </p>
      )}
    </div>
  );
}
