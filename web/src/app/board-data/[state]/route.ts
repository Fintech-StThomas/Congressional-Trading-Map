// One static JSON file per state, cut from board.json at build time, so the
// browser loads a delegation's strings instead of the whole board.
import { getBoard } from "@/lib/data";
import type { OrgSummary } from "@/lib/types";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(getBoard().states).map((state) => ({ state }));
}

export async function GET(_req: Request, ctx: RouteContext<"/board-data/[state]">) {
  const { state } = await ctx.params;
  const board = getBoard();
  const ids = board.states[state] ?? [];
  const strings: Record<string, (typeof board.strings)[string]> = {};
  const nodes: Record<string, OrgSummary> = {};
  for (const id of ids) {
    const list = board.strings[id] ?? [];
    strings[id] = list;
    for (const e of list) for (const n of [e.from, e.to]) if (n.kind === "org" && board.nodes[n.id]) nodes[n.id] = board.nodes[n.id];
  }
  return Response.json({ strings, nodes });
}
