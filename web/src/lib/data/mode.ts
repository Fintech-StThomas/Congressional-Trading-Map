// Which data mode this server runs in, fixed at build time (README "Data modes"):
//   pinned (RELEASE_BASE_URL set)  every read is bound to one immutable release in the bucket
//   legacy remote (DATA_BASE_URL)  mutable files fetched from the bucket's data/ tree
//   local (neither)                the JSON in public/data (or the fixtures), read with fs at build time
// Pinned wins when both are set. next.config.ts inlines the variables as PT_REMOTE_RELEASES / PT_REMOTE_DATA.
import { join } from "node:path";
import { isRealDataBuild } from "./source.ts";
import { remoteDataBase } from "./remote.ts";
import { releaseBase } from "./release.ts";

const ROOT = process.cwd();

/** DATA_BASE_URL as seen at build time, or null. */
export const REMOTE_BASE = remoteDataBase(process.env.PT_REMOTE_DATA ?? process.env.DATA_BASE_URL);
/** RELEASE_BASE_URL as seen at build time, or null. */
export const RELEASE_BASE = releaseBase(process.env.PT_REMOTE_RELEASES ?? process.env.RELEASE_BASE_URL);
/** Pinned mode: reads go to one release at a time. */
export const IS_PINNED = RELEASE_BASE !== null;
/** Any remote mode (pinned or legacy): nothing is read from public/data. */
export const IS_REMOTE = IS_PINNED || REMOTE_BASE !== null;
/** Remote data is the published tree, never the fixtures. */
export const IS_SAMPLE = IS_REMOTE ? false : !isRealDataBuild(ROOT);
export const DATA_DIR = IS_SAMPLE ? join(ROOT, "fixtures", "data") : join(ROOT, "public", "data");
/** True while `next build` runs (prerendering); false at request time. */
export const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";
