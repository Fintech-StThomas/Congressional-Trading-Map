// Organisation feeds (/feed/o/<id>.xml): which of an organisation's published ties become feed items, which member
// files must be read to build them (a hard bound), how a money tie is dated (never inventing a day), and the item text.
// Pure (no data access, no clock): lib/data/orgFeed.ts reads the files and calls this. tests/orgfeed.test.mjs loads it.
import type { Edge } from "../types.ts";
import type { TieEdge } from "../data/decode.ts";
import { amountText, date, NOT_DISCLOSED, yearSpan } from "../format.ts";
import { ORG_FEED } from "../copy-discovery.ts";
import { memberHref, siteUrl } from "../urls.ts";
import { TYPE_LABEL } from "./edges.ts";
import { oneLine } from "./escape.ts";
import { attribution, recentTrades, tradeItem, type FeedContext, type FeedItem, type FeedMember, type FeedTrade } from "./feed.ts";
import { addDays } from "./newweek.ts";
import { spendingSide } from "./pick.ts";

/** The most member files read to build one organisation feed (trade files and member files together). */
export const ORG_FEED_FILES = 25;
/** Items in an organisation feed. */
export const ORG_ITEMS = 50;

/** A money type this feed lists: PAC money from the organisation, and outside spending only where it supports the member. */
const MONEY_TYPES = new Set<string>(["pac_money", "outside_spending"]);

export type Need = { kind: "trades" | "member"; id: string };
export type Candidate = { tie: TieEdge; kind: "trades" | "money" };

