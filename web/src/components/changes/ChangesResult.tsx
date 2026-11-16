"use client";
// The result of a comparison: the two releases named, the fixed explanation, summary counts, one table per class and
// the CSV. All wording is in lib/copy.ts (COMPARE); all counts and dates come through lib/format.
import Link from "next/link";
import { useMemo } from "react";
import { COMPARE } from "@/lib/copy";
import { count, date, releaseShort } from "@/lib/format";
import { releaseMemberHref } from "@/lib/urls";
import { compareMember, type CompareResult, type MemberSide } from "@/lib/domain/compare";
import { compareCsv, compareTables } from "@/lib/domain/compareRows";
import { download } from "@/components/shared/download";
import { ChangeTable } from "./ChangeTable";

export type OkSide = { id: string; side: MemberSide; built: string | null };

function ReleaseCard({ label, member, s }: { label: string; member: string; s: OkSide }) {
  return (
    <div className="cmp__release" data-testid="cmp-release" data-release={s.id}>
      <h2>{label}</h2>
      <p className="mono cmp__id">{releaseShort(s.id)}</p>
      <dl>
        <div><dt>Release id</dt><dd className="mono cmp__full">{s.id}</dd></div>
        <div><dt>Built</dt><dd>{date(s.built)}</dd></div>
      </dl>
      <p className="no-print"><Link href={releaseMemberHref(s.id, member)}>{COMPARE.memberAt(releaseShort(s.id))}</Link></p>
    </div>
  );
}

export function Explanation() {
  const c = COMPARE.classes;
  return (
    <aside className="cmp__explain" aria-labelledby="cmp-explain-h" data-testid="cmp-explain">
      <h2 id="cmp-explain-h">{COMPARE.explainTitle}</h2>
      <ul>{COMPARE.explain.map((x) => <li key={x}>{x}</li>)}</ul>
      <dl className="cmp__classes">
        {(["amended_filing", "changed_same_version", "added", "removed", "unchanged"] as const).map((k) => (
          <div key={k}><dt>{c[k].label}</dt><dd>{c[k].body}</dd></div>
        ))}
      </dl>
    </aside>
  );
}

function side(n: number): string {
  return n === 0 ? COMPARE.none : count(n);
}

function Summary({ r, a, b }: { r: CompareResult; a: OkSide; b: OkSide }) {
  const s = r.summary;
  const rows: [string, string, number][] = [
    ...(["amended_filing", "changed_same_version", "added", "removed", "unchanged"] as const).map((k): [string, string, number] => [COMPARE.heading.trades, COMPARE.classes[k].label, s.trades[k]]),
    ...(["changed", "added", "removed", "unchanged"] as const).map((k): [string, string, number] => [COMPARE.heading.ties, k === "unchanged" ? COMPARE.classes.unchanged.label : COMPARE.edgeKinds[k], s.edges[k]]),
    ...(["doc_changed", "net_worth_changed", "year_added", "year_removed"] as const).map((k): [string, string, number] => [COMPARE.heading.holdings, COMPARE.holdingsClasses[k].label, s.holdings[k]]),
    [COMPARE.heading.holdings, COMPARE.classes.unchanged.label, s.holdings.unchanged],
  ];
  return (
    <section aria-labelledby="cmp-sum-h" data-testid="cmp-summary">
      <h2 id="cmp-sum-h">Summary</h2>
      <p className="cmp__sub">
        Trades on file: {side(r.trades.total.a)} in the earlier release, {side(r.trades.total.b)} in the later.
        {" "}Ties in the member file: {side(r.edges.total.a)} and {side(r.edges.total.b)}.
        {!r.holdings.presentA && ` ${COMPARE.holdingsNoFile(releaseShort(a.id))}`}
        {!r.holdings.presentB && ` ${COMPARE.holdingsNoFile(releaseShort(b.id))}`}
      </p>
      <table className="cmp__table cmp__sumtable">
        <thead><tr><th scope="col">Section</th><th scope="col">Class</th><th scope="col" className="is-num">Records</th></tr></thead>
        <tbody>
          {rows.map(([sec, label, n]) => (
            <tr key={`${sec}${label}`}><td>{sec}</td><td>{label}</td><td className="is-num mono">{count(n)}</td></tr>
          ))}
        </tbody>
      </table>
      {s.trades.added > 0 && (
        <ul className="cmp__sub" data-testid="cmp-added-origins">
          {(["public_after", "public_before", "unknown"] as const).map((k) => {
            const n = r.trades.origins[k];
            return n > 0 ? <li key={k}>{count(n)}: {COMPARE.origin[k]}</li> : null;
          })}
        </ul>
      )}
    </section>
  );
}

export function ChangesResult({ member, a, b }: { member: string; a: OkSide; b: OkSide }) {
  const result = useMemo(() => compareMember(member, a.side, b.side), [member, a, b]);
  const tables = useMemo(() => compareTables(result), [result]);
  return (
    <div data-testid="cmp-result">
      <div className="cmp__releases">
        <ReleaseCard label={COMPARE.fromLabel} member={member} s={a} />
        <ReleaseCard label={COMPARE.toLabel} member={member} s={b} />
      </div>
      <Explanation />
      <Summary r={result} a={a} b={b} />
      <p className="no-print">
        <button type="button" className="btn btn--small" data-testid="cmp-csv" disabled={result.summary.changed === 0}
          onClick={() => download(`${COMPARE.csvName(member, releaseShort(a.id), releaseShort(b.id))}.csv`, compareCsv(result), "text/csv;charset=utf-8")}>
          {COMPARE.csv}
        </button>
      </p>
      {result.summary.changed === 0 && <p className="cmp__sub" role="status">{COMPARE.noChanges}</p>}
      {tables.map((t) => (
        <section key={t.id} className="cmp__sec" aria-labelledby={`h-${t.id}`} data-testid={`cmp-sec-${t.id}`}>
          <h3 id={`h-${t.id}`}>{t.title} <span className="mono">({count(t.rows.length)})</span></h3>
          <p className="cmp__sub">{t.body}</p>
          <ChangeTable t={t} />
        </section>
      ))}
    </div>
  );
}
