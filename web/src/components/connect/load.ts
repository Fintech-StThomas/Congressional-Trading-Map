// Reads the published ties the connection finder needs, with the fewest requests: a member's file or an organisation's
// shard entry per node read (the browser caches each URL, so two organisations in one shard cost one request), then runs
// the pure search. Used by useConnect.ts. Pinned mode is automatic: every URL comes from dataUrl / routeDataUrl.
import type { Edge, MemberFileWire, OrgFileWire } from "@/lib/types";
import { getJSON, loadSearchIndex, type SearchIndex } from "@/lib/data/fetch";
import { isMemberId } from "@/lib/data/ids";
import { orgShard } from "@/lib/hash";
import { dataUrl } from "@/lib/urls";
import { buildGraph, findPaths, pickExpansions, type Hop, type PathOptions, type PathResult } from "@/lib/domain/paths";
import { edgeFromHop, hopsFromMemberFile, hopsFromOrgFile, namesFromMemberFile } from "@/lib/domain/pathhops";

export const EXPANSION_PER_SIDE = 6; // at most 12 intermediate nodes are read in a three-step search

export type Named = { name: string; kind: "member" | "org" };
export type NodeData = { id: string; hops: Hop[]; names: Record<string, Named>; degree: number | null };

/** The node has no published file in this build. */
export class NodeMissing extends Error {
  id: string;
  constructor(id: string) {
    super(`no published ties for ${id}`);
    this.id = id;
  }
}

const nodes = new Map<string, Promise<NodeData>>();

/** One node's published ties. Members: members/<id>.json (edges and ledger). Organisations: its entry in orgs/<shard>.json. */
export function loadNode(id: string): Promise<NodeData> {
  const key = `${dataUrl("x")}#${id}`; // dataUrl differs per pinned release, so a release never reuses another's reads
  let p = nodes.get(key);
  if (!p) {
    p = read(id).catch((e) => {
      nodes.delete(key);
      throw e;
    });
    nodes.set(key, p);
  }
  return p;
}

async function read(id: string): Promise<NodeData> {
  if (isMemberId(id)) {
    let file: MemberFileWire;
    try {
      file = await getJSON<MemberFileWire>(dataUrl(`members/${id}.json`));
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("404")) throw new NodeMissing(id);
      throw e;
    }
    return { id, hops: hopsFromMemberFile(file), names: namesFromMemberFile(file), degree: null };
  }
  const shard = await orgShard(id);
  const body = await getJSON<Record<string, OrgFileWire>>(dataUrl(`orgs/${shard}.json`));
  const file = body[id];
  if (!file) throw new NodeMissing(id);
  return { id, hops: hopsFromOrgFile(file), names: { [id]: { name: file.org.name, kind: "org" } }, degree: file.org.degree };
}

/** The full Edge (with its records) for a hop, from the member file that holds it; a stand-in for a summary row. */
export async function resolveHop(h: Hop): Promise<Edge> {
  if (!h.edge || !h.file) return edgeFromHop(h);
  try {
    const file = await getJSON<{ edges: Edge[] }>(dataUrl(`members/${h.file}.json`));
    return file.edges.find((e) => e.id === h.edge) ?? edgeFromHop(h);
  } catch {
    return edgeFromHop(h);
  }
}

export type Settings = { maxHops: number; includeDerived: boolean; expandHubs: boolean };
export type Outcome = {
  result: PathResult;
  names: Record<string, Named>;
  /** Intermediate nodes read (three-step search), those that failed to load, and usable ones left unread. */
  read: string[];
  failed: string[];
  notExpanded: number;
  expansionHubs: string[];
};

function indexNames(idx: SearchIndex | null): Record<string, Named> {
  const out: Record<string, Named> = {};
  if (!idx) return out;
  for (const o of idx.orgs) out[o.id] = { name: o.name, kind: "org" };
  for (const m of idx.members) out[m.id] = { name: m.name, kind: "member" };
  return out;
}

/** Read what the search needs for a and b, run it, and name every node on the paths it returns. */
export async function connect(a: string, b: string, s: Settings): Promise<Outcome> {
  const [da, db, idx] = await Promise.all([loadNode(a), loadNode(b), loadSearchIndex().catch(() => null)]);
  const degrees = new Map<string, number>((idx?.orgs ?? []).map((o) => [o.id, o.degree]));
  for (const d of [da, db]) if (d.degree != null) degrees.set(d.id, d.degree);
  const degree = (id: string) => degrees.get(id) ?? null;
  const opts: PathOptions = { maxHops: s.maxHops, includeDerived: s.includeDerived, expandHubs: s.expandHubs, degree };

  const datas: NodeData[] = [da, db];
  let graph = buildGraph(datas.flatMap((d) => d.hops), [a, b]);
  let read: string[] = [];
  const failed: string[] = [];
  let notExpanded = 0;
  let expansionHubs: string[] = [];
  if (s.maxHops >= 3 && a !== b) {
    const ex = pickExpansions(graph, a, b, { ...opts, perSide: EXPANSION_PER_SIDE });
    notExpanded = ex.notExpanded;
    expansionHubs = ex.hubsSkipped;
    const settled = await Promise.allSettled(ex.pick.map((id) => loadNode(id)));
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        datas.push(r.value);
        read.push(ex.pick[i]);
      } else if (!(r.reason instanceof NodeMissing)) failed.push(ex.pick[i]);
    });
    graph = buildGraph(datas.flatMap((d) => d.hops), [a, b, ...read]);
  }
  const result = findPaths(graph, a, b, opts);

  const names: Record<string, Named> = indexNames(idx);
  for (const d of datas) Object.assign(names, d.names);
  // Organisations on the paths that no file named yet: read their entries (bounded) so a path never shows a bare id.
  const unnamed = [...new Set(result.paths.flatMap((p) => p.nodes))].filter((id) => !names[id]).slice(0, 12);
  await Promise.allSettled(unnamed.map((id) => loadNode(id).then((d) => Object.assign(names, d.names))));
  read = [...new Set(read)];
  return { result, names, read, failed, notExpanded, expansionHubs };
}
