import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRealDataBuild } from "./src/lib/data/source";
import { remoteDataBase, remoteFileUrl, remoteRewrite } from "./src/lib/data/remote";

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
  const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    // Local mode prerenders every page from the JSON at build time and nothing reads the data at request
    // time; remote mode fetches it. Either way, keep the files out of any server bundle.
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
      const org = { source: "/o/:id", destination: "/org" };
      if (!remote) return [org];
      // Remote mode: the data proxy, and the per-member, per-state and paged routes served by their
      // on-demand twins under app/live (route segment config is literal, so the twins carry dynamicParams).
      const live = ["/m/:id", "/m/:id/records", "/board-data/:state", "/board-member/:id", "/cases/:slug+"].map((source) => ({ source, destination: `/live${source}` }));
      return { beforeFiles: [remoteRewrite(remote), ...live], afterFiles: [org], fallback: [] };
    },
    async headers() {
      return [
        {
          source: "/(data|sample-data|board-data)/:path*",
          headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }],
        },
      ];
    },
  };
  return nextConfig;
}
