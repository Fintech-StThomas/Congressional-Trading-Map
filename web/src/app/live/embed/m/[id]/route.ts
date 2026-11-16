// Remote data modes only: /embed/m/<id> is rewritten here (see app/live/m/[id]/page.tsx for why a twin exists).
import { IS_REMOTE } from "@/lib/data/server";
import { isMemberId } from "@/lib/data/ids";
import { GET as embed } from "../../../../embed/m/[id]/route";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!IS_REMOTE || !isMemberId((await ctx.params).id)) return new Response("Not found", { status: 404 });
  return embed(req, ctx);
}
