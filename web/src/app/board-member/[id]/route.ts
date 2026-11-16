// Board strings for members not in board.json's states (former members).
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { boardMemberResponse } from "@/lib/data/endpoints";

export const dynamic = "force-static";
// Every path is prerendered from local data and other paths are 404s. In the remote modes nothing is
// prerendered here: next.config.ts rewrites this URL to the on-demand twin under app/live/board-member/[id] (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  const data = await latestData();
  const current = new Set(Object.values((await data.getBoard()).states).flat());
  return (await data.getMembers()).filter((m) => !current.has(m.id)).map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-member/[id]">) {
  const { id } = await ctx.params;
  return boardMemberResponse(await latestData(), id); // one reader per request
}
