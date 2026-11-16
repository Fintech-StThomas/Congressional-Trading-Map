// Which dataset the build uses. Same rule as scripts/resolve-data.mjs.
//   PT_DATA=fixtures -> always the fixtures
//   PT_DATA=real     -> public/data whenever members.json exists
//   unset            -> public/data only when it is a current-contract build
//                       (meta.json carries publication_budget), else fixtures
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function isRealDataBuild(root: string = process.cwd()): boolean {
  const mode = process.env.PT_DATA;
  if (mode === "fixtures") return false;
  const dir = join(root, "public", "data");
  if (!existsSync(/*turbopackIgnore: true*/ join(dir, "members.json"))) return false;
  if (mode === "real") return true;
  try {
    const meta = JSON.parse(readFileSync(/*turbopackIgnore: true*/ join(dir, "meta.json"), "utf8"));
    return Boolean(meta && meta.publication_budget);
  } catch {
    return false;
  }
}

/**
 * Guard against a hosted build silently publishing the sample site. On Vercel or CI (VERCEL or CI set), a build
 * with neither DATA_BASE_URL nor RELEASE_BASE_URL nor a real local build would fall back to the fixtures; that is refused unless
 * PT_DATA=fixtures asks for them explicitly. Returns the error message, or null when the build may go ahead.
 * Local builds (neither variable set) keep the fixtures fallback.
 */
export function sampleFallbackError(env: Record<string, string | undefined>, hasRealData: boolean): string | null {
  const hosted = Boolean(env.VERCEL || env.CI);
  if (!hosted || hasRealData || (env.DATA_BASE_URL ?? "").trim() || (env.RELEASE_BASE_URL ?? "").trim() || env.PT_DATA === "fixtures") return null;
  return (
    `[data] refusing to build the SAMPLE site on ${env.VERCEL ? "Vercel" : "CI"}: neither DATA_BASE_URL nor RELEASE_BASE_URL is set and ` +
    "web/public/data holds no real build. Set DATA_BASE_URL to the published data " +
    "(https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data), or set PT_DATA=fixtures to build the sample site on purpose."
  );
}
