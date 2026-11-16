"use client";
// Two or more saved items side by side, as saved: kind, parties, amount as displayed, years, source count, release.
// A plain table with a column per item. Nothing is totalled: amounts of different kinds of records are not added.
import { SAVED } from "@/lib/copy";
import { PARTY_NAMES, releaseShort } from "@/lib/format";
import type { Item } from "@/lib/domain/saved";

export function CompareTable({ items }: { items: Item[] }) {
  const R = SAVED.compare.rows;
  const cell = (rows: { head: string; value: (i: Item) => string }[]) =>
    rows.map((r) => (
      <tr key={r.head}>
        <th scope="row">{r.head}</th>
        {items.map((i) => <td key={i.key}>{r.value(i)}</td>)}
      </tr>
    ));
  return (
    <div className="saved-compare" role="region" aria-label={SAVED.compare.caption} tabIndex={0} data-testid="saved-compare">
      <table>
        <caption className="visually-hidden">{SAVED.compare.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{R.name}</th>
            {items.map((i) => <th key={i.key} scope="col">{i.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {cell([
            { head: R.kind, value: (i) => SAVED.kind[i.kind] },
            { head: R.parties, value: (i) => (i.parties?.length ? i.parties.map((p) => PARTY_NAMES[p]).join(", ") : SAVED.compare.notRecorded) },
            { head: R.amount, value: (i) => (i.kind === "tie" ? i.amount_text : SAVED.compare.noAmount) },
            { head: R.years, value: (i) => i.years || SAVED.compare.notRecorded },
            { head: R.sources, value: (i) => (i.citation ? String(i.citation.sources.length) : SAVED.compare.notRecorded) },
            { head: R.release, value: (i) => (i.release ? releaseShort(i.release) : SAVED.compare.latest) },
          ])}
        </tbody>
      </table>
    </div>
  );
}
