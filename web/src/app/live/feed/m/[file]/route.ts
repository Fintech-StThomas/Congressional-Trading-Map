// Remote data modes only: /feed/m/<id>.xml is rewritten here (see app/live/m/[id]/page.tsx for why a twin exists).
import { IS_REMOTE } from "@/lib/data/server";
import { GET as memberFeed } from "../../../../feed/m/[file]/route";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  if (!IS_REMOTE || !/^[A-Z]\d{6}\.xml$/.test((await ctx.params).file)) return new Response("Not found", { status: 404 });
  return memberFeed(req, ctx);
}
