// One static JSON file per state with every current member's board strings,
// cut from the member files at build time.
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { boardDataResponse } from "@/lib/data/endpoints";
import { isStateCode } from "@/lib/data/ids";

export const dynamic = "force-static";
// Every path is prerendered from local data and other paths are 404s. In the remote modes nothing is
// prerendered here: next.config.ts rewrites this URL to the on-demand twin under app/live/board-data/[state] (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return Object.keys((await (await latestData()).getBoard()).states).map((state) => ({ state }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-data/[state]">) {
  const { state } = await ctx.params;
  if (!isStateCode(state)) return new Response("Not found", { status: 404 });
  return boardDataResponse(await latestData(), state); // one reader per request
}
