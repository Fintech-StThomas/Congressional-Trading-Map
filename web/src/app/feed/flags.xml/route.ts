// RSS feed of flagged trades made public in the 30 days up to the data build date (/feed/flags.xml). Reads only
// flags.json and the two indexes, so it is one static route in every mode (revalidated hourly), like /delays.
import { latestData } from "@/lib/data/server";
import { flagsFeedResponse } from "@/lib/data/flagsFeedResponse";

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  return flagsFeedResponse(await latestData()); // one reader per request
}
