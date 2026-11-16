// The member embed card, dark theme (?theme=dark is rewritten here), fixed to one data release (/embed/r/<release>/m/<id>). Pinned mode only (404
// otherwise). A release never changes, so the card is rendered on first request and kept; an unavailable release is a
// 404, never the latest data.
import { permalinkData } from "@/lib/data/permalink";
import { embedResponse } from "@/lib/data/embedResponse";

export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ release: string; id: string }> }) {
  const { release, id } = await ctx.params;
  const data = await permalinkData(release, id);
  return data ? embedResponse(data, id, "dark") : new Response("Not found", { status: 404 });
}
