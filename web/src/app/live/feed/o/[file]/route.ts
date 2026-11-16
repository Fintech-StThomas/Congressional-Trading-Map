// Remote data modes only: /feed/o/<org id>.xml is rewritten here (see app/live/m/[id]/page.tsx for why a twin exists).
import { IS_REMOTE } from "@/lib/data/server";
import { orgIdOfFile } from "@/lib/data/orgFeedResponse";
import { GET as orgFeed } from "../../../../feed/o/[file]/route";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  if (!IS_REMOTE || !orgIdOfFile((await ctx.params).file)) return new Response("Not found", { status: 404 });
  return orgFeed(req, ctx);
}
