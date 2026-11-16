// The RSS feed responses (/feed/trades.xml, /feed/m/<id>.xml) as functions of a `Data` reader, so the static routes and
// their remote-mode live twins share one implementation. Reads at most SITE_MEMBER_FILES member trade files with
// bounded concurrency; the XML itself is built by lib/domain/feed.ts. Each takes a reader bound to one release.
import type { Data } from "./reader.ts";
import { mapLimit } from "./server.ts";
import { decodeTradeFile } from "./decode.ts";
import { metaBuilt } from "./meta.ts";
import { decodeWallYears, type WallYears, type WallYearsRaw } from "../domain/wallyears.ts";
import { FEED, SITE } from "../copy.ts";
import { memberHref, siteUrl } from "../urls.ts";
import { oneLine } from "../domain/escape.ts";
import {
  FEED_CONTENT_TYPE, MEMBER_ITEMS, READ_CONCURRENCY, SITE_ITEMS, SITE_MEMBER_FILES,
  buildFeed, channelDescription, pickFeedMembers, recentTrades, tradeSourceName, type FeedContext, type FeedTrade,
} from "../domain/feed.ts";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

const xml = (body: string) => new Response(body, { headers: { "Content-Type": FEED_CONTENT_TYPE } });

async function context(data: Data): Promise<FeedContext> {
  const meta = await data.getMeta();
  return { sourceName: tradeSourceName(meta), release: data.release, built: metaBuilt(meta) };
}

/** wall-years.json when this build has it and it decodes; null otherwise (older builds, the fixtures). */
async function wallYears(data: Data): Promise<WallYears | null> {
  try {
    const raw = await data.readData<WallYearsRaw | null>("wall-years.json", null);
    return raw ? decodeWallYears(raw) : null;
  } catch {
    return null;
  }
}

async function tradesOf(data: Data, m: { id: string; name: string; party: "D" | "R" | "I"; state: string }): Promise<FeedTrade[]> {
  const member = { id: m.id, name: m.name, party: m.party, state: m.state };
  return decodeTradeFile(await data.getTradeFile(m.id)).map((trade) => ({ member, trade }));
}

/** The site feed: the most recently made-public trades among members with recent activity (see pickFeedMembers). */
export async function siteFeedResponse(data: Data): Promise<Response> {
  const [c, members, wall] = await Promise.all([context(data), data.getMembers(), wallYears(data)]);
  const picked = pickFeedMembers(members, wall, SITE_MEMBER_FILES);
  const all = (await mapLimit(picked, READ_CONCURRENCY, (m) => tradesOf(data, m))).flat();
  const channel = { title: FEED.siteTitle, link: SITE.url, self: siteUrl("/feed/trades.xml"), description: channelDescription(FEED.siteNote(SITE_MEMBER_FILES), c) };
  return xml(buildFeed(channel, recentTrades(all, SITE_ITEMS), c));
}

/** One member's feed; `file` is the URL's last segment, "<id>.xml". */
export async function memberFeedResponse(data: Data, file: string): Promise<Response> {
  const id = /^([A-Z]\d{6})\.xml$/.exec(file)?.[1];
  if (!id || !(await data.isKnownMember(id))) return NOT_FOUND(); // shape and (remote) membership are checked before any trade file is read
  const m = (await data.getMemberIndex()).get(id);
  if (!m) return NOT_FOUND();
  const c = await context(data);
  const items = recentTrades(await tradesOf(data, m), MEMBER_ITEMS);
  const channel = {
    title: FEED.memberTitle(oneLine(m.name)),
    link: siteUrl(memberHref(id)),
    self: siteUrl(`/feed/m/${id}.xml`),
    description: channelDescription(FEED.memberNote(siteUrl(memberHref(id))), c),
  };
  return xml(buildFeed(channel, items, c));
}
