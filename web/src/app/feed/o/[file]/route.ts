// RSS feed of one organisation's recent trades and money ties (/feed/o/<org id>.xml). Local mode: prerendered for the
// 500 organisations with the most ties (all of them on the sample site); other ids answer 404. Remote modes: nothing is
// prerendered; next.config.ts rewrites well-formed paths to app/live/feed/o/[file] (ISR), so a deploy reads no bucket files.
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { orgFeedResponse } from "@/lib/data/orgFeedResponse";

export const dynamic = "force-static";
export const dynamicParams = false;

/** Organisations given a prerendered feed in local mode. */
const LOCAL_ORG_FEEDS = 500;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  const orgs = [...(await (await latestData()).getOrgs())].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  return orgs.slice(0, LOCAL_ORG_FEEDS).map((o) => ({ file: `${o.id}.xml` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  return orgFeedResponse(await latestData(), file);
}
