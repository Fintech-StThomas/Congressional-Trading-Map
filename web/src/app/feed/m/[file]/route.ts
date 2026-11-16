// RSS feed of one member's most recently made-public trades (/feed/m/<id>.xml). Prerendered from local data and other
// paths are 404s; in the remote modes nothing is prerendered here: next.config.ts rewrites well-formed paths to the
// on-demand twin under app/live/feed/m/[file] (ISR).
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { memberFeedResponse } from "@/lib/data/feedResponse";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return (await (await latestData()).getMembers()).map((m) => ({ file: `${m.id}.xml` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  return memberFeedResponse(await latestData(), file); // one reader per request
}
