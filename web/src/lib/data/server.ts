// Server-only data access. Two modes, chosen by DATA_BASE_URL (see remote.ts and README "Data modes"):
//   unset (local): reads the static JSON with fs at build time (never at request time).
//                  Real data: web/public/data (written by the pipeline). Fallback: web/fixtures/data (see source.ts).
//   set (remote):  fetches each file from DATA_BASE_URL with Next's fetch cache (revalidated every
//                  REVALIDATE_SECONDS), at build time for the few prebuilt pages and on first request for
//                  the rest. Nothing is read from web/public/data.
// Every accessor is async so both modes share one API.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Case, Edge, MemberFileWire, MemberSummary, Meta, OrgSummary, TradeFile } from "../types.ts";
import { toBoardMember, type BoardMember, type NameBook } from "../domain/names.ts";
import type { HoldingsFile } from "../domain/holdings.ts";
import { pickBoardSplit } from "../domain/pick.ts";
import { metaBuilt as builtFrom } from "./meta.ts";
import { isRealDataBuild } from "./source.ts";
import { REVALIDATE_SECONDS, remoteDataBase, remoteFileUrl } from "./remote.ts";

const ROOT = process.cwd();
const REAL_DIR = join(ROOT, "public", "data");
const FIXTURE_DIR = join(ROOT, "fixtures", "data");

/** DATA_BASE_URL as seen at build time (next.config.ts inlines it as PT_REMOTE_DATA), or null in local mode. */
export const REMOTE_BASE = remoteDataBase(process.env.PT_REMOTE_DATA ?? process.env.DATA_BASE_URL);
export const IS_REMOTE = REMOTE_BASE !== null;
/** Remote data is the published tree, never the fixtures. */
export const IS_SAMPLE = IS_REMOTE ? false : !isRealDataBuild(ROOT);
export const DATA_DIR = IS_SAMPLE ? FIXTURE_DIR : REAL_DIR;
/** True while `next build` runs (prerendering); false at request time. */
export const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";

const cache = new Map<string, unknown>();
/** Per-member files are read once each per page; keep them out of the in-memory cache. */
const uncached = (rel: string) => /^(members|trades|holdings|orgs)\//.test(rel);

// ---------------------------------------------------------------- local mode

function readLocal<T>(rel: string, fallback?: T): T {
  if (cache.has(rel)) return cache.get(rel) as T;
  const p = join(DATA_DIR, rel);
  if (!existsSync(/*turbopackIgnore: true*/ p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing data file: ${p}`);
  }
  const value = JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as T;
  if (!uncached(rel)) cache.set(rel, value);
  return value;
}

// ---------------------------------------------------------------- remote mode

/** One GET through Next's fetch cache. undefined on 404 (a missing optional file); throws on anything else. */
async function fetchRemote(rel: string): Promise<Response | undefined> {
  const url = remoteFileUrl(REMOTE_BASE as string, rel);
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  } catch (err) {
    throw new Error(`[data] could not fetch ${url}: ${(err as Error).message}`);
  }
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`[data] ${res.status} ${res.statusText} from ${url}`);
  return res;
}

/**
 * The data build's identity, from meta.json's ETag (or Last-Modified). Fetching it on every read also
 * gives every route that reads data the 15-minute revalidation, whether or not the file below comes
 * from the in-memory cache.
 */
async function remoteStamp(): Promise<{ stamp: string; res: Response }> {
  const res = await fetchRemote("meta.json");
  if (!res) throw new Error(`[data] meta.json is missing under DATA_BASE_URL (${REMOTE_BASE})`);
  const stamp = res.headers.get("etag") ?? res.headers.get("last-modified") ?? String(Math.floor(Date.now() / (REVALIDATE_SECONDS * 1000)));
  return { stamp, res };
}

let stampSeen = "";

async function readRemote<T>(rel: string, fallback?: T): Promise<T> {
  const { stamp, res: metaRes } = await remoteStamp();
  if (stamp !== stampSeen) {
    // A new data build: drop everything parsed from the previous one.
    cache.clear();
    memberIndex = orgIndex = null;
    stampSeen = stamp;
  }
  const key = `remote:${rel}`;
  if (!uncached(rel) && cache.has(key)) return cache.get(key) as T;
  const res = rel === "meta.json" ? metaRes : await fetchRemote(rel);
  if (!res) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing data file: ${remoteFileUrl(REMOTE_BASE as string, rel)}`);
  }
  let value: T;
  try {
    value = (await res.clone().json()) as T;
  } catch (err) {
    throw new Error(`[data] ${rel} from DATA_BASE_URL is not JSON: ${(err as Error).message}`);
  }
  if (!uncached(rel)) cache.set(key, value);
  return value;
}

// ---------------------------------------------------------------- both modes

async function read<T>(rel: string, fallback?: T): Promise<T> {
  return IS_REMOTE ? readRemote<T>(rel, fallback) : readLocal<T>(rel, fallback);
}

/** A file that may be missing (a member with no trades or holdings): null on 404, never an error. */
async function readOptional<T>(rel: string): Promise<T | null> {
  return read<T | null>(rel, null);
}

export function getMembers(): Promise<MemberSummary[]> {
  return read<MemberSummary[]>("members.json");
}

