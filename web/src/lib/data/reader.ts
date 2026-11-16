// A data reader bound to exactly one release (or to none, in local and legacy remote modes): every accessor the
// pages and routes use. `createReader(null)` is the local / legacy reader; `createReader(<release id>)` reads that
// immutable release from RELEASE_BASE_URL and never anything else. Obtain readers from server.ts (latestData,
// releaseData), not from here. Reads: local fs, legacy remote (Next fetch cache, revalidated), pinned (force-cache).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Case, Edge, MemberFileWire, MemberSummary, Meta, OrgSummary, TradeFile } from "../types.ts";
import { toBoardMember, type BoardMember, type NameBook } from "../domain/names.ts";
import type { HoldingsFile } from "../domain/holdings.ts";
import { pickBoardSplit } from "../domain/pick.ts";
import { dataUrl, releaseDataUrl, releaseRouteUrl } from "../urls.ts";
import { DATA_DIR, IS_PINNED, REMOTE_BASE, RELEASE_BASE } from "./mode.ts";
import { REVALIDATE_SECONDS, remoteFileUrl } from "./remote.ts";
import { releaseFileUrl } from "./release.ts";
import { RecentStore } from "./recent.ts";
import { isMemberId } from "./ids.ts";
import { singleFlight } from "./flight.ts";

/** Releases whose large parsed files (orgs.json is over Next's 2 MB fetch cache limit) stay in memory. */
export const RELEASES_IN_MEMORY = 3;

/** Everything one render or request reads, bound to one release. `release` is null in local and legacy remote modes. */
export type Data = {
  release: string | null;
  getMembers(): Promise<MemberSummary[]>;
  getMemberIndex(): Promise<Map<string, MemberSummary>>;
  isKnownMember(id: string): Promise<boolean>;
  getMemberFile(id: string): Promise<MemberFileWire | null>;
  getTradeFile(id: string): Promise<TradeFile | null>;
  getBoard(): Promise<Board>;
  getCases(): Promise<Case[]>;
  getOrgs(): Promise<OrgSummary[]>;
  getOrgIndex(): Promise<Map<string, OrgSummary>>;
  getMemberTies(): Promise<Edge[]>;
  getMeta(): Promise<Meta>;
  /** Any data file by path, or the fallback when it is missing (files newer than some builds and the fixtures). */
  readData<T>(rel: string, fallback: T): Promise<T>;
  nameBookFor(edges: Edge[], extraMembers?: string[]): Promise<NameBook>;
  memberBoard(id: string): Promise<MemberBoard>;
  getHoldings(id: string): Promise<HoldingsFile | null>;
  /** The browser URL of a data file for this reader: /releases/<id>/<rel> when pinned, else the usual data URL. */
  fileUrl(rel: string): string;
  /** The browser URL of a generated JSON endpoint: routeUrl("board-data/CA") -> /r/<id>/board-data/CA when pinned, else /board-data/CA. */
  routeUrl(path: string): string;
};

/** `edges` holds the strings plus up to 3 spenders against (told apart by pick.ts isAgainst); `againstMore` counts the rest. */
export type MemberBoard = { edges: Edge[]; nodes: Record<string, OrgSummary>; members: Record<string, BoardMember>; more: number; againstMore: number };

/** Per-member files are read once each per page; keep them out of the in-memory cache. */
const uncached = (rel: string) => /^(members|trades|holdings|orgs)\//.test(rel);

/** Local and legacy remote: one set of parsed files (legacy: dropped when the data build changes). */
const plain = new Map<string, unknown>();
/** Pinned: parsed files per release, for the most recently used releases. */
const pinnedStore = new RecentStore<unknown>(RELEASES_IN_MEMORY);
let stampSeen = "";

const MEMBER_INDEX = "#memberIndex";
const ORG_INDEX = "#orgIndex";

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

