// One static JSON file per state with every current member's board strings,
// cut from the member files at build time.
import { getBoard, memberBoard, type MemberBoard } from "@/lib/data";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(getBoard().states).map((state) => ({ state }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-data/[state]">) {
  const { state } = await ctx.params;
  const strings: Record<string, MemberBoard["edges"]> = {};
  const more: Record<string, number> = {};
  const againstMore: Record<string, number> = {};
  const nodes: MemberBoard["nodes"] = {};
  const members: MemberBoard["members"] = {};
  for (const id of getBoard().states[state] ?? []) {
    const b = memberBoard(id);
    strings[id] = b.edges;
    more[id] = b.more;
    if (b.againstMore) againstMore[id] = b.againstMore;
    Object.assign(nodes, b.nodes);
    Object.assign(members, b.members);
  }
  return Response.json({ strings, nodes, members, more, againstMore });
}
