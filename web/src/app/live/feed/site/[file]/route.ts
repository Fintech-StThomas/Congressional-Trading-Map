// Remote data modes only: /feed/trades.xml is rewritten here so the site feed is built on first request (ISR)
// rather than at build time, where it would read 60 member trade files from the bucket on every deploy.
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { siteFeedResponse } from "@/lib/data/feedResponse";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  if (!IS_REMOTE || (await ctx.params).file !== "trades.xml") return new Response("Not found", { status: 404 });
  return siteFeedResponse(await latestData()); // one reader per request
}
