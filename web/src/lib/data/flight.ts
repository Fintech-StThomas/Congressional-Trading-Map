// Single-flight for server data reads (used by server.ts in remote mode). Pure, so node --test loads it.

/**
 * Single-flight: concurrent renders in one server instance that need the same file share one fetch and one
 * JSON parse (a burst on a cold member page otherwise fetches and parses the same 7 MB file once per request).
 * Keyed by the data build's stamp; entries leave the map as soon as they settle, so nothing is held.
 */
const inflight = new Map<string, Promise<unknown>>();
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
