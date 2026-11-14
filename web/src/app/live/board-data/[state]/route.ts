// Remote data mode only: /board-data/<state> is rewritten here (see app/live/m/[id]/page.tsx).
import { IS_REMOTE } from "@/lib/data/server";
import { GET as boardData } from "../../../board-data/[state]/route";

export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function GET(req: Request, ctx: { params: Promise<{ state: string }> }) {
  if (!IS_REMOTE) return new Response("Not found", { status: 404 });
  return boardData(req, ctx as RouteContext<"/board-data/[state]">);
}
