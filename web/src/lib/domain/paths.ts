// The documented-connection finder: bounded, deterministic search for chains of published ties between two
// members or organisations. Pure (no I/O): the caller supplies hops (see pathhops.ts) and, for the hub rule, a
// degree lookup. A path is a list of steps; each step is every published tie between two neighbouring nodes.
// It never infers a tie: it only chains ties the data lists. tests/paths.test.mjs loads this file directly.
import type { Amount, EdgeType, NodeRef } from "../types.ts";
import { isOrgId } from "../data/ids.ts";

/** One published tie between two nodes, as the finder sees it. */
export type Hop = {
  /** Unique within a graph: the edge id for a tie with a full edge, else a synthesised key. */
  key: string;
  /** Id of the full Edge (records listed in a member file); null for a ledger or organisation-table row. */
  edge: string | null;
  /** Member id whose file holds the full edge or the ledger row (so evidence can be opened); null when unknown. */
  file: string | null;
  /** True when the tie has a full edge with listed records; false for a summary row without them. */
  full: boolean;
  /** Where the hop was read from: a full edge, a member ledger row, or an organisation-table row. */
  source: "edge" | "ledger" | "orgrow";
  type: EdgeType;
  label: string;
  family: "money" | "holding" | "people" | "context";
  basis: "filed" | "derived";
  /** Direction as published: from -> to when directed; otherwise the order is only a storage order. */
  directed: boolean;
  from: NodeRef;
  to: NodeRef;
  amount: Amount;
  count: number;
  first: string | null;
  last: string | null;
  /** Calendar years with records (by year), or every year from the first to the last record when only that is published. */
  years: number[] | null;
  yearsBasis: "yearly" | "span" | null;
  side: "support" | "oppose" | null; // outside spending only: which side the money was spent on, when the data says
  via: string | null;
  note?: string | null; // the tie's note ("owners: spouse 3, self 2" on a traded tie): says whose trades they are
};

export const MAX_HOPS = 3;
export const DEFAULT_HOPS = 2;
export const MAX_PATHS = 25;
/** An intermediate organisation tied to more members than this is not expanded by default. */
export const HUB_DEGREE = 150;
const PATH_CAP = 20000; // enumeration safety bounds: reported as `capped` when hit
const WORK_CAP = 400000;

export type ExcludedCounts = { against: number; sideUnknown: number; context: number };
export type Graph = {
  byNode: Map<string, Hop[]>;
  /** Nodes whose own published ties were read (their neighbours are known, not just those reached from elsewhere). */
  loaded: Set<string>;
  excluded: ExcludedCounts;
};

const RANK: Record<Hop["source"], number> = { edge: 2, ledger: 1, orgrow: 0 };

/** Why a hop is never part of a path, or null when it may be. Spending against a member is not a tie. */
export function exclusionReason(h: Pick<Hop, "type" | "family" | "side">): keyof ExcludedCounts | null {
  if (h.family === "context") return "context";
  if (h.type === "outside_spending") {
    if (h.side === "oppose") return "against";
    if (h.side !== "support") return "sideUnknown";
  }
  return null;
}

/**
 * Index hops by both ends. The same tie read twice (a member's file and the organisation's table) is kept once,
 * preferring the full edge; an organisation-table row without a full edge is dropped when a member-file row for the
 * same pair and type exists. Hops that are never ties are counted in `excluded` and left out.
 */
export function buildGraph(hops: Hop[], loaded: Iterable<string> = []): Graph {
  const byKey = new Map<string, Hop>();
  for (const h of hops) {
    const cur = byKey.get(h.key);
    if (!cur || RANK[h.source] > RANK[cur.source]) byKey.set(h.key, h);
  }
  const pair = (h: Hop) => `${h.type}|${[h.from.id, h.to.id].sort().join("|")}`;
  const memberSide = new Set<string>();
  for (const h of byKey.values()) if (h.source !== "orgrow") memberSide.add(pair(h));
  const excluded: ExcludedCounts = { against: 0, sideUnknown: 0, context: 0 };
  const byNode = new Map<string, Hop[]>();
  const add = (id: string, h: Hop) => {
    const l = byNode.get(id);
    if (l) l.push(h);
    else byNode.set(id, [h]);
  };
  for (const h of [...byKey.values()].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))) {
    if (h.source === "orgrow" && !h.edge && memberSide.has(pair(h))) continue;
    if (h.from.id === h.to.id) continue;
    const why = exclusionReason(h);
    if (why) {
      excluded[why]++;
      continue;
    }
    add(h.from.id, h);
    add(h.to.id, h);
  }
  return { byNode, loaded: new Set(loaded), excluded };
}

