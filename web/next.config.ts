import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRealDataBuild, sampleFallbackError } from "./src/lib/data/source";
import { remoteDataBase, remoteFileUrl, remoteRewrite } from "./src/lib/data/remote";
import { RELEASE_ID_PATTERN, parsePointer, releaseBase, releaseFileUrl, releaseIndexRewrite, releasePointerUrl, releaseRewrite } from "./src/lib/data/release";
import { MEMBER_ID_PATTERN, ORG_PATTERN, STATE_PATTERN } from "./src/lib/data/ids";
import { EMBED_SOURCE, NOT_EMBED_SOURCE, embedHeaders, securityHeaders } from "./src/lib/security-headers";

// Three data modes (README "Data modes"):
//   DATA_BASE_URL unset (local): the dataset in public/data (or the fixtures copied to public/sample-data),
//     read at build time; the browser fetches /data/... (or /sample-data/...) as static files.
//   DATA_BASE_URL set (remote): nothing is read from public/data. Server code fetches from DATA_BASE_URL
//     and the browser keeps fetching same-origin /data/..., proxied there by a beforeFiles rewrite, which
//     runs before public/ files, so a stale public/data folder can never shadow the remote tree.
//   RELEASE_BASE_URL set (pinned, opt-in): like remote mode, but every read is bound to one immutable release
//     (releases/<id>/...) resolved from releases/current.json; the browser fetches same-origin /releases/<id>/...
//     (rewritten to the bucket) and /r/<id>/... generated JSON, so a page never mixes releases. Wins over DATA_BASE_URL.
const remote = remoteDataBase(process.env.DATA_BASE_URL);
const pinned = releaseBase(process.env.RELEASE_BASE_URL);

// Local mode, same rule as scripts/resolve-data.mjs: real data when the pipeline has written
// public/data/members.json, otherwise the fixtures copied to public/sample-data.
const hasRealData = remote || pinned ? true : isRealDataBuild();

