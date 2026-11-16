// The combined watchlist feed (/feed/w.xml?m=<member ids>&o=<org ids>): a dynamic route because the ids are in the query.
// Equivalent lists give identical URLs (ids are sorted by the page that links here), so the edge can serve feed-reader
// polling from cache (Cache-Control below). Never logs the query. Bounded reads: see lib/data/orgFeedResponse.ts.
import { latestData } from "@/lib/data/server";
import { watchFeedResponse } from "@/lib/data/orgFeedResponse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = await watchFeedResponse(await latestData(), new URL(req.url).search);
  res.headers.set("Cache-Control", res.status === 200 ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store");
  return res;
}
