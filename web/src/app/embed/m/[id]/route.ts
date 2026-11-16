// The member embed card, light theme, for the latest data (/embed/m/<id>). A complete HTML document;
// see lib/data/embedResponse.ts. Prerendered from local data and other paths are 404s; in the remote modes next.config.ts
// rewrites to the on-demand twin under app/live/embed (ISR). The theme is a path because a static route cannot read a query.
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { embedResponse } from "@/lib/data/embedResponse";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return (await (await latestData()).getMembers()).map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return embedResponse(await latestData(), id, "light"); // one reader per request
}
