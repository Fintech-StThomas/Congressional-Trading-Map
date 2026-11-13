import type { NextConfig } from "next";
import { useRealData } from "./src/lib/source";

// Same rule as scripts/resolve-data.mjs: real data when the pipeline has
// written public/data/members.json, otherwise the fixtures copied to
// public/sample-data. The client reads these two values to fetch files.
const hasRealData = useRealData();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Every page is prerendered from the JSON at build time; nothing reads the
  // data at request time, so keep it out of any server bundle.
  outputFileTracingExcludes: { "*": ["public/**", "fixtures/**", ".cache/**"] },
  env: {
    NEXT_PUBLIC_DATA_BASE: hasRealData ? "/data" : "/sample-data",
    NEXT_PUBLIC_SAMPLE: hasRealData ? "0" : "1",
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
