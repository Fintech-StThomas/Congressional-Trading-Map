// /r/<release id>/board-data/<state>: the board strings of one data release (pinned mode only). See ../../m/[id]/page.tsx.
import { releaseResponse } from "@/lib/data/permalink";
import { boardDataResponse } from "@/lib/data/endpoints";
import { isStateCode } from "@/lib/data/ids";

export const dynamic = "force-static";
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: { params: Promise<{ release: string; state: string }> }) {
  const { release, state } = await ctx.params;
  return releaseResponse(release, isStateCode(state), (data) => boardDataResponse(data, state));
}
