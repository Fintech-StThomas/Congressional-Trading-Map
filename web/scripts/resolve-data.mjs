#!/usr/bin/env node
// Decides which dataset the site is built from, before `next dev` / `next build`.
//
//   public/data/members.json exists  -> real data, served from /data
//   otherwise                        -> fixtures, copied to public/sample-data
//                                       and served from /sample-data
//
// The site never writes to public/data (the pipeline owns it).
// next.config.ts makes the same check and exposes the result to the client.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = join(root, "public", "data", "members.json");
const fixtures = join(root, "fixtures", "data");
const sampleOut = join(root, "public", "sample-data");

function useRealData() {
  if (process.env.PT_DATA === "fixtures" || !existsSync(real)) return false;
  if (process.env.PT_DATA === "real") return true;
  try {
    return Boolean(JSON.parse(readFileSync(join(root, "public", "data", "meta.json"), "utf8")).publication_budget);
  } catch {
    return false;
  }
}

if (useRealData()) {
  rmSync(sampleOut, { recursive: true, force: true });
  console.log("[data] using real data from public/data");
} else {
  if (!existsSync(join(fixtures, "members.json"))) {
    execFileSync(process.execPath, [join(root, "scripts", "make-fixtures.mjs")], { stdio: "inherit" });
  }
  rmSync(sampleOut, { recursive: true, force: true });
  cpSync(fixtures, sampleOut, { recursive: true });
  console.log("[data] no current-contract build in public/data: using SAMPLE fixtures (served from /sample-data)");
}

// Geo: the assets agent ships public/geo/us-states.json. For local development
// before it lands, fall back to a cached copy of us-atlas states-10m.
const geo = join(root, "public", "geo", "us-states.json");
const geoCache = join(root, ".cache", "us-states.json");
if (!existsSync(geo) && !existsSync(geoCache)) {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    if (!res.ok) throw new Error(String(res.status));
    mkdirSync(dirname(geoCache), { recursive: true });
    writeFileSync(geoCache, Buffer.from(await res.arrayBuffer()));
    console.log("[geo] public/geo/us-states.json missing: cached us-atlas states-10m for development");
  } catch (err) {
    console.warn("[geo] no state geometry available; the map will render without outlines:", err.message);
  }
}