/** Is this text a complete, valid calendar day (YYYY-MM-DD)? */
export function isFullDay(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

/**
 * The date of a money tie's feed item. The latest complete day among the tie's `last` date and the dates in the full
 * edge's evidence wins (`exact`). If no complete day is known but a year is, the item is dated 31 December of the
 * latest year (`yearOnly`: the item says so), or on the data build date (`cap`) when that is earlier, so a year still in
 * progress is never dated in the future. Otherwise null: the item is left out, never given a made-up day.
 */
export function moneyItemDate(last: string | null | undefined, evidenceDates: readonly (string | null | undefined)[] = [], cap?: string | null): { date: string; yearOnly: boolean } | null {
  const days = [last, ...evidenceDates].map((d) => (typeof d === "string" ? d.slice(0, 10) : "")).filter(isFullDay).sort();
  if (days.length) return { date: days[days.length - 1], yearOnly: false };
  const years = [last, ...evidenceDates].map((d) => /^(\d{4})(?!\d)/.exec(typeof d === "string" ? d : "")?.[1]).filter((y): y is string => y !== undefined).sort();
  if (!years.length) return null;
  const end = `${years[years.length - 1]}-12-31`;
  const limit = typeof cap === "string" ? cap.slice(0, 10) : "";
  return { date: isFullDay(limit) && limit < end ? limit : end, yearOnly: true };
}

/** The tie rows that can become items, newest `last` first (then member id, then type, so the choice is stable). */
export function candidates(ties: readonly TieEdge[]): Candidate[] {
  const out: Candidate[] = [];
  for (const tie of ties) {
    if (!tie._tie) continue;
    if (tie.type === "traded") out.push({ tie, kind: "trades" });
    else if (MONEY_TYPES.has(tie.type)) out.push({ tie, kind: "money" });
  }
  return out.sort((a, b) => (b.tie.last ?? "").localeCompare(a.tie.last ?? "") || a.tie._tie!.member.localeCompare(b.tie._tie!.member) || a.tie.type.localeCompare(b.tie.type));
}

/** The files a candidate needs: a trade file for a traded tie; the member's file to see which side outside spending is on, or to date a PAC tie whose row has no complete day. */
export function needsOf(c: Candidate, sideKnown: (tie: TieEdge) => boolean): Need[] {
  const member = c.tie._tie!.member;
  if (c.kind === "trades") return [{ kind: "trades", id: member }];
  if (c.tie.type === "outside_spending") return sideKnown(c.tie) ? [] : c.tie._tie!.edge ? [{ kind: "member", id: member }] : [];
  return !isFullDay(c.tie.last) && c.tie._tie!.edge ? [{ kind: "member", id: member }] : [];
}

const needKey = (n: Need) => `${n.kind}:${n.id}`;

/** Outside spending with a side on the row itself (a `note` column) needs no file; otherwise the side comes from the full edge. */
export const rowSideKnown = (tie: TieEdge): boolean => spendingSide({ note: tie.note, via: null }) !== null;

/**
 * Which candidates are built and which files are read, within `budget` new reads (`have` are files already read in
 * this request and cost nothing). Candidates are taken newest first; one that needs more new reads than remain is
 * skipped, never partly built. A tie that needs no file is always taken.
 */
export function planOrgFeed(cands: readonly Candidate[], budget: number, have: ReadonlySet<string> = new Set()): { chosen: Candidate[]; reads: Need[] } {
  const chosen: Candidate[] = [];
  const reads: Need[] = [];
  const planned = new Set<string>();
  for (const c of cands) {
    const fresh = needsOf(c, rowSideKnown).filter((n) => !have.has(needKey(n)) && !planned.has(needKey(n)));
    // a trades candidate that cannot be read has no items; a money candidate that needs a file it cannot have is dropped
    if (fresh.length > budget - reads.length) continue;
    for (const n of fresh) {
      planned.add(needKey(n));
      reads.push(n);
    }
    chosen.push(c);
  }
  return { chosen, reads };
}

/** Trades in this organisation (the trade's resolved `org` is the organisation's id) as items, newest made-public first. */
export function orgTradeItems(orgId: string, byMember: ReadonlyMap<string, FeedTrade[]>, c: FeedContext): FeedItem[] {
  const trades = [...byMember.values()].flat().filter((x) => x.trade.org === orgId);
  return recentTrades(trades, ORG_ITEMS).map((x) => tradeItem(x, c));
}

/** Evidence dates of the full edge `id` in a member's edges, [] when it is not there. */
export function evidenceDates(edges: readonly Edge[] | undefined, id: string | null): (string | null)[] {
  const e = id ? edges?.find((x) => x.id === id) : undefined;
  return (e?.evidence ?? []).map((v) => v.date);
}

/** Whether a money candidate counts as a tie to list: PAC money always; outside spending only where the side is "support" (against, or unknown, is left out). */
export function listableMoney(tie: TieEdge, fullEdge: Pick<Edge, "note" | "via"> | undefined): boolean {
  if (tie.type === "pac_money") return true;
  if (tie.type !== "outside_spending") return false;
  const side = spendingSide({ note: tie.note ?? fullEdge?.note ?? null, via: fullEdge?.via ?? null });
  return side === "support";
}

/** One money tie as an item, or null when it has no date at all. `titlePrefix` is the followed name in a combined feed. */
export function moneyItem(org: { id: string; name: string }, tie: TieEdge, member: FeedMember, evidence: readonly (string | null)[], c: FeedContext): FeedItem | null {
  const when = moneyItemDate(tie.last, evidence, c.built);
  if (!when) return null;
  const amount = amountText(tie.amount) ?? NOT_DISCLOSED;
  const ctx = { ...c, sourceName: ORG_FEED.moneySource };
  const records = ORG_FEED.records(tie.count);
  const description = [
    when.yearOnly ? ORG_FEED.yearOnly(Number(when.date.slice(0, 4))) : ORG_FEED.latest(date(when.date)),
    `Amount as disclosed: ${amount}. ${records}`,
    ORG_FEED.years(yearSpan(tie.first || null, tie.last || null)),
    `Case file: ${siteUrl(memberHref(member.id))}`,
    `${attribution(ctx)}.`,
  ].join(" ");
  return {
    title: `${oneLine(org.name)}: ${TYPE_LABEL[tie.type]} to ${oneLine(member.name)} (${member.party}-${oneLine(member.state)}), ${amount}`,
    link: siteUrl(memberHref(member.id)),
    guid: `${tie._tie?.edge ?? `${org.id}|${member.id}|${tie.type}`}:${when.date}`,
    pubDate: when.date,
    description,
  };
}
