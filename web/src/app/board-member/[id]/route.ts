// Board strings for members not in board.json's states (former members).
import { getBoard, getMembers, memberBoard } from "@/lib/data";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  const current = new Set(Object.values(getBoard().states).flat());
  return getMembers().filter((m) => !current.has(m.id)).map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-member/[id]">) {
  const { id } = await ctx.params;
  return Response.json(memberBoard(id));
}
