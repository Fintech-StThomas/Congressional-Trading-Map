// The combined watchlist feed (/feed/w.xml?m=<member ids>&o=<org ids>): a dynamic route because the ids are in the query.
// Equivalent lists give identical URLs: the page that links here sorts the ids and any other spelling gets a 308 to the
// canonical one, so the edge can serve feed-reader polling from cache (Cache-Control below). Never logs the query. Bounded reads: see lib/data/orgFeedResponse.ts.
import { latestData } from "@/lib/data/server";
import { watchFeedResponse } from "@/lib/data/orgFeedResponse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = await watchFeedResponse(await latestData(), new URL(req.url).search);
  const cacheable = res.status === 200 ? "public, s-maxage=3600, stale-while-revalidate=86400" : res.status === 308 ? "public, s-maxage=86400" : "no-store";
  res.headers.set("Cache-Control", cacheable);
  return res;
}
