// The RSS responses for organisation feeds (/feed/o/<id>.xml) and the combined watchlist feed (/feed/w.xml), as
// functions of a `Data` reader so the static route, its remote-mode live twin and the dynamic route share them.
// Bounds: an organisation feed reads one shard plus at most ORG_FEED_FILES member files; a watch feed at most 25 member
// files in all (followed members first) and 25 organisation shards.
import type { Data } from "./reader.ts";
import { context, xml } from "./feedResponse.ts";
import { RequestFiles, orgFeedItems, readOrgFile } from "./orgFeed.ts";
import { mapLimit } from "./server.ts";
import { SITE } from "../copy.ts";
import { ORG_FEED, WATCH } from "../copy-discovery.ts";
import { orgHref, orgFeedHref, siteUrl } from "../urls.ts";
import { isOrgId } from "./ids.ts";
import { MEMBER_ITEMS, READ_CONCURRENCY, buildFeedFromItems, channelDescription, recentTrades, tradeItem, type FeedItem } from "../domain/feed.ts";
import { ORG_FEED_FILES, ORG_ITEMS } from "../domain/orgfeed.ts";
import { oneLine } from "../domain/escape.ts";
import { WATCH_ITEMS, WATCH_MEMBERS_MAX, WATCH_ORGS_MAX, mergeItems, parseWatchlist, watchlistFeedHref } from "../domain/watchlist.ts";

const NOT_FOUND = () => new Response("Not found", { status: 404 });
const text = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** The org id in a "/feed/o/<file>" last segment ("co%3A320193.xml", already decoded or not), or null. */
export function orgIdOfFile(file: string): string | null {
  if (!file.endsWith(".xml") || file.length > 120) return null;
  let id: string;
  try {
    id = decodeURIComponent(file.slice(0, -4));
  } catch {
    return null;
  }
  return isOrgId(id) ? id : null;
}

/** One organisation's feed. `file` is the URL's last segment. The id is validated before any read. */
export async function orgFeedResponse(data: Data, file: string): Promise<Response> {
  const id = orgIdOfFile(file);
  if (!id) return NOT_FOUND();
  const entry = await readOrgFile(data, id);
  if (!entry) return NOT_FOUND();
  const c = await context(data);
  const items = (await orgFeedItems(data, entry, new RequestFiles(data), c, ORG_FEED_FILES)).sort(
    (a, b) => b.pubDate.slice(0, 10).localeCompare(a.pubDate.slice(0, 10)) || a.guid.localeCompare(b.guid),
  );
  const name = oneLine(entry.org.name);
  const channel = {
    title: ORG_FEED.title(name),
    link: siteUrl(orgHref(id)),
    self: siteUrl(orgFeedHref(id)),
    description: channelDescription(`${ORG_FEED.note(name, ORG_FEED_FILES)} ${ORG_FEED.moneyRule}`, c),
  };
  return xml(buildFeedFromItems(channel, mergeItems([items], ORG_ITEMS), c));
}

/** The combined feed for `/feed/w.xml?m=…&o=…` (the raw query string). Bad input is a 400 with a plain message; the query is never logged. */
export async function watchFeedResponse(data: Data, search: string): Promise<Response> {
  const parsed = parseWatchlist(search);
  if (!parsed.ok) return text(400, `${WATCH.badRequest}: ${parsed.error}\n`);
  const { members, orgs } = parsed.list;
  const unknown = (await Promise.all(members.map((m) => data.isKnownMember(m)))).some((ok) => !ok);
  if (unknown) return text(400, `${WATCH.badRequest}: a member id is not in this data.\n`);
  const c = await context(data);
  const mi = await data.getMemberIndex();
  const files = new RequestFiles(data);
  const memberItems = await mapLimit(members, READ_CONCURRENCY, async (id): Promise<FeedItem[]> => {
    const m = mi.get(id);
    return m ? recentTrades(await files.tradesOf(m), MEMBER_ITEMS).map((x) => tradeItem(x, c)) : [];
  });
  // Organisation shards: at most WATCH_ORGS_MAX, read with bounded concurrency; a missing one is skipped.
  const shards = await mapLimit(orgs.slice(0, WATCH_ORGS_MAX), READ_CONCURRENCY, async (id) => ({ id, file: await readOrgFile(data, id) }));
  const orgItems: FeedItem[][] = [];
  for (const { file } of shards) {
    if (!file) continue; // sequential: the member-file bound is shared, followed members first
    orgItems.push(await orgFeedItems(data, file, files, c, Math.max(0, WATCH_MEMBERS_MAX - files.size), `${oneLine(file.org.name)}: `));
  }
  const href = watchlistFeedHref(parsed.list) as string;
  const channel = {
    title: WATCH.channelTitle,
    link: SITE.url,
    self: siteUrl(href),
    description: channelDescription(WATCH.channelNote(members.length, orgs.length), c),
  };
  const res = xml(buildFeedFromItems(channel, mergeItems([...memberItems, ...orgItems], WATCH_ITEMS), c));
  res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res;
}
