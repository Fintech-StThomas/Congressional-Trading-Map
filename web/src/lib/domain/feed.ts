// RSS 2.0 feeds of stock trades by the date they were made public: which members to read, how trades become feed
// items, and the XML itself. Pure (no data access, no clock): the routes in app/feed read the files and hand the rows
// here; tests/feed.test.mjs loads this directly. Filings are untrusted text, so every data string is escaped.
import type { MemberSummary, Meta } from "../types.ts";
import { FEED, SITE } from "../copy.ts";
import { amountText, date, NOT_DISCLOSED, releaseShort } from "../format.ts";
import { metaSources } from "../data/meta.ts";
import type { TradeRow } from "../data/decode.ts";
import { isReleaseId } from "../data/release.ts";
import { memberHref, safeHttpUrl, siteUrl } from "../urls.ts";
import type { WallYears } from "./wallyears.ts";
import { escapeXml, oneLine } from "./escape.ts";

/** Items in the site feed and in a member feed. */
export const SITE_ITEMS = 100;
export const MEMBER_ITEMS = 50;
/** The most member files read to build the site feed (bounded concurrency in the route). */
export const SITE_MEMBER_FILES = 60;
/** Concurrent member-file reads. */
export const READ_CONCURRENCY = 8;
/** Feed readers recheck after a day (the data changes once a day). */
export const FEED_TTL_MINUTES = 1440;

export type FeedMember = Pick<MemberSummary, "id" | "name" | "party" | "state">;
export type FeedTrade = { member: FeedMember; trade: TradeRow };

/**
 * Which members' trade files the site feed reads: members with trades in the data's latest two years (from
 * wall-years.json), those with the most trades in the latest year first; without that file, the members with the most
 * trades overall. At most `cap` of them, ties broken by id so the choice is stable.
 */
export function pickFeedMembers(members: MemberSummary[], wall: WallYears | null, cap = SITE_MEMBER_FILES): MemberSummary[] {
  const last = wall?.years[1] ?? null;
  const score = (m: MemberSummary) => {
    const y = last === null ? undefined : wall?.members.get(m.id);
    return { a: y?.trades.get(last as number) ?? 0, b: y?.trades.get((last as number) - 1) ?? 0 };
  };
  return members
    .filter((m) => (m.counts?.trades ?? 0) > 0)
    .map((m) => ({ m, s: score(m) }))
    .filter(({ s }) => last === null || s.a + s.b > 0)
    .sort((x, y) => y.s.a - x.s.a || y.s.b - x.s.b || (y.m.counts?.trades ?? 0) - (x.m.counts?.trades ?? 0) || x.m.id.localeCompare(y.m.id))
    .slice(0, cap)
    .map(({ m }) => m);
}

/** Newest made-public first (by the `available` date, then id). Trades with no available date have no item date and are dropped. */
export function recentTrades(items: FeedTrade[], limit: number): FeedTrade[] {
  return items
    .filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x.trade.available ?? ""))
    .sort((a, b) => (b.trade.available as string).slice(0, 10).localeCompare((a.trade.available as string).slice(0, 10)) || a.trade.id.localeCompare(b.trade.id))
    .slice(0, limit);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An ISO date or timestamp as an RFC 822 date (RSS pubDate). A bare date is read as UTC midnight; null when unparseable. */
export function rfc822(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
}

/** The name of the trade source in meta.json (hf_trades in builds, ptr in the fixtures), else a plain description. */
export function tradeSourceName(meta: Meta): string {
  const all = metaSources(meta);
  const s = all.find((x) => x.id === "hf_trades") ?? all.find((x) => x.id === "ptr");
  const name = typeof s?.name === "string" ? oneLine(s.name) : "";
  return name || "congressional periodic transaction reports";
}

export type FeedContext = { sourceName: string; release: string | null; built: string | null };

/** "Source: <name>; Paper Trail data release <short id or 'latest build'> built <date>". */
export function attribution(c: FeedContext): string {
  return FEED.source(c.sourceName, c.release && isReleaseId(c.release) ? releaseShort(c.release) : FEED.latestBuild, c.built ? date(c.built) : FEED.unknownBuild);
}

const ACTION: Record<string, string> = { buy: "buy", sell: "sell", exchange: "exchange", other: "other transaction" };

/** "<Member> (<party>-<state>): <action> <asset or ticker>, <amount range as displayed>". */
export function itemTitle(m: FeedMember, t: TradeRow): string {
  const action = (ACTION[t.action] ?? "other transaction") + (t.action === "sell" && t.partial ? " (partial)" : "");
  const asset = oneLine(t.asset) || oneLine(t.ticker) || FEED.noAsset;
  const amount = amountText({ low: t.low ?? null, high: t.high ?? null, exact: null }) ?? NOT_DISCLOSED;
  return `${oneLine(m.name)} (${m.party}-${oneLine(m.state)}): ${action} ${asset}, ${amount}`;
}

/** Plain-text description: dates as filed, owner as filed, the filing link (http or https only) and the attribution. */
export function itemDescription(t: TradeRow, c: FeedContext): string {
  const owner = t.owner === "unspecified" || !t.owner ? FEED.ownerUnstated : oneLine(t.owner);
  const filing = safeHttpUrl(t.url);
  return [
    `Transaction date as filed: ${date(t.date)}.`,
    `Made public: ${date(t.available)}.`,
    `Owner as filed: ${owner}.`,
    filing ? `Filing: ${filing}` : "Filing: no public link for this record.",
    `${attribution(c)}.`,
  ].join(" ");
}

const tag = (name: string, text: string, attrs = "") => `<${name}${attrs}>${escapeXml(text)}</${name}>`;

export type Channel = { title: string; link: string; self: string; description: string };

/** The whole RSS 2.0 document. `lastBuildDate` is the data build time (omitted when the build time is unknown), never the render time. */
export function buildFeed(channel: Channel, items: FeedTrade[], c: FeedContext): string {
  const lastBuild = rfc822(c.built);
  const parts = items.map(({ member, trade }) => {
    const pub = rfc822(trade.available) as string;
    return [
      "<item>",
      tag("title", itemTitle(member, trade)),
      tag("link", siteUrl(memberHref(member.id))),
      tag("guid", trade.id, ' isPermaLink="false"'),
      tag("pubDate", pub),
      tag("description", itemDescription(trade, c)),
      "</item>",
    ].join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    tag("title", channel.title),
    tag("link", channel.link),
    tag("description", channel.description),
    "<language>en-us</language>",
    `<atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml"/>`,
    lastBuild ? tag("lastBuildDate", lastBuild) : "",
    tag("ttl", String(FEED_TTL_MINUTES)),
    tag("generator", SITE.name),
    ...parts,
    "</channel></rss>",
    "",
  ].join("");
}

/** The channel description: what the feed lists, the amounts rule, the disclaimer and the build. */
export function channelDescription(note: string, c: FeedContext): string {
  return [note, FEED.amounts, FEED.noDate, SITE.disclaimer, `${attribution(c)}.`].join(" ");
}

export const FEED_CONTENT_TYPE = "application/rss+xml; charset=utf-8";
