// /feed/flags.xml as a function of a `Data` reader: reads flags.json, the member index and the organisation index (no
// per-member files), so the route stays cheap at build and on revalidation. A build without flags.json answers 404.
import type { Data } from "./reader.ts";
import { context, xml } from "./feedResponse.ts";
import { FLAGS } from "../copy-flags.ts";
import { FEED, SITE } from "../copy.ts";
import { flagsHref, siteUrl } from "../urls.ts";
import { buildFeedFromItems } from "../domain/feed.ts";
import { decodeFlagRows, readFlags } from "../domain/flags.ts";
import { flagItem, recentFlagRows } from "../domain/flagsfeed.ts";

export async function flagsFeedResponse(data: Data): Promise<Response> {
  const flags = readFlags(await data.readData<unknown>("flags.json", null));
  if (!flags) return new Response("Not found", { status: 404 });
  const [c, members, orgs] = await Promise.all([context(data), data.getMemberIndex(), data.getOrgIndex()]);
  const names = { member: (id: string) => members.get(id), org: (id: string) => orgs.get(id)?.name };
  const items = recentFlagRows(decodeFlagRows(flags), flags.build_date).map((r) => flagItem(r, names, flags.rules, flags.statement, c));
  const channel = {
    title: FLAGS.feedTitle,
    link: siteUrl(flagsHref()),
    self: siteUrl("/feed/flags.xml"),
    description: [FLAGS.feedNote, flags.statement, FEED.amounts, SITE.disclaimer].join(" "),
  };
  return xml(buildFeedFromItems(channel, items, c));
}
