// Board strings for members who are not on board.json (former members), cut
// from their case files at build time: the top twelve full edges and the names
// of every organisation they reach.
import { getBoard, getMemberFile, getMembers, getOrgIndex } from "@/lib/data";
import { ledgerSize } from "@/lib/decode";
import { sortEdges } from "@/lib/edges";
import type { OrgSummary } from "@/lib/types";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  const current = new Set(Object.values(getBoard().states).flat());
  return getMembers()
    .filter((m) => !current.has(m.id))
    .map((m) => ({ id: m.id }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-member/[id]">) {
  const { id } = await ctx.params;
  const file = getMemberFile(id);
  const edges = file ? sortEdges(file.edges).slice(0, 12) : [];
  const orgs = getOrgIndex();
  const nodes: Record<string, OrgSummary> = {};
  for (const e of edges) for (const n of [e.from, e.to]) if (n.kind === "org" && orgs.get(n.id)) nodes[n.id] = orgs.get(n.id)!;
  return Response.json({ edges, nodes, more: file ? Math.max(0, file.edges.length - edges.length) + ledgerSize(file) : 0 });
}
