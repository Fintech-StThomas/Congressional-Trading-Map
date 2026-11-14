// Board strings for members not in board.json's states (former members).
import { IS_REMOTE, getBoard, getMemberIndex, getMembers, memberBoard } from "@/lib/data/server";

export const dynamic = "force-static";
// As /board-data: all prebuilt locally, on first request with DATA_BASE_URL.
export const dynamicParams = IS_REMOTE;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  const current = new Set(Object.values((await getBoard()).states).flat());
  return (await getMembers()).filter((m) => !current.has(m.id)).map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-member/[id]">) {
  const { id } = await ctx.params;
  if (IS_REMOTE && !(await getMemberIndex()).has(id)) return new Response("Not found", { status: 404 });
  return Response.json(await memberBoard(id));
}
