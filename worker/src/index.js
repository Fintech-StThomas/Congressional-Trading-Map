// Cloudflare Worker: read-only front for the Paper Trail R2 bucket (binding BUCKET). Routes:
//   /releases/current.json, /releases/index.json      mutable pointer and history list (always revalidated)
//   /releases/<64-hex>/<path>                         a file of an immutable release: descriptor -> blob releases/blobs/<sha256>
//   /data/<path>                                      the legacy data/ objects (pass-through)
// Only GET and HEAD. The bucket is never listed. See worker/README.md and docs/RELEASE-OPERATIONS.md.

import { createDescriptorLoader } from "./descriptors.js";
import { decodePath, isHex64, isSafePath } from "./paths.js";
import { contentTypeFor } from "./types.js";

const POINTER_CACHE = "no-cache, max-age=0, must-revalidate";
const BLOB_CACHE = "public, max-age=86400, s-maxage=31536000, immutable";
const DATA_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const TOMBSTONE_RECHECK_MS = 30_000;
const RELEASE_ROUTE = /^\/releases\/([0-9a-f]{64})\/(.+)$/;

const BASE_HEADERS = { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };

function reply(status, message, extra = {}) {
  return new Response(message, {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

const notFound = () => reply(404, "Not found");

/** True when an If-None-Match header value matches the strong ETag. */
export function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(",").some((item) => {
    const value = item.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

function bodyResponse(request, status, body, headers) {
  return new Response(request.method === "HEAD" ? null : body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

async function pointerObject(request, env, key) {
  const object = request.method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
  if (!object) return notFound();
  const headers = { "Content-Type": "application/json", "Cache-Control": POINTER_CACHE };
  if (object.httpEtag) headers.ETag = object.httpEtag;
  if (typeof object.size === "number") headers["Content-Length"] = String(object.size);
  return bodyResponse(request, 200, object.body, headers);
}

async function dataObject(request, env, rest) {
  const path = decodePath(rest);
  if (path === null || !isSafePath(path, { allowReserved: true })) return notFound();
  const key = `data/${path}`;
  const object = request.method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
  if (!object) return notFound();
  const stored = object.httpMetadata && object.httpMetadata.contentType;
  const headers = { "Content-Type": stored || contentTypeFor(path), "Cache-Control": DATA_CACHE };
  if (object.httpEtag) headers.ETag = object.httpEtag;
  if (typeof object.size === "number") headers["Content-Length"] = String(object.size);
  return bodyResponse(request, 200, object.body, headers);
}

export function createHandler({ caches = globalThis.caches, now = () => Date.now() } = {}) {
  const loadDescriptor = createDescriptorLoader({ caches });
  const withdrawn = new Set(); // tombstones never go away
  const notWithdrawnUntil = new Map(); // release id -> time before which "no tombstone" is trusted

  async function isWithdrawn(env, releaseId) {
    if (withdrawn.has(releaseId)) return true;
    if ((notWithdrawnUntil.get(releaseId) || 0) > now()) return false;
    const tombstone = await env.BUCKET.head(`releases/withdrawn/${releaseId}.json`);
    if (tombstone) {
      withdrawn.add(releaseId);
      return true;
    }
    if (notWithdrawnUntil.size > 64) notWithdrawnUntil.clear();
    notWithdrawnUntil.set(releaseId, now() + TOMBSTONE_RECHECK_MS);
    return false;
  }

  async function releaseFile(request, env, releaseId, rest, origin) {
    const path = decodePath(rest);
    if (path === null || !isSafePath(path)) return notFound();
    if (await isWithdrawn(env, releaseId)) return notFound();
    let files;
    try {
      files = await loadDescriptor(releaseId, env, origin);
    } catch {
      return reply(502, "Release data is unavailable.");
    }
    if (!files) return notFound();
    const entry = files.get(path);
    if (!entry) return notFound();
    const etag = `"${entry.sha256}"`;
    const headers = {
      "Content-Type": contentTypeFor(path), "Cache-Control": BLOB_CACHE, ETag: etag,
    };
    if (etagMatches(request.headers.get("If-None-Match"), etag)) return bodyResponse(request, 304, null, headers);
    const key = `releases/blobs/${entry.sha256}`;
    const object = request.method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
    // A descriptor that names a missing or wrong-sized blob is corruption; say so briefly and leak nothing.
    if (!object || object.size !== entry.bytes) return reply(502, "Release data is unavailable.");
    headers["Content-Length"] = String(entry.bytes);
    return bodyResponse(request, 200, object.body, headers);
  }

  return async function handle(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply(405, "Method not allowed", { Allow: "GET, HEAD" });
    }
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === "/releases/current.json") return pointerObject(request, env, "releases/current.json");
    if (pathname === "/releases/index.json") return pointerObject(request, env, "releases/index.json");
    const release = RELEASE_ROUTE.exec(pathname);
    if (release && isHex64(release[1])) return releaseFile(request, env, release[1], release[2], url.origin);
    if (pathname.startsWith("/data/") && pathname.length > "/data/".length) {
      return dataObject(request, env, pathname.slice("/data/".length));
    }
    return notFound();
  };
}

const handler = createHandler();

export default {
  async fetch(request, env) {
    try {
      return await handler(request, env);
    } catch {
      return reply(502, "Storage is unavailable.");
    }
  },
};