export function createReader(release: string | null): Data {
  const pinned = release !== null;
  if (pinned && !RELEASE_BASE) throw new Error("[data] a release reader needs RELEASE_BASE_URL");
  const legacy = !pinned && REMOTE_BASE !== null;
  if (!pinned && IS_PINNED) throw new Error("[data] in pinned mode every reader is bound to a release");
  const remote = pinned || legacy;

  const mget = (k: string): unknown => (pinned ? pinnedStore.get(release, k) : plain.get(k));
  const mset = (k: string, v: unknown) => (pinned ? pinnedStore.set(release, k, v) : plain.set(k, v));

  // ------------------------------------------------------------ local mode
  function readLocal<T>(rel: string, fallback?: T): T {
    if (plain.has(rel)) return plain.get(rel) as T;
    const p = join(DATA_DIR, rel);
    if (!existsSync(/*turbopackIgnore: true*/ p)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing data file: ${p}`);
    }
    const value = JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as T;
    if (!uncached(rel)) plain.set(rel, value);
    return value;
  }

  // ------------------------------------------------------------ remote modes
  const urlOf = (rel: string) => (pinned ? releaseFileUrl(RELEASE_BASE as string, release, rel) : remoteFileUrl(REMOTE_BASE as string, rel));

  /**
   * One GET. Pinned files are immutable (force-cache); legacy files go through Next's fetch cache and are revalidated.
   * undefined on 404 (a missing optional file); throws on anything else.
   */
  async function fetchFile(rel: string): Promise<Response | undefined> {
    const url = urlOf(rel);
    let res: Response;
    try {
      res = await fetch(url, pinned ? { cache: "force-cache" } : { next: { revalidate: REVALIDATE_SECONDS } });
    } catch (err) {
      throw new Error(`[data] could not fetch ${url}: ${(err as Error).message}`);
    }
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`[data] ${res.status} ${res.statusText} from ${url}`);
    return res;
  }

  async function parse<T>(res: Response, rel: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new Error(`[data] ${rel} from ${urlOf(rel)} is not JSON: ${(err as Error).message}`);
    }
  }

  /**
   * Legacy only: the data build's identity, from meta.json's ETag (or Last-Modified). Fetching it on every read also
   * gives every route that reads data the revalidation period, whether or not the file below comes from memory.
   */
  async function legacyStamp(): Promise<{ stamp: string; res: Response }> {
    const res = await fetchFile("meta.json");
    if (!res) throw new Error(`[data] meta.json is missing under DATA_BASE_URL (${REMOTE_BASE})`);
    const stamp = res.headers.get("etag") ?? res.headers.get("last-modified") ?? String(Math.floor(Date.now() / (REVALIDATE_SECONDS * 1000)));
    return { stamp, res };
  }

  async function readRemote<T>(rel: string, fallback?: T): Promise<T> {
    let flightKey = `${release}|${rel}`;
    let metaRes: Response | undefined;
    if (legacy) {
      const { stamp, res } = await legacyStamp();
      if (stamp !== stampSeen) {
        plain.clear(); // a new data build: drop everything parsed from the previous one
        stampSeen = stamp;
      }
      flightKey = `${stamp}|${rel}`;
      metaRes = res;
    }
    const key = legacy ? `remote:${rel}` : rel;
    if (!uncached(rel) && (legacy ? plain.has(key) : mget(key) !== undefined)) return mget(key) as T;
    const value = await singleFlight(flightKey, async (): Promise<T | undefined> => {
      const res = legacy && rel === "meta.json" ? (metaRes as Response) : await fetchFile(rel);
      return res ? parse<T>(legacy ? res.clone() : res, rel) : undefined;
    });
    if (value === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing data file: ${urlOf(rel)}`);
    }
    if (!uncached(rel)) mset(key, value);
    return value;
  }

  const read = <T>(rel: string, fallback?: T): Promise<T> => (remote ? readRemote<T>(rel, fallback) : Promise.resolve().then(() => readLocal<T>(rel, fallback)));
  /** A file that may be missing (a member with no trades or holdings): null on 404, never an error. */
  const readOptional = <T>(rel: string) => read<T | null>(rel, null);

  /** Memoise a derived value (an index over a big file) beside the parsed files, so it follows their lifetime. */
  async function derived<V>(key: string, build: () => Promise<V>): Promise<V> {
    const hit = mget(key);
    if (hit !== undefined) return hit as V;
    const v = await build();
    mset(key, v);
    return v;
  }

  const self: Data = {
    release,
    getMembers: () => read<MemberSummary[]>("members.json"),
    getMemberIndex: () => derived(MEMBER_INDEX, async () => new Map((await self.getMembers()).map((m) => [m.id, m]))),
    /**
     * Is this a member of the dataset? The id's shape is checked first (no I/O); in remote modes it must then be in
     * members.json, fetched once per data build and held in memory, so junk ids never reach the bucket.
     */
    async isKnownMember(id) {
      if (!isMemberId(id)) return false;
      return !remote || (await self.getMemberIndex()).has(id);
    },
    async getMemberFile(id) {
      if (!(await self.isKnownMember(id))) return null;
      if (remote) return readOptional<MemberFileWire>(`members/${id}.json`);
      try {
        return readLocal<MemberFileWire>(`members/${id}.json`);
      } catch {
        return null;
      }
    },
    async getTradeFile(id) {
      if (!(await self.isKnownMember(id))) return null;
      if (remote) return readOptional<TradeFile>(`trades/${id}.json`);
      const p = join(DATA_DIR, "trades", `${id}.json`);
      if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
      return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as TradeFile;
    },
    getBoard: () => read<Board>("board.json", { states: {} }),
    getCases: () => read<Case[]>("cases.json", []),
    getOrgs: () => read<OrgSummary[]>("orgs.json", []),
    getOrgIndex: () => derived(ORG_INDEX, async () => new Map((await self.getOrgs()).map((o) => [o.id, o]))),
    getMemberTies: () => read<Edge[]>("member-ties.json", []),
    getMeta: () => read<Meta>("meta.json", {}),
    readData: (rel, fallback) => read(rel, fallback),

    /** Every name an edge list refers to, for labelling in the browser. */
    async nameBookFor(edges, extraMembers = []) {
      const mi = await self.getMemberIndex();
      const oi = await self.getOrgIndex();
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
    },

    /** The strings the board draws for one member, chosen by `pickBoard` from every edge in the file. */
    async memberBoard(id) {
      const file = await self.getMemberFile(id);
      if (!file) return { edges: [], nodes: {}, members: {}, more: 0, againstMore: 0 };
      const split = pickBoardSplit(id, file.edges);
      const edges = [...split.strings, ...split.against];
      const all = orgNodesOf(file, await self.getOrgIndex());
      const nodes: Record<string, OrgSummary> = {};
      const members: Record<string, BoardMember> = {};
      const mi = await self.getMemberIndex();
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
    },

    /**
     * A member's holdings file (House annual reports), or null. Locally, PT_HOLDINGS_DIR points
     * at another folder of holdings/<id>.json files (testing against unmerged data).
     */
    async getHoldings(id) {
      if (!(await self.isKnownMember(id))) return null;
      if (remote) return readOptional<HoldingsFile>(`holdings/${id}.json`);
      const dir = process.env.PT_HOLDINGS_DIR || join(DATA_DIR, "holdings");
      const p = join(dir, `${id}.json`);
      if (!existsSync(/*turbopackIgnore: true*/ p)) return null;
      try {
        return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as HoldingsFile;
      } catch {
        return null;
      }
    },

    fileUrl: (rel) => (pinned ? releaseDataUrl(release, rel) : dataUrl(rel)),
    routeUrl: (path) => (pinned ? releaseRouteUrl(release, path) : `/${path}`),
  };
  return self;
}
