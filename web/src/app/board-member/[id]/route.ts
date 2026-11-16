// Board strings for members not in board.json's states (former members).
import { IS_REMOTE, getBoard, getMembers, isKnownMember, memberBoard } from "@/lib/data/server";

export const dynamic = "force-static";
// Every path is prerendered from local data and other paths are 404s. With DATA_BASE_URL nothing is
// prerendered here: next.config.ts rewrites this URL to the on-demand twin under app/live/board-member/[id] (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  const current = new Set(Object.values((await getBoard()).states).flat());
  return (await getMembers()).filter((m) => !current.has(m.id)).map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-member/[id]">) {
  const { id } = await ctx.params;
  if (!(await isKnownMember(id))) return new Response("Not found", { status: 404 });
  return Response.json(await memberBoard(id));
}
