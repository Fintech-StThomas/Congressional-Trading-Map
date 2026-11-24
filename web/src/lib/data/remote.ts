// Remote data mode: DATA_BASE_URL is the base URL under which the generated data tree is served
// (e.g. https://pub-xxxx.r2.dev/data). Unset: the data is read from web/public/data at build time,
// as always. Set: server code fetches from it with Next's fetch cache, the browser keeps fetching
// same-origin /data/... (rewritten to it in next.config.ts), and nothing reads web/public/data.
// Pure (no Node or Next imports) so next.config.ts, the server code and tests share one rule.

/**
 * How long fetched data and the pages built from it stay fresh, in seconds (one hour; the data changes once a day).
 * PT_REVALIDATE_SECONDS (a positive integer) overrides it, for tests that watch the latest data move; unset in production.
 */
export const REVALIDATE_SECONDS = ((): number => {
  const n = Number(typeof process !== "undefined" ? process.env.PT_REVALIDATE_SECONDS : undefined);
  return Number.isInteger(n) && n > 0 ? n : 3600;
})();

/**
 * How long the release pointer (releases/current.json) stays fresh in the fetch cache: short, because it is a few bytes
 * and a page rebuilt from a stale pointer keeps the previous release until its own next refresh (up to two hours).
 */
export const POINTER_REVALIDATE_SECONDS = Math.min(300, REVALIDATE_SECONDS);

/**
 * How long the release list (releases/index.json) and a permalink page built from it stay fresh: five minutes, so a
 * withdrawn release stops rendering at /r/<id>/... within that time once the list no longer names it.
 */
export const LISTING_REVALIDATE_SECONDS = POINTER_REVALIDATE_SECONDS;

/**
 * The normalised base URL (no trailing slash), or null when remote mode is off. Throws on a malformed value.
 * `name` is the environment variable the value came from, for the error message (release.ts reuses the rule).
 */
export function remoteDataBase(raw: string | undefined | null, name = "DATA_BASE_URL"): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${name} is not a URL: ${JSON.stringify(v)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`${name} must be http(s): ${JSON.stringify(v)}`);
  if (u.search || u.hash) throw new Error(`${name} must not carry a query or fragment: ${JSON.stringify(v)}`);
  return v.replace(/\/+$/, "");
}

/** The URL of one data file under the base: remoteFileUrl("https://x/data", "members/A1.json"). */
export function remoteFileUrl(base: string, rel: string): string {
  return `${base}/${rel.replace(/^\/+/, "")}`;
}

/** The next.config rewrite for remote mode: same-origin /data/... proxied to the base, ahead of public/ files. */
export function remoteRewrite(base: string): { source: string; destination: string } {
  return { source: "/data/:path*", destination: `${base}/:path*` };
}
