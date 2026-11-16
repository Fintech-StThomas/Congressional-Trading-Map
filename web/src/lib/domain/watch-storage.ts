// Browser storage for the watchlist: one localStorage key (`pt.watch.v1`), every read and write guarded, unreadable data
// ignored (the list starts empty and the page says so), and an "unavailable" result so the page carries on in memory
// with a notice. Reuses the KV interface of the saved-boards adapter; the storage object is passed in, so tests use a fake.
import type { KV } from "./saved-storage.ts";
import { emptyWatchlist, normaliseWatchlist, type Watchlist } from "./watchlist.ts";

export const WATCH_KEY = "pt.watch.v1";
export const WATCH_SCHEMA = "paper-trail.watch/1";

export type WatchStatus = "empty" | "ok" | "unavailable" | "corrupt";
export type WatchLoaded = { list: Watchlist; status: WatchStatus };

/** Reads the list. Anything that is not exactly the stored shape is "corrupt" (an empty list); it is overwritten on the next change. */
export function loadWatch(kv: KV | null): WatchLoaded {
  if (!kv) return { list: emptyWatchlist(), status: "unavailable" };
  let raw: string | null;
  try {
    raw = kv.getItem(WATCH_KEY);
  } catch {
    return { list: emptyWatchlist(), status: "unavailable" };
  }
  if (raw === null) return { list: emptyWatchlist(), status: "empty" };
  try {
    const v = JSON.parse(raw) as { schema?: unknown; members?: unknown; orgs?: unknown };
    if (v && v.schema === WATCH_SCHEMA && Array.isArray(v.members) && Array.isArray(v.orgs)) return { list: normaliseWatchlist(v), status: "ok" };
  } catch {
    /* falls through */
  }
  return { list: emptyWatchlist(), status: "corrupt" };
}

/** Writes the list. A full or blocked store reports failure; it never throws. */
export function saveWatch(kv: KV | null, list: Watchlist): { ok: boolean } {
  if (!kv) return { ok: false };
  try {
    kv.setItem(WATCH_KEY, JSON.stringify({ schema: WATCH_SCHEMA, members: list.members, orgs: list.orgs }));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
