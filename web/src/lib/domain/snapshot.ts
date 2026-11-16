// What differs between a permalink's release and the latest one for one member, as the short phrases and the header
// counts the "since this snapshot" note shows. Built on the /changes comparison (compare.ts); never judges a change.
// Pure. Wording is in lib/copy.ts (SNAPSHOT).
import { SNAPSHOT } from "../copy.ts";
import { count, plural } from "../format.ts";
import type { CompareResult } from "./compare.ts";

/** The phrases for what changed ("3 trades with a newer filing version", ...), in a fixed order; empty when nothing did. */
export function snapshotParts(r: CompareResult): string[] {
  const t = r.summary.trades, e = r.summary.edges, h = r.summary.holdings;
  const P = SNAPSHOT.parts;
  const out: [number, string][] = [
    [t.amended_filing, `${plural(t.amended_filing, "trade")} ${P.amended}`],
    [t.changed_same_version, `${plural(t.changed_same_version, "trade")} ${P.changedSource}`],
    [t.added, `${plural(t.added, "trade")} ${P.added}`],
    [t.removed, `${plural(t.removed, "trade")} ${P.removed}`],
    [e.changed, `${plural(e.changed, "tie")} ${P.tiesChanged}`],
    [e.added, `${plural(e.added, "tie")} ${P.added}`],
    [e.removed, `${plural(e.removed, "tie")} ${P.removed}`],
    [h.doc_changed + h.net_worth_changed + h.year_added + h.year_removed, ""],
  ];
  const holdings = out[out.length - 1];
  holdings[1] = `${count(holdings[0])} ${P.holdings}`;
  return out.filter(([n]) => n > 0).map(([, text]) => text);
}

export type HeaderCounts = { trades: number; orgs: number; members: number };
export type CountKind = keyof HeaderCounts;

/** The member's header counts from a member file, or null when the file does not carry all three (missing is never zero). */
export function readCounts(member: unknown): HeaderCounts | null {
  const c = (member as { counts?: Record<string, unknown> } | null | undefined)?.counts;
  if (!c || typeof c.trades !== "number" || typeof c.orgs !== "number" || typeof c.members !== "number") return null;
  return { trades: c.trades, orgs: c.orgs, members: c.members };
}

/** The latest value of each header count that differs from the snapshot's; nothing for a count that is the same or unknown. */
export function differingCounts(snapshot: HeaderCounts, latest: HeaderCounts | null): Partial<HeaderCounts> {
  const out: Partial<HeaderCounts> = {};
  if (!latest) return out;
  for (const k of ["trades", "orgs", "members"] as const) if (latest[k] !== snapshot[k]) out[k] = latest[k];
  return out;
}
