// Release-pinned data (RELEASE_BASE_URL): the pure rules shared by next.config.ts, the server reader and tests.
// A release is an immutable tree `releases/<release_id>/<data path>` in the bucket; `releases/current.json` is the
// single mutable pointer. Ids are checked by shape before any fetch, and relative paths only ever come from code.
// Pure (no Node or Next imports) so node --test loads it directly.
import { remoteDataBase } from "./remote.ts";

/** A release id: the SHA-256 of the release descriptor, 64 lowercase hex digits. */
export const RELEASE_ID = /^[0-9a-f]{64}$/;
/** `:release(<this>)` / `:id(<this>)` in next.config path patterns (path-to-regexp). */
export const RELEASE_ID_PATTERN = "[0-9a-f]{64}";

export function isReleaseId(id: unknown): id is string {
  return typeof id === "string" && RELEASE_ID.test(id);
}

/** The normalised RELEASE_BASE_URL (no trailing slash), or null when pinned mode is off. Same rules as DATA_BASE_URL. */
export function releaseBase(raw: string | undefined | null): string | null {
  return remoteDataBase(raw, "RELEASE_BASE_URL");
}

/** The mutable pointer to the active release. */
export function releasePointerUrl(base: string): string {
  return `${base}/current.json`;
}

/** A data path made only of safe segments: no empty, `.` or `..` segment, no backslash, colon, query, fragment or escape. */
const SAFE_REL = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
export function isSafeRel(rel: string): boolean {
  return SAFE_REL.test(rel) && !rel.split("/").some((s) => s === "." || s === "..");
}

/** One file of one release: releaseFileUrl("https://x/releases", "<64 hex>", "members/A1.json"). Throws on a bad id or path. */
export function releaseFileUrl(base: string, id: string, rel: string): string {
  if (!isReleaseId(id)) throw new Error(`not a release id: ${JSON.stringify(id)}`);
  if (!isSafeRel(rel)) throw new Error(`not a safe data path: ${JSON.stringify(rel)}`);
  return `${base}/${id}/${rel}`;
}

export type ReleasePointer = { release_id: string; manifest_sha256: string };

const POINTER_KEYS = ["manifest_sha256", "release_id", "schema_version"];

/** Validate releases/current.json. Strict: exactly the three keys, schema_version 1, both digests 64 lowercase hex. Throws otherwise. */
export function parsePointer(json: unknown): ReleasePointer {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("release pointer is not an object");
  const o = json as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== POINTER_KEYS.join(",")) throw new Error("release pointer has unexpected keys");
  if (o.schema_version !== 1) throw new Error(`release pointer has unsupported schema_version ${JSON.stringify(o.schema_version)}`);
  if (!isReleaseId(o.release_id)) throw new Error("release pointer has a malformed release_id");
  if (!isReleaseId(o.manifest_sha256)) throw new Error("release pointer has a malformed manifest_sha256");
  return { release_id: o.release_id, manifest_sha256: o.manifest_sha256 };
}

/** The next.config rewrite for pinned mode: same-origin /releases/<id>/... proxied to the bucket, ahead of public/ files. */
export function releaseRewrite(base: string): { source: string; destination: string } {
  return { source: `/releases/:id(${RELEASE_ID_PATTERN})/:path*`, destination: `${base}/:id/:path*` };
}

/** The pointer to the active release as the browser fetches it: same origin (the bucket's releases/current.json, proxied). */
export const RELEASE_POINTER_PATH = "/releases/current.json";

/** The next.config rewrite for the pointer: exactly /releases/current.json, proxied to the bucket's current.json. */
export function releasePointerRewrite(base: string): { source: string; destination: string } {
  return { source: RELEASE_POINTER_PATH, destination: releasePointerUrl(base) };
}

/** The mutable, advisory release list (data dictionary, "Release history index"), as the browser fetches it: same origin. */
export const RELEASE_INDEX_PATH = "/releases/index.json";

/** The next.config rewrite for the release list: exactly /releases/index.json, proxied to the bucket's index.json. */
export function releaseIndexRewrite(base: string): { source: string; destination: string } {
  return { source: RELEASE_INDEX_PATH, destination: `${base}/index.json` };
}

/** Is this URL path under a permalink (/r/<release id>/...)? Used by the footer, which says "Latest data" there. */
export function isReleasePath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && /^\/r\/[0-9a-f]{64}(?:\/|$)/.test(pathname);
}
