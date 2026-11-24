// /r/<release id>/search-index: the name index of one data release (pinned mode only).
import { releaseResponse } from "@/lib/data/permalink";
import { searchIndexResponse } from "@/lib/data/endpoints";

export const dynamic = "force-static";
export const dynamicParams = true;
// Re-run the availability check (the release list) at most every five minutes, so a withdrawn release stops being served.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ release: string }> }) {
  return releaseResponse((await ctx.params).release, true, searchIndexResponse);
}
