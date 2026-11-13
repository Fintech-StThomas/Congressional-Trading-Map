#!/usr/bin/env node
// Drives the built site and saves screenshots to .screenshots/.
// Usage: npm run build && npx next start -p 3100 & node scripts/screenshots.mjs [baseUrl] [member12] [member2]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:3100";
const m12 = process.argv[3];
const m2 = process.argv[4];
const out = new URL("../.screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
async function shoot(name, width, height, fn) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fn(page);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: false });
  if (errors.length) console.log(name, "page errors:", errors.slice(0, 3));
  else console.log(name, "ok");
  await page.close();
}

await shoot("01-board-featured-desktop", 1440, 900, (p) => p.goto(base + "/"));
if (m12) await shoot("02-board-member12-desktop", 1440, 900, (p) => p.goto(`${base}/?m=${m12}`));
if (m2) await shoot("03-board-member2-desktop", 1440, 900, (p) => p.goto(`${base}/?m=${m2}`));
await shoot("04-board-drawer-desktop", 1440, 900, async (p) => {
  await p.goto(base + "/");
  await p.waitForSelector(".yarn", { timeout: 8000 });
  await p.waitForTimeout(1500);
  await p.locator(".yarn").first().focus();
  await p.keyboard.press("Enter");
});
await shoot("05-board-state-desktop", 1440, 900, (p) => p.goto(`${base}/?s=CA`));
await shoot("06-board-table-desktop", 1440, 900, async (p) => {
  await p.goto(base + "/");
  await p.getByRole("button", { name: "View as table" }).click();
});
await shoot("07-member-desktop", 1440, 900, (p) => p.goto(`${base}/m/${m12 ?? ""}`));
await shoot("08-member-trades-desktop", 1440, 900, async (p) => {
  await p.goto(`${base}/m/${m12 ?? ""}`);
  await p.locator("#trades-h").scrollIntoViewIfNeeded();
});
await shoot("09-cases-desktop", 1440, 900, (p) => p.goto(base + "/cases"));
await shoot("10-method-desktop", 1440, 900, (p) => p.goto(base + "/method"));
await shoot("14-org-desktop", 1440, 900, (p) => p.goto(`${base}/o/${encodeURIComponent("co:789019")}`));
await shoot("15-board-org-desktop", 1440, 900, (p) => p.goto(`${base}/?o=${encodeURIComponent("co:789019")}`));
await shoot("11-board-phone", 390, 844, (p) => p.goto(base + "/"));
await shoot("12-member-phone", 390, 844, (p) => p.goto(`${base}/m/${m12 ?? ""}`));
await shoot("13-drawer-phone", 390, 844, async (p) => {
  await p.goto(base + "/");
  await p.getByRole("button", { name: /^Evidence/ }).first().click();
});
await browser.close();
