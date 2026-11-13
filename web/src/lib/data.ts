// Server-only data access. Reads the static JSON at build time.
// Real data: web/public/data (written by the pipeline). Fallback: web/fixtures/data.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Case, Edge, MemberFileWire, MemberSummary, Meta, OrgSummary } from "./types";
import { toBoardMember, type NameBook } from "./client";
import { useRealData } from "./source";

const ROOT = process.cwd();
const REAL_DIR = join(ROOT, "public", "data");
const FIXTURE_DIR = join(ROOT, "fixtures", "data");

export const IS_SAMPLE = !useRealData(ROOT);
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

export function getBoard(): Board {
  return read<Board>("board.json", { states: {}, strings: {}, nodes: {} });
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
  const board = getBoard();
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
        const o = oi.get(n.id) ?? board.nodes[n.id];
        if (o) book.orgs[n.id] = o;
      }
    }
  }
  return book;
}