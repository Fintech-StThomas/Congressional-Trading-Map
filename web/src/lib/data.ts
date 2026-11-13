// Server-only data access. Reads the static JSON at build time.
// Real data: web/public/data (written by the pipeline). Fallback: web/fixtures/data.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Case, Edge, MemberFileWire, MemberSummary, Meta, OrgSummary, TradeFile } from "./types";
import { toBoardMember, type BoardMember, type NameBook } from "./client";
import { isRealDataBuild } from "./source";
import { pickBoard } from "./pick";

const ROOT = process.cwd();
const REAL_DIR = join(ROOT, "public", "data");
const FIXTURE_DIR = join(ROOT, "fixtures", "data");

export const IS_SAMPLE = !isRealDataBuild(ROOT);
export const DATA_DIR = IS_SAMPLE ? FIXTURE_DIR : REAL_DIR;

const cache = new Map<string, unknown>();

function read<T>(rel: string, fallback?: T): T {
  if (cache.has(rel)) return cache.get(rel) as T;
  const p = join(DATA_DIR, rel);
  if (!existsSync(/*turbopackIgnore: true*/ p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing data file: ${p}`);
  }
  const value = JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as T;
  // Per-member files are read once each during a build; keep them out of the cache.
  if (!rel.startsWith("members/")) cache.set(rel, value);
  return value;
}

export function getMembers(): MemberSummary[] {
  return read<MemberSummary[]>("members.json");
}

let memberIndex: Map<string, MemberSummary> | null = null;
export function getMemberIndex(): Map<string, MemberSummary> {
  if (!memberIndex) memberIndex = new Map(getMembers().map((m) => [m.id, m]));
  return memberIndex;
}

export function getMemberFile(id: string): MemberFileWire | null {
  try {
    return read<MemberFileWire>(`members/${id}.json`);
  } catch {
    return null;
  }
}

export function getTradeFile(id: string): TradeFile | null {
  const p = join(DATA_DIR, "trades", `${id}.json`);
  if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
  return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as TradeFile;
}

export function getBoard(): Board {
  return read<Board>("board.json", { states: {} });
}

export function getCases(): Case[] {
  return read<Case[]>("cases.json", []);
}

export function getOrgs(): OrgSummary[] {
  return read<OrgSummary[]>("orgs.json", []);
}

let orgIndex: Map<string, OrgSummary> | null = null;
export function getOrgIndex(): Map<string, OrgSummary> {
  if (!orgIndex) orgIndex = new Map(getOrgs().map((o) => [o.id, o]));
  return orgIndex;
}

export function getMemberTies(): Edge[] {
  return read<Edge[]>("member-ties.json", []);
}

export function getMeta(): Meta {
  return read<Meta>("meta.json", {});
}

/** Any data file by path, or the fallback when it is missing (files newer than some builds and the fixtures). */
export function readData<T>(rel: string, fallback: T): T {
  return read<T>(rel, fallback);
}

/** Build date as an ISO string, from whichever key the pipeline used. */
export function metaBuilt(meta: Meta = getMeta()): string | null {
  const build = (meta as Record<string, unknown>).build as { time?: string } | undefined;
  const v = build?.time ?? meta.built ?? meta.build_time ?? (meta as Record<string, unknown>).generated_at ?? (meta as Record<string, unknown>).built_at;
  return typeof v === "string" ? v : null;
}

/** Every name an edge list refers to, for labelling in the browser. */
export function nameBookFor(edges: Edge[], extraMembers: string[] = []): NameBook {
  const mi = getMemberIndex();
  const oi = getOrgIndex();
  const book: NameBook = { members: {}, orgs: {} };
  const addM = (id: string) => {
    const m = mi.get(id);
    if (m) book.members[id] = toBoardMember(m);
  };
  extraMembers.forEach(addM);
  for (const e of edges) {
    for (const n of [e.from, e.to]) {
      if (n.kind === "member") addM(n.id);
      else {
        const o = oi.get(n.id);
        if (o) book.orgs[n.id] = o;
      }
    }
  }
  return book;
}
/** OrgSummary-shaped entries from a member file's `nodes`, for labelling. */
export function orgNodesOf(file: MemberFileWire): Record<string, OrgSummary> {
  const oi = getOrgIndex();
  const out: Record<string, OrgSummary> = {};
  for (const [id, n] of Object.entries(file.nodes ?? {})) {
    if (n.kind === "member") continue;
    const o = oi.get(id);
    out[id] = { id, name: n.name, kind: n.kind, ticker: n.ticker, cik: o?.cik ?? null, sector: o?.sector ?? null, degree: o?.degree ?? 0 };
  }
  return out;
}

export type MemberBoard = { edges: Edge[]; nodes: Record<string, OrgSummary>; members: Record<string, BoardMember>; more: number };

/** The strings the board draws for one member, chosen by `pickBoard` from every edge in the file. */
export function memberBoard(id: string): MemberBoard {
  const file = getMemberFile(id);
  if (!file) return { edges: [], nodes: {}, members: {}, more: 0 };
  const edges = pickBoard(id, file.edges);
  const all = orgNodesOf(file);
  const nodes: Record<string, OrgSummary> = {};
  const members: Record<string, BoardMember> = {};
  const mi = getMemberIndex();
  const drawn = new Set<string>();
  for (const e of edges)
    for (const n of [e.from, e.to]) {
      if (n.id === id) continue;
      drawn.add(n.id);
      if (n.kind === "org" && all[n.id]) nodes[n.id] = all[n.id];
      if (n.kind === "member" && mi.get(n.id)) members[n.id] = toBoardMember(mi.get(n.id)!);
    }
  const m = file.member;
  const more = Math.max(0, (m.counts?.orgs ?? 0) + (m.counts?.members ?? 0) - drawn.size);
  return { edges, nodes, members, more };
}

/**
 * A member's holdings file (House annual reports), or null. PT_HOLDINGS_DIR points
 * at another folder of holdings/<id>.json files (testing against unmerged data).
 */
export function getHoldings(id: string): import("./holdings").HoldingsFile | null {
  const dir = process.env.PT_HOLDINGS_DIR || join(DATA_DIR, "holdings");
  const p = join(dir, `${id}.json`);
  if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
  try {
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8"));
  } catch {
    return null;
  }
}
