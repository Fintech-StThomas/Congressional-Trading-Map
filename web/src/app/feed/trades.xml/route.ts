// RSS feed of the trades most recently made public among members with recent activity (/feed/trades.xml).
// Static: built at build time locally; in remote modes built at build time and regenerated with the data (ISR).
import { latestData } from "@/lib/data/server";
import { siteFeedResponse } from "@/lib/data/feedResponse";

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  return siteFeedResponse(await latestData()); // one reader per request
}
