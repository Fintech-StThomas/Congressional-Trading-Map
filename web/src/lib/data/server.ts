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
import { POINTER_REVALIDATE_SECONDS } from "./remote.ts";
import { isReleaseId, parsePointer, releasePointerUrl } from "./release.ts";

export { IS_BUILD, IS_PINNED, IS_REMOTE, IS_SAMPLE, DATA_DIR, REMOTE_BASE, RELEASE_BASE } from "./mode.ts";
export { orgNodesOf, type Data, type MemberBoard } from "./reader.ts";

/** Local and legacy remote modes have one reader, bound to no release. */
const unpinned: Data | null = IS_PINNED ? null : createReader(null);

/** The pointer, fetched and validated. Fails closed: a missing, unreachable or malformed pointer is an error, never a guess. */
async function resolveLatest(): Promise<Data> {
  if (unpinned) return unpinned;
  const url = releasePointerUrl(RELEASE_BASE as string);
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: POINTER_REVALIDATE_SECONDS } });
  } catch (err) {
    throw new Error(`[data] could not fetch the release pointer ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`[data] ${res.status} ${res.statusText} from the release pointer ${url}`);
  let pointer;
  try {
    pointer = parsePointer(await res.json());
  } catch (err) {
    throw new Error(`[data] the release pointer ${url} is invalid: ${(err as Error).message}`);
  }
  return createReader(pointer.release_id);
}

/**
 * The reader for the active release. React-cached, so the layout, page and generateMetadata of one render share one
 * pointer resolution. Route handlers (where React does not memoise) must call it once per request and use only
 * that reader.
 */
export const latestData: () => Promise<Data> = cache(resolveLatest);

async function resolveRelease(id: string): Promise<Data | null> {
  // The shape is checked before any fetch; outside pinned mode there are no releases.
  if (!IS_PINNED || !isReleaseId(id)) return null;
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
