import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRealDataBuild, sampleFallbackError } from "./src/lib/data/source";
import { remoteDataBase, remoteFileUrl, remoteRewrite } from "./src/lib/data/remote";
import { MEMBER_ID_PATTERN, ORG_PATTERN, STATE_PATTERN } from "./src/lib/data/ids";
import { securityHeaders } from "./src/lib/security-headers";

// Two data modes (README "Data modes"):
//   DATA_BASE_URL unset (local): the dataset in public/data (or the fixtures copied to public/sample-data),
//     read at build time; the browser fetches /data/... (or /sample-data/...) as static files.
//   DATA_BASE_URL set (remote): nothing is read from public/data. Server code fetches from DATA_BASE_URL
//     and the browser keeps fetching same-origin /data/..., proxied there by a beforeFiles rewrite, which
//     runs before public/ files, so a stale public/data folder can never shadow the remote tree.
const remote = remoteDataBase(process.env.DATA_BASE_URL);

// Local mode, same rule as scripts/resolve-data.mjs: real data when the pipeline has written
// public/data/members.json, otherwise the fixtures copied to public/sample-data.
const hasRealData = remote ? true : isRealDataBuild();

// The data's current year (wall-years.json `years[1]`), so every year axis ends where the data ends
// and server and browser agree. Falls back to the build year locally; in remote mode a failed fetch
// fails the build.
async function dataYearMax(phase: string): Promise<number> {
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

export default async function config(phase: string): Promise<NextConfig> {
  // A hosted build (Vercel, CI) never falls back to the sample data unless PT_DATA=fixtures says so.
  const guard = phase === PHASE_PRODUCTION_BUILD ? sampleFallbackError(process.env, hasRealData) : null;
  if (guard) throw new Error(guard);
  const nextConfig: NextConfig = {
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
    },
    // Organisation pages are rendered in the browser from the org shard, so
    // every /o/<id> is served by one static page instead of tens of thousands.
    async rewrites() {
      // Only well-formed ids are rewritten (lib/data/ids.ts). Anything else falls through to a route with
      // dynamicParams = false (or to no route at all), which answers 404 without rendering or reading data.
      const org = { source: `/o/:id(${ORG_PATTERN})`, destination: "/org" };
      if (!remote) return [org];
      // Remote mode: the data proxy, and the per-member, per-state and paged routes served by their
      // on-demand twins under app/live (route segment config is literal, so the twins carry dynamicParams).
      const m = `:id(${MEMBER_ID_PATTERN})`;
      const live = [
        [`/m/${m}`, "/live/m/:id"],
        [`/m/${m}/records`, "/live/m/:id/records"],
        [`/board-data/:state(${STATE_PATTERN})`, "/live/board-data/:state"],
        [`/board-member/${m}`, "/live/board-member/:id"],
        ["/cases/:slug+", "/live/cases/:slug+"],
      ].map(([source, destination]) => ({ source, destination }));
      return { beforeFiles: [remoteRewrite(remote), ...live], afterFiles: [org], fallback: [] };
    },
    // Later entries override earlier ones for the same header key (Next docs, "Header Overriding Behavior").
    async headers() {
      return [
        // CSP, nosniff, frame, referrer, permissions, COOP and CORP on every response (lib/security-headers.ts).
        { source: "/:path*", headers: securityHeaders(process.env) },
        // The share card is fetched by other sites (social previews, chat unfurls): readable cross-origin.
        { source: "/:og(opengraph-image.*)", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
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
