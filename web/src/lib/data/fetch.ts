// Browser-side data loading: a fetch-once JSON cache, the search index and lazy evidence for
// organisation ties. No Node APIs. File locations come from lib/urls.ts.
import type { Edge, MemberSummary, OrgSummary } from "../types.ts";
import type { BoardMember } from "../domain/names.ts";
import { dataUrl } from "../urls.ts";

/** True on a fixtures build (every page then carries the SAMPLE DATA stamp). Set by next.config.ts. */
export const IS_SAMPLE_CLIENT = process.env.NEXT_PUBLIC_SAMPLE === "1";

const inflight = new Map<string, Promise<unknown>>();

/** Fetch JSON once per URL per page load. Failed requests (network or non-2xx) reject and are not cached. */
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

export type OrgLite = { id: string; name: string; kind: OrgSummary["kind"]; degree: number; ticker: string | null };
export type SearchIndex = { members: BoardMember[]; orgs: OrgLite[] };

/** The row shapes written by app/search-index/route.ts. */
type RawIndex = {
  m: [string, string, string, MemberSummary["party"], string, MemberSummary["chamber"], number | null, number, number, number][];
  o: [string, string, OrgSummary["kind"], number, string | null][];
};

let indexPromise: Promise<SearchIndex> | null = null;

/** The compact member and organisation index built at /search-index (every member, the 6,000 largest orgs). */
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
 * The full Edge (with evidence) for an organisation tie, loaded from the member's file when the
 * tie names one (`_tie.edge`). Returns the tie itself when no full record is published.
 */
export async function resolveTie<E extends Edge & { _tie?: { member: string; edge: string | null } }>(e: E): Promise<Edge> {
  const t = e._tie;
  if (!t?.edge) return e;
  const file = await getJSON<{ edges: Edge[] }>(dataUrl(`members/${t.member}.json`));
  return file.edges.find((x) => x.id === t.edge) ?? e;
}
