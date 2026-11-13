// Screenshots of the wall, two organisation pages and /orgs at desktop and phone widths.
// node scripts/shots-reach.mjs http://localhost:3200
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = process.argv[2] || "http://localhost:3200";
const out = path.join(__dirname, "..", ".screenshots");
const pages = [
  ["wall", "/wall", ".wall__print"],
  ["org-att", "/o/co%3A732717", "[data-testid=org-reach]"],
  ["org-abc", "/o/pac%3AC00010421", "[data-testid=org-reach]"],
  ["orgs", "/orgs", ".orgs__row"],
];

(async () => {
  const browser = await chromium.launch();
  for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    for (const [name, url, sel] of pages) {
      await p.goto(base + url, { waitUntil: "networkidle" });
      try {
        await p.waitForSelector(sel, { timeout: 15000 });
      } catch {
        await p.screenshot({ path: path.join(out, `${name}-FAILED-${tag}.png`) });
        console.log(`missing ${sel} on ${name} ${tag}`);
        continue;
      }
      if (name.startsWith("org-")) {
        await p.locator("[data-testid=org-split]").screenshot({ path: path.join(out, `${name}-split-${tag}.png`) });
      }
      await p.waitForTimeout(400);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w) console.log(`horizontal overflow on ${name} ${tag}: ${sw}`);
      if (name.startsWith("org-")) {
        await p.locator("[data-testid=org-split]").scrollIntoViewIfNeeded();
        await p.locator(".reach__print").nth(4).hover();
        await p.waitForTimeout(200);
      }
      await p.screenshot({ path: path.join(out, `${name}-${tag}.png`), fullPage: name !== "wall" || tag === "phone" ? false : false });
      if (name.startsWith("org-")) {
        await p.locator("[data-testid=org-reach]").screenshot({ path: path.join(out, `${name}-reach-${tag}.png`) });
      }
      if (name === "wall") {
        await p.locator(".wall__print").nth(30).hover();
        await p.screenshot({ path: path.join(out, `${name}-hover-${tag}.png`) });
      }
    }
    await p.close();
  }
  await browser.close();
})();
