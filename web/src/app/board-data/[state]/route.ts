// One static JSON file per state with every current member's board strings,
// cut from the member files at build time.
import { IS_REMOTE, getBoard, memberBoard, type MemberBoard } from "@/lib/data/server";

export const dynamic = "force-static";
// Local data: every state prebuilt, others 404. Remote data: built on first request and revalidated.
export const dynamicParams = IS_REMOTE;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return Object.keys((await getBoard()).states).map((state) => ({ state }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-data/[state]">) {
  const { state } = await ctx.params;
  const strings: Record<string, MemberBoard["edges"]> = {};
  const more: Record<string, number> = {};
  const againstMore: Record<string, number> = {};
  const nodes: MemberBoard["nodes"] = {};
  const members: MemberBoard["members"] = {};
  const board = await getBoard();
  if (IS_REMOTE && !board.states[state]) return new Response("Not found", { status: 404 });
  for (const id of board.states[state] ?? []) {
    const b = await memberBoard(id);
    strings[id] = b.edges;
    more[id] = b.more;
    if (b.againstMore) againstMore[id] = b.againstMore;
    Object.assign(nodes, b.nodes);
    Object.assign(members, b.members);
  }
  return Response.json({ strings, nodes, members, more, againstMore });
}
