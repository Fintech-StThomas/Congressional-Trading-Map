// Browser-safe helpers: where the data lives, a small fetch cache, and the
// name book used to label nodes. No Node APIs in this file.
import type { Edge, MemberSummary, NodeRef, OrgSummary } from "./types";

export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data";
export const IS_SAMPLE_CLIENT = process.env.NEXT_PUBLIC_SAMPLE === "1";

export function dataUrl(rel: string): string {
  return `${DATA_BASE}/${rel}`;
}

const inflight = new Map<string, Promise<unknown>>();

/** Fetch JSON once per URL per page load. Failed requests are not cached. */
export function getJSON<T>(url: string): Promise<T> {
  let p = inflight.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/** The compact member shape the board ships to the browser. */
export type BoardMember = {
  id: string;
  name: string;
  last: string;
  party: MemberSummary["party"];
  state: string;
  chamber: MemberSummary["chamber"];
  district: number | null;
  photo: boolean;
  current: boolean;
  cases: number;
};

export function toBoardMember(m: MemberSummary): BoardMember {
  return {
    id: m.id, name: m.name, last: m.last, party: m.party, state: m.state, chamber: m.chamber,
    district: m.district, photo: m.photo, current: m.current, cases: m.counts?.cases ?? 0,
  };
}

export type NameBook = {
  members: Record<string, BoardMember>;
  orgs: Record<string, OrgSummary>;
};

export function nodeName(ref: NodeRef, book: NameBook): string {
  if (ref.kind === "member") return book.members[ref.id]?.name ?? ref.id;
  return book.orgs[ref.id]?.name ?? ref.id;
}

export const ORG_KIND_LABEL: Record<OrgSummary["kind"], string> = {
  company: "Company",
  pac: "PAC",
  party: "Party committee",
  super_pac: "Super PAC",
  committee: "Congressional committee",
  lobby: "Lobbying",
  other: "Other",
};

export function orgHref(id: string): string {
  return `/o/${encodeURIComponent(id)}`;
}

export function memberHref(id: string): string {
  return `/m/${id}`;
}

export function boardHref(params: { m?: string; s?: string; o?: string; focus?: string }): string {
  const q = new URLSearchParams();
  if (params.s) q.set("s", params.s);
  if (params.m) q.set("m", params.m);
  if (params.o) q.set("o", params.o);
  if (params.focus) q.set("focus", params.focus);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export type OrgLite = { id: string; name: string; kind: OrgSummary["kind"]; degree: number; ticker: string | null };
export type SearchIndex = { members: BoardMember[]; orgs: OrgLite[] };

type RawIndex = {
  m: [string, string, string, MemberSummary["party"], string, MemberSummary["chamber"], number | null, number, number, number][];
  o: [string, string, OrgSummary["kind"], number, string | null][];
};

let indexPromise: Promise<SearchIndex> | null = null;

/** The compact member and organisation index built at /search-index. */
export function loadSearchIndex(): Promise<SearchIndex> {
  if (!indexPromise) {
    indexPromise = getJSON<RawIndex>("/search-index").then((raw) => ({
      members: raw.m.map(([id, name, last, party, state, chamber, district, current, photo, cases]) => ({
        id, name, last, party, state, chamber, district, current: current === 1, photo: photo === 1, cases,
      })),
      orgs: raw.o.map(([id, name, kind, degree, ticker]) => ({ id, name, kind, degree, ticker })),
    }));
    indexPromise.catch(() => (indexPromise = null));
  }
  return indexPromise;
}

/**
 * Full Edge for a tie row, loaded lazily from the member's case file.
 * Returns the row itself when no full record exists.
 */
export async function resolveTie<E extends Edge & { _tie?: { member: string; edge: string | null } }>(e: E): Promise<Edge> {
  const t = e._tie;
  if (!t?.edge) return e;
  const file = await getJSON<{ edges: Edge[] }>(dataUrl(`members/${t.member}.json`));
  return file.edges.find((x) => x.id === t.edge) ?? e;
}
