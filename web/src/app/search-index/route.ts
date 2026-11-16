// A compact name index for search and labels, built once at build time so
// the browser never downloads orgs.json whole. Release permalinks have their own: app/r/[release]/search-index.
import { latestData } from "@/lib/data/server";
import { searchIndexResponse } from "@/lib/data/endpoints";

export const dynamic = "force-static";

export async function GET() {
  return searchIndexResponse(await latestData()); // one reader per request
}
