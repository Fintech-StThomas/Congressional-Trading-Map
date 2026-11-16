// Watchlists without accounts: the ids a reader follows (members and organisations), kept only in their own browser,
// and the one combined feed address built from them (/feed/w.xml?m=<ids>&o=<org ids>). Pure: parse (for the route and
// the browser), normalise (dedupe, sort, so equivalent lists give identical URLs and cache keys), limits, operations,
// the board-to-list rule and the merge of feed items. tests/watchlist.test.mjs loads this directly.
import { isMemberId, isOrgId } from "../data/ids.ts";
import type { FeedItem } from "./feed.ts";

/** At most this many members and, separately, organisations per list and per feed request. */
export const WATCH_MEMBERS_MAX = 25;
export const WATCH_ORGS_MAX = 25;
/** Items in the combined feed. */
export const WATCH_ITEMS = 100;
/** Longest raw query string the feed route reads; anything longer is refused before it is parsed. */
export const WATCH_QUERY_MAX = 2400;

export type Watchlist = { members: string[]; orgs: string[] };
export const emptyWatchlist = (): Watchlist => ({ members: [], orgs: [] });

/** Dedupe and sort ids; ids that are not valid for their kind are dropped. The list keeps no other state. */
export function normaliseWatchlist(l: { members?: unknown; orgs?: unknown }): Watchlist {
  const uniq = (xs: unknown, ok: (x: unknown) => x is string): string[] => [...new Set(Array.isArray(xs) ? xs.filter(ok) : [])].sort();
  return { members: uniq(l.members, isMemberId), orgs: uniq(l.orgs, isOrgId) };
}

export function watchSize(l: Watchlist): number {
  return l.members.length + l.orgs.length;
}

export type ParseResult = { ok: true; list: Watchlist } | { ok: false; error: string };

function split(v: string | null): string[] | null {
  if (v === null || v === "") return [];
  const parts = v.split(",");
  return parts.some((p) => p === "") ? null : parts;
}

/**
 * The feed route's query: `m` and `o` are comma-separated ids. Every id must be valid; more than the limit, an
 * unknown parameter, an empty list, a repeated parameter or an over-long query is an error with a plain message
 * (HTTP 400), never silently trimmed, so a URL always means exactly what it says. Ids are deduped and sorted.
 */
export function parseWatchlist(search: string | URLSearchParams): ParseResult {
  const raw = typeof search === "string" ? search.replace(/^\?/, "") : search.toString();
  if (raw.length > WATCH_QUERY_MAX) return { ok: false, error: "The address is too long." };
  const q = typeof search === "string" ? new URLSearchParams(raw) : search;
  for (const k of new Set(q.keys())) {
    if (k !== "m" && k !== "o") return { ok: false, error: `Unknown parameter “${k.slice(0, 20)}”. Use m (member ids) and o (organisation ids).` };
    if (q.getAll(k).length > 1) return { ok: false, error: `Parameter ${k} is given more than once.` };
  }
  const m = split(q.get("m"));
  const o = split(q.get("o"));
  if (m === null || o === null) return { ok: false, error: "A list has an empty item (check the commas)." };
  if (m.length > WATCH_MEMBERS_MAX) return { ok: false, error: `At most ${WATCH_MEMBERS_MAX} members can be followed in one feed.` };
  if (o.length > WATCH_ORGS_MAX) return { ok: false, error: `At most ${WATCH_ORGS_MAX} organisations can be followed in one feed.` };
  const badM = m.find((id) => !isMemberId(id));
  if (badM !== undefined) return { ok: false, error: "A member id is not valid (a member id is one capital letter and six digits)." };
  const badO = o.find((id) => !isOrgId(id));
  if (badO !== undefined) return { ok: false, error: "An organisation id is not valid." };
  const list = normaliseWatchlist({ members: m, orgs: o });
  if (watchSize(list) === 0) return { ok: false, error: "Name at least one member (m) or organisation (o) to follow." };
  return { ok: true, list };
}

