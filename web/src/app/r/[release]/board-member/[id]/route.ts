// /r/<release id>/board-member/<id>: board strings of one member in one data release (pinned mode only).
import { releaseResponse } from "@/lib/data/permalink";
import { boardMemberResponse } from "@/lib/data/endpoints";
import { isMemberId } from "@/lib/data/ids";

export const dynamic = "force-static";
export const dynamicParams = true;
// Re-run the availability check (the release list) at most every five minutes, so a withdrawn release stops being served.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ release: string; id: string }> }) {
  const { release, id } = await ctx.params;
  return releaseResponse(release, isMemberId(id), (data) => boardMemberResponse(data, id));
}
