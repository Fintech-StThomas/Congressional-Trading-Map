// The generated JSON endpoints the browser calls (/board-data/<state>, /board-member/<id>, /search-index), as functions
// of a `Data` reader, so the latest routes and the release permalink routes (/r/<id>/...) share one implementation.
// Each takes a reader already bound to one release and uses only that reader.
import type { Data, MemberBoard } from "./reader.ts";
import { IS_REMOTE } from "./mode.ts";
import { isMemberId, isStateCode } from "./ids.ts";

const NOT_FOUND = () => new Response("Not found", { status: 404 });
const MAX_ORGS = 6000;

/** Board strings and node names for every current member of one state. */
export async function boardDataResponse(data: Data, state: string): Promise<Response> {
  if (!isStateCode(state)) return NOT_FOUND();
  const board = await data.getBoard();
  if (IS_REMOTE && !board.states[state]) return NOT_FOUND();
  const strings: Record<string, MemberBoard["edges"]> = {};
  const more: Record<string, number> = {};
  const againstMore: Record<string, number> = {};
  const nodes: MemberBoard["nodes"] = {};
  const members: MemberBoard["members"] = {};
  for (const id of board.states[state] ?? []) {
    const b = await data.memberBoard(id);
    strings[id] = b.edges;
    more[id] = b.more;
    if (b.againstMore) againstMore[id] = b.againstMore;
    Object.assign(nodes, b.nodes);
    Object.assign(members, b.members);
  }
  return Response.json({ strings, nodes, members, more, againstMore });
}

/** Board strings for one member (former members are not in board.json's states). */
export async function boardMemberResponse(data: Data, id: string): Promise<Response> {
  if (!isMemberId(id) || !(await data.isKnownMember(id))) return NOT_FOUND();
  return Response.json(await data.memberBoard(id));
}

/** A compact name index for search and labels: every member and the largest organisations, so orgs.json never ships. */
export async function searchIndexResponse(data: Data): Promise<Response> {
  const [members, orgs] = await Promise.all([data.getMembers(), data.getOrgs()]);
  const m = members.map((x) => [x.id, x.name, x.last, x.party, x.state, x.chamber, x.district, x.current ? 1 : 0, x.photo ? 1 : 0, x.counts?.cases ?? 0]);
  const o = orgs
    .slice()
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
    .slice(0, MAX_ORGS)
    .map((x) => [x.id, x.name, x.kind, x.degree, x.ticker]);
  return Response.json({ m, o });
}