/** Hops the search may use: statistical ones only on request. */
function usable(graph: Graph, id: string, includeDerived: boolean): Hop[] {
  const l = graph.byNode.get(id) ?? [];
  return includeDerived ? l : l.filter((h) => h.basis === "filed");
}

/** The step from `id` to each neighbour: all its usable hops; a statistical hop is dropped where a filed one exists. */
function neighbours(graph: Graph, id: string, includeDerived: boolean): Map<string, Hop[]> {
  const out = new Map<string, Hop[]>();
  for (const h of usable(graph, id, includeDerived)) {
    const n = h.from.id === id ? h.to.id : h.from.id;
    const l = out.get(n);
    if (l) l.push(h);
    else out.set(n, [h]);
  }
  for (const [n, l] of out) {
    if (l.some((h) => h.basis === "filed")) out.set(n, l.filter((h) => h.basis === "filed"));
    out.set(n, out.get(n)!.sort(hopOrder));
  }
  return new Map([...out.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
}

function hopOrder(a: Hop, b: Hop): number {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// ---------------------------------------------------------------- years

export type Temporal =
  | { status: "single" }
  | { status: "overlap"; years: number[]; spanBased: boolean }
  | { status: "none" }
  | { status: "unknown" };

/** Calendar years a hop has records in. By-year counts when published, else the span first..last; null when no year is stated. */
export function hopYears(e: { by_year?: { y: number; n: number }[]; first?: string | null; last?: string | null }): { years: number[]; basis: "yearly" | "span" } | null {
  const ok = (y: number) => Number.isInteger(y) && y >= 1900 && y <= 2100;
  const yearly = [...new Set((e.by_year ?? []).filter((b) => b.n > 0 && ok(b.y)).map((b) => b.y))].sort((a, b) => a - b);
  if (yearly.length) return { years: yearly, basis: "yearly" };
  const y1 = Number(e.first?.slice(0, 4));
  const y2 = Number(e.last?.slice(0, 4));
  const a = ok(y1) ? y1 : null;
  const b = ok(y2) ? y2 : null;
  if (a == null && b == null) return null;
  const lo = Math.min(a ?? b!, b ?? a!);
  const hi = Math.max(a ?? b!, b ?? a!);
  const years: number[] = [];
  for (let y = lo; y <= hi; y++) years.push(y);
  return { years, basis: "span" };
}

/**
 * Whether every step of a path has records in a common calendar year. A step covers a year when any of its ties does.
 * Years that are not stated are never assumed to overlap: a step without any is "unknown" unless two other steps
 * already share no year.
 */
export function temporalOf(steps: { hops: Hop[] }[]): Temporal {
  if (steps.length <= 1) return { status: "single" };
  const sets: Set<number>[] = [];
  let unknownSteps = 0;
  let spanBased = false;
  for (const s of steps) {
    const ys = new Set<number>();
    for (const h of s.hops) {
      if (!h.years?.length) continue;
      if (h.yearsBasis === "span") spanBased = true;
      for (const y of h.years) ys.add(y);
    }
    if (ys.size) sets.push(ys);
    else unknownSteps++;
  }
  if (sets.length < 2) return { status: "unknown" };
  const common = [...sets[0]].filter((y) => sets.every((s) => s.has(y))).sort((a, b) => a - b);
  if (!common.length) return { status: "none" };
  if (unknownSteps) return { status: "unknown" };
  return { status: "overlap", years: common, spanBased };
}

// ---------------------------------------------------------------- paths

export type PathStep = { from: string; to: string; hops: Hop[] };
export type Path = {
  id: string;
  nodes: string[];
  steps: PathStep[];
  /** Some step has only statistical ties. */
  anyDerived: boolean;
  temporal: Temporal;
  /** Records of the filed ties on the path (a statistical tie's count is co-occurrences, not records, and is left out). */
  filedRecords: number;
};

export type PathOptions = {
  maxHops?: number;
  includeDerived?: boolean;
  /** Expand intermediate organisations tied to more than `hubDegree` members. */
  expandHubs?: boolean;
  hubDegree?: number;
  limit?: number;
  /** Members tied to an organisation (published count); null/undefined when unknown. */
  degree?: (id: string) => number | null | undefined;
};

export type PathResult = {
  paths: Path[];
  /** Paths found within the bounds (at least this many when `capped`). */
  total: number;
  /** Found but not shown: total - paths.length. */
  more: number;
  /** The search hit its safety bound; more paths may exist. */
  capped: boolean;
  maxHops: number;
  /** Intermediate organisations not expanded because they are tied to very many members. */
  hubsSkipped: string[];
  /** Statistical ties in the graph that were not used (the switch was off). */
  derivedUnused: number;
  excluded: ExcludedCounts;
};

function stepDerivedOnly(hops: Hop[]): boolean {
  return hops.every((h) => h.basis === "derived");
}

/** Compare by the ranking rule, which is spelled out to readers in copy.ts (CONNECT.ranking). No score. */
export function comparePaths(a: Path, b: Path): number {
  const t = (p: Path) => (p.temporal.status === "overlap" || p.temporal.status === "single" ? 0 : p.temporal.status === "unknown" ? 1 : 2);
  const ida = a.nodes.join("|");
  const idb = b.nodes.join("|");
  return (
    a.steps.length - b.steps.length ||
    Number(a.anyDerived) - Number(b.anyDerived) ||
    t(a) - t(b) ||
    b.filedRecords - a.filedRecords ||
    (ida < idb ? -1 : ida > idb ? 1 : 0)
  );
}

/**
 * Chains of published ties from `a` to `b`. Lengths are searched shortest first (so a safety bound only ever cuts
 * the longest paths), neighbours in id order, no node twice, `b` only at the end. Two statistical steps never
 * appear on one path. The result is the same for the same graph and options.
 */
export function findPaths(graph: Graph, a: string, b: string, opts: PathOptions = {}): PathResult {
  const maxHops = Math.max(1, Math.min(MAX_HOPS, Math.floor(opts.maxHops ?? DEFAULT_HOPS)));
  const includeDerived = Boolean(opts.includeDerived);
  const hubDegree = opts.hubDegree ?? HUB_DEGREE;
  const limit = Math.max(1, Math.min(MAX_PATHS, opts.limit ?? MAX_PATHS));
  const derivedUnused = includeDerived ? 0 : [...new Set([...graph.byNode.values()].flat())].filter((h) => h.basis === "derived").length;
  const base = { maxHops, derivedUnused, excluded: graph.excluded };
  if (a === b) return { paths: [], total: 0, more: 0, capped: false, hubsSkipped: [], ...base };

  const cache = new Map<string, Map<string, Hop[]>>();
  const adj = (id: string) => {
    let m = cache.get(id);
    if (!m) cache.set(id, (m = neighbours(graph, id, includeDerived)));
    return m;
  };
  const isHub = (id: string) => {
    if (opts.expandHubs) return false;
    const d = opts.degree?.(id);
    return typeof d === "number" && d > hubDegree;
  };

  const found: Path[] = [];
  const hubs = new Set<string>();
  let work = 0;
  let capped = false;

  for (let len = 1; len <= maxHops && !capped; len++) {
    const nodes = [a];
    const steps: PathStep[] = [];
    const seen = new Set([a]);
    const walk = (at: string, derivedSteps: number): void => {
      if (capped) return;
      if (++work > WORK_CAP) {
        capped = true;
        return;
      }
      const depth = steps.length;
      for (const [n, hops] of adj(at)) {
        if (seen.has(n)) continue;
        const last = depth + 1 === len;
        if (last !== (n === b)) continue; // b only at the end; the end only at b
        const derivedOnly = stepDerivedOnly(hops);
        if (derivedOnly && derivedSteps > 0) continue; // never chain two statistical steps
        if (!last) {
          if (isHub(n)) {
            hubs.add(n);
            continue;
          }
          if (len - depth - 1 === 1 && !adj(n).has(b)) continue; // one step left and no tie to b: dead end
        }
        nodes.push(n);
        steps.push({ from: at, to: n, hops });
        seen.add(n);
        if (last) {
          if (found.length >= PATH_CAP) capped = true;
          else found.push(makePath(nodes, steps));
        } else walk(n, derivedSteps + (derivedOnly ? 1 : 0));
        nodes.pop();
        steps.pop();
        seen.delete(n);
        if (capped) return;
      }
    };
    walk(a, 0);
  }

  found.sort(comparePaths);
  const paths = found.slice(0, limit);
  return { paths, total: found.length, more: found.length - paths.length, capped, hubsSkipped: [...hubs].sort(), ...base };
}

function makePath(nodes: string[], steps: PathStep[]): Path {
  const copy = steps.map((s) => ({ ...s, hops: [...s.hops] }));
  return {
    id: nodes.join(">"),
    nodes: [...nodes],
    steps: copy,
    anyDerived: copy.some((s) => stepDerivedOnly(s.hops)),
    temporal: temporalOf(copy),
    filedRecords: copy.reduce((n, s) => n + s.hops.reduce((m, h) => m + (h.basis === "filed" ? h.count : 0), 0), 0),
  };
}

// ---------------------------------------------------------------- choosing whom to read next (three-step search)

export type Expansion = { pick: string[]; notExpanded: number; hubsSkipped: string[] };

/**
 * For a three-step search, which intermediate nodes to read the ties of: up to `perSide` neighbours of each end, never a
 * node already read, an organisation tied to only one member (a dead end), or (by default) a very widely tied organisation;
 * smallest published degree first (unknown degree last), then id. `notExpanded` counts usable candidates left unread.
 */
export function pickExpansions(
  graph: Graph,
  a: string,
  b: string,
  opts: Pick<PathOptions, "degree" | "expandHubs" | "hubDegree" | "includeDerived"> & { perSide?: number },
): Expansion {
  const perSide = opts.perSide ?? 6;
  const hubDegree = opts.hubDegree ?? HUB_DEGREE;
  const hubs = new Set<string>();
  const pick: string[] = [];
  let notExpanded = 0;
  const seenCandidate = new Set<string>();
  for (const end of [a, b]) {
    const cands: { id: string; d: number | null }[] = [];
    for (const n of neighbours(graph, end, Boolean(opts.includeDerived)).keys()) {
      if (n === a || n === b || graph.loaded.has(n) || seenCandidate.has(n)) continue;
      const d = opts.degree?.(n);
      const deg = typeof d === "number" ? d : null;
      if (deg != null && deg > hubDegree && !opts.expandHubs) {
        hubs.add(n);
        continue;
      }
      if (deg != null && deg < 2 && isOrgId(n)) continue;
      cands.push({ id: n, d: deg });
    }
    cands.sort((x, y) => (x.d ?? Infinity) - (y.d ?? Infinity) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (const c of cands) seenCandidate.add(c.id);
    pick.push(...cands.slice(0, perSide).map((c) => c.id));
    notExpanded += Math.max(0, cands.length - perSide);
  }
  return { pick, notExpanded, hubsSkipped: [...hubs].sort() };
}

// ---------------------------------------------------------------- words

/**
 * Who does what to whom, in the hop's published direction: `subject` is the tie's `from` end. An undirected tie is
 * returned in travel order (from `travelFrom`), with `directed` false so the caller words it without a verb of direction.
 */
export function hopSentence(h: Hop, travelFrom: string): { subject: NodeRef; object: NodeRef; directed: boolean } {
  if (h.directed) return { subject: h.from, object: h.to, directed: true };
  return h.from.id === travelFrom ? { subject: h.from, object: h.to, directed: false } : { subject: h.to, object: h.from, directed: false };
}
