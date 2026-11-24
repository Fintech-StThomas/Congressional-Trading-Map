// Server-only data access. Three modes, chosen at build time (see mode.ts and README "Data modes"):
//   local (default)              fs reads of public/data or the fixtures, at build time only
//   legacy remote (DATA_BASE_URL) mutable files fetched from the bucket's data/ tree, revalidated
//   pinned (RELEASE_BASE_URL)    every read bound to one immutable release of the bucket's releases/ tree
// Every data read goes through a `Data` reader (reader.ts) bound to exactly one release:
//   latestData()      the active release (pinned: resolved once per render from releases/current.json)
//   releaseData(id)   one explicit release, or null when it is unavailable; never falls back to the latest.
import { cache } from "react";
import type { Meta } from "../types.ts";
import { metaBuilt as builtFrom } from "./meta.ts";
import { createReader, type Data } from "./reader.ts";
import { IS_BUILD, IS_PINNED, IS_REMOTE, RELEASE_BASE } from "./mode.ts";
import { LISTING_REVALIDATE_SECONDS, POINTER_REVALIDATE_SECONDS } from "./remote.ts";
import { isReleaseId, listedReleaseIds, parsePointer, releaseIndexUrl, releasePointerUrl } from "./release.ts";

export { IS_BUILD, IS_PINNED, IS_REMOTE, IS_SAMPLE, DATA_DIR, REMOTE_BASE, RELEASE_BASE } from "./mode.ts";
export { orgNodesOf, type Data, type MemberBoard } from "./reader.ts";

/** Local and legacy remote modes have one reader, bound to no release. */
const unpinned: Data | null = IS_PINNED ? null : createReader(null);

/** Fetch and parse one small mutable release file (pointer or list) with a short revalidate. Fails closed: any problem throws. */
async function fetchPinnedJson<T>(url: string, what: string, revalidate: number, parse: (json: unknown) => T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate } });
  } catch (err) {
    throw new Error(`[data] could not fetch the ${what} ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`[data] ${res.status} ${res.statusText} from the ${what} ${url}`);
  try {
    return parse(await res.json());
  } catch (err) {
    throw new Error(`[data] the ${what} ${url} is invalid: ${(err as Error).message}`);
  }
}

const readPointer = () => fetchPinnedJson(releasePointerUrl(RELEASE_BASE as string), "release pointer", POINTER_REVALIDATE_SECONDS, parsePointer);

/** The pointer, fetched and validated. Fails closed: a missing, unreachable or malformed pointer is an error, never a guess. */
async function resolveLatest(): Promise<Data> {
  if (unpinned) return unpinned;
  return createReader((await readPointer()).release_id);
}

/**
 * The reader for the active release. React-cached, so the layout, page and generateMetadata of one render share one
 * pointer resolution. Route handlers (where React does not memoise) must call it once per request and use only
 * that reader.
 */
export const latestData: () => Promise<Data> = cache(resolveLatest);

/**
 * Is this release listed (releases/index.json) or the current one? The list is the allow-list: a made-up id never costs
 * a Worker call, and a withdrawn release (removed from the list) stops resolving within LISTING_REVALIDATE_SECONDS even
 * though its files may still sit in Vercel's Data Cache. The list is fetched fresh-ish (5 minutes); a missing list
 * (404) lists nothing; any other failure throws rather than guessing.
 */
async function isListed(id: string): Promise<boolean> {
  const url = releaseIndexUrl(RELEASE_BASE as string);
  let ids: Set<string>;
  try {
    ids = await fetchPinnedJson(url, "release list", LISTING_REVALIDATE_SECONDS, listedReleaseIds);
  } catch (err) {
    // A missing list lists nothing. Any other failure (outage, malformed list) still serves the current release, which
    // is always valid, and refuses every other id by rethrowing: never a guess.
    if (/^\[data\] 404 /.test((err as Error).message)) ids = new Set();
    else if ((await readPointer()).release_id === id) return true;
    else throw err;
  }
  // The list is written after the pointer moves, so the current release is accepted before it appears there.
  return ids.has(id) || (await readPointer()).release_id === id;
}

async function resolveRelease(id: string): Promise<Data | null> {
  // The shape is checked before any fetch; outside pinned mode there are no releases.
  if (!IS_PINNED || !isReleaseId(id) || !(await isListed(id))) return null;
  const reader = createReader(id);
  // A release is available when its meta.json is: a 404 means never published or withdrawn.
  return (await reader.readData<unknown>("meta.json", null)) === null ? null : reader;
}

/** The reader for one explicit release, or null when it is unavailable. Never falls back to the latest release. */
export const releaseData: (id: string) => Promise<Data | null> = cache(resolveRelease);

/**
 * meta.json of the latest release for the layout: at request time a failed fetch gives {} (the footer says
 * "unknown") so the page's own error state can show; at build time it fails the build like any other read.
 */
export async function getMetaForLayout(): Promise<Meta> {
  if (!IS_REMOTE || IS_BUILD) return (await latestData()).getMeta();
  try {
    return await (await latestData()).getMeta();
  } catch (err) {
    console.error(err);
    return {};
  }
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
