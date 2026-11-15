// Remote data mode only: /board-member/<id> is rewritten here (see app/live/m/[id]/page.tsx).
import { IS_REMOTE } from "@/lib/data/server";
import { isMemberId } from "@/lib/data/ids";
import { GET as boardMember } from "../../../board-member/[id]/route";

export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!IS_REMOTE || !isMemberId((await ctx.params).id)) return new Response("Not found", { status: 404 });
  return boardMember(req, ctx as RouteContext<"/board-member/[id]">);
}
