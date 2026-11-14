import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRealDataBuild } from "./src/lib/data/source";

// Same rule as scripts/resolve-data.mjs: real data when the pipeline has
// written public/data/members.json, otherwise the fixtures copied to
// public/sample-data. The client reads these two values to fetch files.
const hasRealData = isRealDataBuild();

// The data's current year (wall-years.json `years[1]`), so every year axis ends where the data ends
// and server and browser agree. Falls back to the build year.
function dataYearMax(): number {
  try {
    const dir = hasRealData ? join("public", "data") : join("fixtures", "data");
    const years = JSON.parse(readFileSync(join(process.cwd(), dir, "wall-years.json"), "utf8")).years;
    if (Array.isArray(years) && Number.isInteger(years[1])) return years[1];
  } catch {}
  return new Date().getFullYear();
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Every page is prerendered from the JSON at build time; nothing reads the
  // data at request time, so keep it out of any server bundle.
  outputFileTracingExcludes: { "*": ["public/**", "fixtures/**", ".cache/**"] },
  env: {
    NEXT_PUBLIC_DATA_BASE: hasRealData ? "/data" : "/sample-data",
    NEXT_PUBLIC_SAMPLE: hasRealData ? "0" : "1",
    NEXT_PUBLIC_YEAR_MAX: String(dataYearMax()),
  },
  // Organisation pages are rendered in the browser from the org shard, so
  // every /o/<id> is served by one static page instead of tens of thousands.
  async rewrites() {
    return [{ source: "/o/:id", destination: "/org" }];
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

export default nextConfig;