/**
 * The path of the combined feed for a list: ids deduped and sorted so equivalent lists give identical URLs; ids beyond
 * the limits are left out (the page that offers the link says so); null when the list is empty.
 */
export function watchlistFeedHref(l: { members?: readonly string[]; orgs?: readonly string[] }): string | null {
  const n = normaliseWatchlist({ members: [...(l.members ?? [])], orgs: [...(l.orgs ?? [])] });
  const members = n.members.slice(0, WATCH_MEMBERS_MAX);
  const orgs = n.orgs.slice(0, WATCH_ORGS_MAX);
  const q = [members.length ? `m=${members.join(",")}` : "", orgs.length ? `o=${orgs.map(encodeURIComponent).join(",")}` : ""].filter(Boolean);
  return q.length ? `/feed/w.xml?${q.join("&")}` : null;
}

/** The same address with a site origin in front, for a link to copy into a feed reader. */
export function absoluteFeedUrl(origin: string, href: string): string {
  return `${origin.replace(/\/+$/, "")}${href}`;
}

export type Kind = "member" | "org";
export type AddResult = { ok: true; list: Watchlist; changed: boolean } | { ok: false; reason: "limit" | "invalid" };

export function isFollowing(l: Watchlist, kind: Kind, id: string): boolean {
  return (kind === "member" ? l.members : l.orgs).includes(id);
}

/** Follow one id. Refused (not trimmed) at the limit; following twice changes nothing. */
export function follow(l: Watchlist, kind: Kind, id: string): AddResult {
  if (!(kind === "member" ? isMemberId(id) : isOrgId(id))) return { ok: false, reason: "invalid" };
  if (isFollowing(l, kind, id)) return { ok: true, list: l, changed: false };
  const max = kind === "member" ? WATCH_MEMBERS_MAX : WATCH_ORGS_MAX;
  if ((kind === "member" ? l.members : l.orgs).length >= max) return { ok: false, reason: "limit" };
  return { ok: true, list: normaliseWatchlist({ members: kind === "member" ? [...l.members, id] : l.members, orgs: kind === "org" ? [...l.orgs, id] : l.orgs }), changed: true };
}

export function unfollow(l: Watchlist, kind: Kind, id: string): Watchlist {
  return { members: kind === "member" ? l.members.filter((x) => x !== id) : l.members, orgs: kind === "org" ? l.orgs.filter((x) => x !== id) : l.orgs };
}

/** Everything a saved board points at: the members and organisations of its member, organisation and tie items. */
export function boardWatchlist(board: { items: readonly { member?: string; org?: string }[] }): Watchlist {
  return normaliseWatchlist({ members: board.items.map((i) => i.member), orgs: board.items.map((i) => i.org) });
}

/** Add a list to another up to the limits; `skipped` counts the ids that did not fit (never silently dropped). */
export function mergeWatchlists(current: Watchlist, add: Watchlist): { list: Watchlist; added: number; skipped: number } {
  let list = current;
  let added = 0;
  let skipped = 0;
  for (const [kind, ids] of [["member", add.members], ["org", add.orgs]] as const) {
    for (const id of ids) {
      const r = follow(list, kind, id);
      if (!r.ok) skipped++;
      else if (r.changed) {
        list = r.list;
        added++;
      }
    }
  }
  return { list, added, skipped };
}

const day = (iso: string) => iso.slice(0, 10);

/** Items from several feeds as one: duplicates (same guid) once, newest date first (then guid, so the order is stable), at most `limit`. */
export function mergeItems(groups: readonly FeedItem[][], limit = WATCH_ITEMS): FeedItem[] {
  const seen = new Set<string>();
  const all: FeedItem[] = [];
  for (const g of groups) {
    for (const it of g) {
      if (seen.has(it.guid)) continue;
      seen.add(it.guid);
      all.push(it);
    }
  }
  return all.sort((a, b) => day(b.pubDate).localeCompare(day(a.pubDate)) || a.guid.localeCompare(b.guid)).slice(0, limit);
}
