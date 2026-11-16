// The fixed notes around the results: what was searched and skipped, the empty state, the ranking rules and the
// incompleteness statement. Wording lives in lib/copy.ts (CONNECT); this only arranges it.
import { CONNECT } from "@/lib/copy";
import { andList } from "@/lib/format";
import type { Outcome } from "./load";

export function Searched({ outcome, ends, maxHops }: { outcome: Outcome; ends: string; maxHops: number }) {
  const { result, names } = outcome;
  const nm = (id: string) => names[id]?.name ?? id;
  const hubs = [...new Set([...result.hubsSkipped, ...outcome.expansionHubs])];
  const ex = result.excluded;
  const lines: string[] = [];
  if (hubs.length) lines.push(CONNECT.hubsSkipped(andList(hubs.map(nm))));
  if (result.derivedUnused) lines.push(CONNECT.derivedUnused(result.derivedUnused));
  if (ex.against) lines.push(CONNECT.against(ex.against));
  if (ex.sideUnknown) lines.push(CONNECT.sideUnknown(ex.sideUnknown));
  if (ex.context) lines.push(CONNECT.context(ex.context));
  if (outcome.failed.length) lines.push(CONNECT.readFailed(outcome.failed.length));
  return (
    <section className="cnotes" aria-labelledby="searched-h" data-testid="searched">
      <h2 id="searched-h" className="cnotes__h">{CONNECT.searchedTitle}</h2>
      <p>{CONNECT.searched(ends, outcome.read.length)}</p>
      {maxHops >= 3 && <p>{CONNECT.bounded(12, outcome.notExpanded)}</p>}
      {result.capped && <p>{CONNECT.capped}</p>}
      {lines.length > 0 && (
        <>
          <h3 className="cnotes__h">{CONNECT.skippedTitle}</h3>
          <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
    </section>
  );
}

export function EmptyResult({ maxHops }: { maxHops: number }) {
  return (
    <div className="empty" data-testid="no-path">
      <p>{CONNECT.none(maxHops)}</p>
      {maxHops < 3 && <p>{CONNECT.tryMore}</p>}
    </div>
  );
}

export function RankingNote() {
  return (
    <details className="cnotes cnotes--rank">
      <summary>{CONNECT.rankingTitle}</summary>
      <ol>{CONNECT.ranking.map((r) => <li key={r}>{r}</li>)}</ol>
      <p>{CONNECT.rankingNone}</p>
      <h3 className="cnotes__h">{CONNECT.rulesTitle}</h3>
      <ul>{CONNECT.rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </details>
  );
}

export function IncompleteNote() {
  return <p className="cnotes__incomplete" data-testid="incomplete">{CONNECT.incomplete}</p>;
}

