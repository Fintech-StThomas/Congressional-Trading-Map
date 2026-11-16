// RSS feed of the trades most recently made public among members with recent activity (/feed/trades.xml).
// Local mode: built at build time. Remote modes: next.config.ts rewrites this URL to app/live/feed/site/[file], built
// on first request and regenerated with the data (ISR), so a deploy does not read 60 trade files from the bucket.
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { siteFeedResponse } from "@/lib/data/feedResponse";

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  // In remote modes this route is never reached (rewritten); answering without reads keeps the build from fetching.
  if (IS_REMOTE) return new Response("Not found", { status: 404 });
  return siteFeedResponse(await latestData()); // one reader per request
}