let memberIndex: Map<string, MemberSummary> | null = null;
export async function getMemberIndex(): Promise<Map<string, MemberSummary>> {
  const members = await getMembers();
  if (!memberIndex) memberIndex = new Map(members.map((m) => [m.id, m]));
  return memberIndex;
}

export async function getMemberFile(id: string): Promise<MemberFileWire | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (!IS_REMOTE) {
    try {
      return readLocal<MemberFileWire>(`members/${id}.json`);
    } catch {
      return null;
    }
  }
  return readOptional<MemberFileWire>(`members/${id}.json`);
}

export async function getTradeFile(id: string): Promise<TradeFile | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (IS_REMOTE) return readOptional<TradeFile>(`trades/${id}.json`);
  const p = join(DATA_DIR, "trades", `${id}.json`);
  if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
  return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as TradeFile;
}

export function getBoard(): Promise<Board> {
  return read<Board>("board.json", { states: {} });
}

export function getCases(): Promise<Case[]> {
  return read<Case[]>("cases.json", []);
}

export function getOrgs(): Promise<OrgSummary[]> {
  return read<OrgSummary[]>("orgs.json", []);
}

let orgIndex: Map<string, OrgSummary> | null = null;
export async function getOrgIndex(): Promise<Map<string, OrgSummary>> {
  const orgs = await getOrgs();
  if (!orgIndex) orgIndex = new Map(orgs.map((o) => [o.id, o]));
  return orgIndex;
}

export function getMemberTies(): Promise<Edge[]> {
  return read<Edge[]>("member-ties.json", []);
}

export function getMeta(): Promise<Meta> {
  return read<Meta>("meta.json", {});
}

/**
 * meta.json for the layout: at request time a failed fetch gives {} (the footer says "unknown") so the
 * page's own error state can show; at build time it fails the build like any other read.
 */
export async function getMetaForLayout(): Promise<Meta> {
  if (!IS_REMOTE || IS_BUILD) return getMeta();
  try {
    return await getMeta();
  } catch (err) {
    console.error(err);
    return {};
  }
}

/** Any data file by path, or the fallback when it is missing (files newer than some builds and the fixtures). */
export function readData<T>(rel: string, fallback: T): Promise<T> {
  return read<T>(rel, fallback);
}

/** Build date as an ISO string (see meta.ts metaBuilt). */
export function metaBuilt(meta: Meta): string | null {
  return builtFrom(meta);
}

/** Run `fn` over `items` with at most `limit` in flight (remote reads of many member files). */
export async function mapLimit<A, B>(items: readonly A[], limit: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out = new Array<B>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Every name an edge list refers to, for labelling in the browser. */
export async function nameBookFor(edges: Edge[], extraMembers: string[] = []): Promise<NameBook> {
  const mi = await getMemberIndex();
  const oi = await getOrgIndex();
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
export function orgNodesOf(file: MemberFileWire, oi: Map<string, OrgSummary>): Record<string, OrgSummary> {
  const out: Record<string, OrgSummary> = {};
  for (const [id, n] of Object.entries(file.nodes ?? {})) {
    if (n.kind === "member") continue;
    const o = oi.get(id);
    out[id] = { id, name: n.name, kind: n.kind, ticker: n.ticker, cik: o?.cik ?? null, sector: o?.sector ?? null, degree: o?.degree ?? 0 };
  }
  return out;
}

/** `edges` holds the strings plus up to 3 spenders against (told apart by pick.ts isAgainst); `againstMore` counts the rest. */
export type MemberBoard = { edges: Edge[]; nodes: Record<string, OrgSummary>; members: Record<string, BoardMember>; more: number; againstMore: number };

/** The strings the board draws for one member, chosen by `pickBoard` from every edge in the file. */
export async function memberBoard(id: string): Promise<MemberBoard> {
  const file = await getMemberFile(id);
  if (!file) return { edges: [], nodes: {}, members: {}, more: 0, againstMore: 0 };
  const split = pickBoardSplit(id, file.edges);
  const edges = [...split.strings, ...split.against];
  const all = orgNodesOf(file, await getOrgIndex());
  const nodes: Record<string, OrgSummary> = {};
  const members: Record<string, BoardMember> = {};
  const mi = await getMemberIndex();
  const drawn = new Set<string>();
  for (const e of edges)
    for (const n of [e.from, e.to]) {
      if (n.id === id) continue;
      drawn.add(n.id);
      if (n.kind === "org" && all[n.id]) nodes[n.id] = all[n.id];
      const member = n.kind === "member" ? mi.get(n.id) : undefined;
      if (member) members[n.id] = toBoardMember(member);
    }
  const m = file.member;
  const more = Math.max(0, (m.counts?.orgs ?? 0) + (m.counts?.members ?? 0) - drawn.size);
  return { edges, nodes, members, more, againstMore: split.againstMore };
}

/**
 * A member's holdings file (House annual reports), or null. PT_HOLDINGS_DIR points
 * at another folder of holdings/<id>.json files (testing against unmerged data).
 */
export async function getHoldings(id: string): Promise<HoldingsFile | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (IS_REMOTE) return readOptional<HoldingsFile>(`holdings/${id}.json`);
  const dir = process.env.PT_HOLDINGS_DIR || join(DATA_DIR, "holdings");
  const p = join(dir, `${id}.json`);
  if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
  try {
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as HoldingsFile;
  } catch {
    return null;
  }
}
