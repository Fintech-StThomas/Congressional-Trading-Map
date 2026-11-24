// Release descriptors (releases/<id>/release.json) are immutable, so they are cached by release id in a small
// in-memory LRU and in the Workers Cache API. A tombstone check always runs before a cached descriptor is used.
// A release id with no descriptor is remembered as missing for MISSING_TTL_MS (memory and Cache API), so a made-up id
// costs the bucket one read per window instead of one per request.

import { isHex64, isSafePath } from "./paths.js";

const MAX_DESCRIPTOR_BYTES = 8 * 1024 * 1024;
export const MISSING_TTL_MS = 5 * 60 * 1000;

/** Parse and sanity-check a descriptor. Returns {path: {sha256, bytes}} or null when it is not usable. */
export function parseDescriptor(text, releaseId) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || value.schema_version !== 1 || value.release_id !== releaseId) return null;
  const files = value.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  const map = new Map();
  for (const [path, entry] of Object.entries(files)) {
    if (!isSafePath(path) || !entry || !isHex64(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      return null;
    }
    map.set(path, { sha256: entry.sha256, bytes: entry.bytes });
  }
  return map;
}

/** A Map-based LRU: the most recently used entries survive. */
export class Lru {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}

/**
 * Create a loader: (releaseId, env, origin) -> Map | null (no descriptor) and throws "corrupt" for an unusable one.
 * `caches` is the Workers CacheStorage (or a fake); its `default` is used when present.
 */
export function createDescriptorLoader({ caches, lruSize = 16, now = () => Date.now() } = {}) {
  const memory = new Lru(lruSize);
  const missing = new Lru(256); // release id -> time until which "no descriptor" is trusted
  const store = caches && caches.default;
  const missingKey = (releaseId, origin) => new Request(`${origin}/__missing/${releaseId}`);

  /** True when this id was recently found to have no descriptor (memory first, then the Cache API). */
  async function isMissing(releaseId, origin) {
    if ((missing.get(releaseId) || 0) > now()) return true;
    if (!store) return false;
    try {
      if (await store.match(missingKey(releaseId, origin))) {
        missing.set(releaseId, now() + MISSING_TTL_MS);
        return true;
      }
    } catch {
      // The Cache API is an optimisation only.
    }
    return false;
  }

  async function remember(releaseId, origin) {
    missing.set(releaseId, now() + MISSING_TTL_MS);
    if (!store) return;
    try {
      await store.put(missingKey(releaseId, origin), new Response("", {
        headers: { "Cache-Control": `public, max-age=${MISSING_TTL_MS / 1000}` },
      }));
    } catch {
      // The Cache API is an optimisation only.
    }
  }

  async function load(releaseId, env, origin) {
    const cached = memory.get(releaseId);
    if (cached) return cached;
    const cacheKey = new Request(`${origin}/__descriptor/${releaseId}`);
    if (store) {
      const hit = await store.match(cacheKey);
      if (hit) {
        const parsed = parseDescriptor(await hit.text(), releaseId);
        if (parsed) {
          memory.set(releaseId, parsed);
          return parsed;
        }
      }
    }
    const object = await env.BUCKET.get(`releases/${releaseId}/release.json`);
    if (!object) {
      await remember(releaseId, origin);
      return null;
    }
    if (object.size > MAX_DESCRIPTOR_BYTES) throw new Error("corrupt");
    const text = await new Response(object.body).text();
    const parsed = parseDescriptor(text, releaseId);
    if (!parsed) throw new Error("corrupt");
    memory.set(releaseId, parsed);
    if (store) {
      try {
        await store.put(cacheKey, new Response(text, {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" },
        }));
      } catch {
        // The Cache API is an optimisation only.
      }
    }
    return parsed;
  }

  load.isMissing = isMissing;
  return load;
}