// The data's current year (wall-years.json `years[1]`), so every year axis ends where the data ends
// and server and browser agree. Falls back to the build year locally; in remote mode a failed fetch
// fails the build.
async function dataYearMax(phase: string): Promise<number> {
  if (pinned) {
    // `next start` reuses what the build inlined; only builds and `next dev` need the value.
    if (phase === PHASE_PRODUCTION_SERVER) return new Date().getFullYear();
    // The pointer first, then that one release's wall-years.json: the year and the pages built next agree.
    const pointerUrl = releasePointerUrl(pinned);
    const pointer = await fetch(pointerUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} from ${pointerUrl}`);
        return parsePointer(await res.json());
      })
      .catch((err) => {
        throw new Error(`[data] RELEASE_BASE_URL: could not read the release pointer: ${err.message}`);
      });
    const url = releaseFileUrl(pinned, pointer.release_id, "wall-years.json");
    const res = await fetch(url).catch((err) => {
      throw new Error(`[data] RELEASE_BASE_URL: could not fetch ${url}: ${err.message}`);
    });
    if (!res.ok) throw new Error(`[data] RELEASE_BASE_URL: ${res.status} from ${url}`);
    const years = (await res.json()).years;
    if (!Array.isArray(years) || !Number.isInteger(years[1])) throw new Error(`[data] RELEASE_BASE_URL: ${url} has no years[1]`);
    return years[1];
  }
  if (remote) {
    // `next start` reuses what the build inlined; only builds and `next dev` need the value.
    if (phase === PHASE_PRODUCTION_SERVER) return new Date().getFullYear();
    const url = remoteFileUrl(remote, "wall-years.json");
    const res = await fetch(url).catch((err) => {
      throw new Error(`[data] DATA_BASE_URL: could not fetch ${url}: ${err.message}`);
    });
    if (!res.ok) throw new Error(`[data] DATA_BASE_URL: ${res.status} from ${url}`);
    const years = (await res.json()).years;
    if (!Array.isArray(years) || !Number.isInteger(years[1])) throw new Error(`[data] DATA_BASE_URL: ${url} has no years[1]`);
    return years[1];
  }
  try {
    const dir = hasRealData ? join("public", "data") : join("fixtures", "data");
    const years = JSON.parse(readFileSync(join(process.cwd(), dir, "wall-years.json"), "utf8")).years;
    if (Array.isArray(years) && Number.isInteger(years[1])) return years[1];
  } catch {}
  return new Date().getFullYear();
}

// A day in the browser, a year at the edge: a transient error answered under a release URL cannot stick in a browser for long.
const IMMUTABLE = "public, max-age=86400, s-maxage=31536000, immutable";

export default async function config(phase: string): Promise<NextConfig> {
  // A hosted build (Vercel, CI) never falls back to the sample data unless PT_DATA=fixtures says so.
  const guard = phase === PHASE_PRODUCTION_BUILD ? sampleFallbackError(process.env, hasRealData) : null;
  if (guard) throw new Error(guard);
  const nextConfig: NextConfig = {
    // A separate output folder lets a second build (tests/pinned, a remote build) sit beside the main one.
    distDir: process.env.PT_DIST_DIR || ".next",
    reactStrictMode: true,
    poweredByHeader: false,
    // Local mode prerenders every page from the JSON at build time and nothing reads the data at request
    // time; remote mode fetches it. Either way, keep raw files out of server traces.
    // Map geometry is a static JSON import compiled into the server JS, not an fs read.
    outputFileTracingExcludes: { "*": ["public/**", "fixtures/**", ".cache/**"] },
    env: {
      NEXT_PUBLIC_DATA_BASE: hasRealData ? "/data" : "/sample-data",
      NEXT_PUBLIC_SAMPLE: hasRealData ? "0" : "1",
      NEXT_PUBLIC_YEAR_MAX: String(await dataYearMax(phase)),
      // Server code only (lib/data/server.ts): the build's DATA_BASE_URL, so build and runtime agree.
      PT_REMOTE_DATA: remote ?? "",
      // Same for RELEASE_BASE_URL (pinned mode).
      PT_REMOTE_RELEASES: pinned ?? "",
    },
    // Organisation pages are rendered in the browser from the org shard, so
    // every /o/<id> is served by one static page instead of tens of thousands.
    async rewrites() {
      // Only well-formed ids are rewritten (lib/data/ids.ts). Anything else falls through to a route with
      // dynamicParams = false (or to no route at all), which answers 404 without rendering or reading data.
      const org = { source: `/o/:id(${ORG_PATTERN})`, destination: "/org" };
      // The embed card's `?theme=dark` is a path to the static route (a static route cannot read a query). Ahead of every other rewrite.
      const dark = [{ type: "query" as const, key: "theme", value: "dark" }];
      const darkTo = (latest: string) => [
        { source: `/embed/m/:id(${MEMBER_ID_PATTERN})`, has: dark, destination: latest },
        { source: `/embed/r/:release(${RELEASE_ID_PATTERN})/m/:id(${MEMBER_ID_PATTERN})`, has: dark, destination: "/embed/r/:release/m/:id/dark" },
      ];
      if (!remote && !pinned) return { beforeFiles: darkTo("/embed/m/:id/dark"), afterFiles: [org], fallback: [] };
      // Remote modes: the data proxies, and the per-member, per-state and paged routes served by their
      // on-demand twins under app/live (route segment config is literal, so the twins carry dynamicParams).
      // Pinned mode proxies /releases/<id>/... to the bucket; the legacy /data proxy stays only with DATA_BASE_URL.
      const m = `:id(${MEMBER_ID_PATTERN})`;
      const live = [
        [`/m/${m}`, "/live/m/:id"],
        [`/m/${m}/records`, "/live/m/:id/records"],
        [`/board-data/:state(${STATE_PATTERN})`, "/live/board-data/:state"],
        [`/board-member/${m}`, "/live/board-member/:id"],
        ["/cases/:slug+", "/live/cases/:slug+"],
        [`/feed/m/:file(${MEMBER_ID_PATTERN}\\.xml)`, "/live/feed/m/:file"],
        ["/feed/trades.xml", "/live/feed/site/trades.xml"],
        [`/embed/m/${m}`, "/live/embed/m/:id"],
      ].map(([source, destination]) => ({ source, destination }));
      const proxies = [...(pinned ? [releaseIndexRewrite(pinned), releaseRewrite(pinned)] : []), ...(remote ? [remoteRewrite(remote)] : [])];
      return { beforeFiles: [...proxies, ...darkTo("/live/embed/m/:id/dark"), ...live], afterFiles: [org], fallback: [] };
    },
    // Later entries override earlier ones for the same header key (Next docs, "Header Overriding Behavior").
    async headers() {
      return [
        // CSP, nosniff, frame, referrer, permissions, COOP and CORP on every response (lib/security-headers.ts).
        // Not on /embed/<...>: the member card may be framed, so it has its own rule below (the /embed help page is a normal page).
        { source: NOT_EMBED_SOURCE, headers: securityHeaders(process.env) },
        { source: EMBED_SOURCE, headers: embedHeaders(process.env) },
        // Feeds: readers recheck hourly and may serve stale for a day.
        { source: "/feed/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }] },
        // The share card is fetched by other sites (social previews, chat unfurls): readable cross-origin.
        { source: "/:og(opengraph-image.*)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
        // Same for each member's card (app/m/[id]/opengraph-image and its remote-mode twin under app/live/m).
        { source: "/m/:id/:og(opengraph-image.*)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
        { source: "/live/m/:id/:og(opengraph-image.*)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
        {
          source: "/(board-data|sample-data)/:path*",
          headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }],
        },
        // Proxied data (remote) or the local build's static files. The same policy publish_r2.py sets on the
        // objects, stated here so the browser gets it whichever header wins: browsers recheck after 5 minutes,
        // the edge keeps a copy for an hour (Vercel removes s-maxage before the response reaches the browser).
        {
          source: "/data/:path*",
          headers: [{ key: "Cache-Control", value: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" }],
        },
        // Pinned mode: a release is immutable, so its files and the JSON generated from it never change under their URL.
        ...(pinned
          ? [
              // Only <release id>/... is immutable. /releases/index.json (the release list) is mutable and advisory: always revalidated.
              { source: `/releases/:release(${RELEASE_ID_PATTERN})/:path*`, headers: [{ key: "Cache-Control", value: IMMUTABLE }] },
              { source: "/releases/index.json", headers: [{ key: "Cache-Control", value: "no-cache" }] },
              { source: `/r/:release(${RELEASE_ID_PATTERN})/:kind(board-data|board-member|search-index)/:path*`, headers: [{ key: "Cache-Control", value: IMMUTABLE }] },
            ]
          : []),
        // Content-stable static files: a week in the browser, then served stale for up to 30 days while it
        // rechecks. A changed portrait keeps its URL, so it reaches returning browsers within a week (rename the
        // file, e.g. <id>-2.webp, to force it at once; the edge itself is purged on every deploy).
        {
          source: "/(portraits|geo)/:path*",
          headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
        },
      ];
    },
  };
  return nextConfig;
}
