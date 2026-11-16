// `npm run test:unit`: every tests/*.test.mjs except the Playwright smoke tests, so CI (and anyone without a
// browser or a running site) can run the pure-logic tests alone. `npm test` still runs everything.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.mjs") && !f.endsWith("smoke.test.mjs"))
  .sort()
  .map((f) => `tests/${f}`);
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
