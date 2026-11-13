// Which dataset the build uses. Same rule as scripts/resolve-data.mjs.
//   PT_DATA=fixtures -> always the fixtures
//   PT_DATA=real     -> public/data whenever members.json exists
//   unset            -> public/data only when it is a current-contract build
//                       (meta.json carries publication_budget), else fixtures
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function useRealData(root: string = process.cwd()): boolean {
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
