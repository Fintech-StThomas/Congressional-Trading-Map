// Screenshots for the wall, the featured board, frayed yarn and the records view.
// node scripts/shots-wall.mjs http://localhost:3100 [only]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:3100";
const only = process.argv[3] ?? "";
const out = new URL("../.screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function shot(name, url, { w = 1440, h = 900, full = false, prep, scale = 1, clip } = {}) {
  if (only && !name.includes(only)) return;
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const hd = process.env.PT_HOLDINGS_DIR;
  if (hd) await p.route("**/holdings/*.json", (r) => {
    try { r.fulfill({ body: readFileSync(`${hd}/${r.request().url().split("/").pop()}`), contentType: "application/json" }); } catch { r.fulfill({ status: 404 }); }
  });
  await p.goto(base + url, { waitUntil: "networkidle" });
  if (prep) await prep(p);
  await p.waitForTimeout(600);
  const c = typeof clip === "function" ? await clip(p) : clip;
  await p.screenshot({ path: `${out}${name}.png`, fullPage: full, clip: c });
  console.log(`${out}${name}.png`);
  await p.close();
}

const year = (y) => async (p) => {
  await p.waitForSelector(`[data-testid=wall][data-year="${y}"]`, { timeout: 15000 });
};
await shot("wall-strip-1440", "/wall", { prep: async (p) => p.mouse.wheel(0, 500) });
await shot("wall-strip-390", "/wall", { w: 390, h: 844 });
await shot("wall-2008-1440", "/wall?y=2008&k=trades", { prep: year(2008) });
await shot("wall-2024-1440", "/wall?y=2024&k=pac", { prep: year(2024) });
await shot("wall-2008-390", "/wall?y=2008", { w: 390, h: 844, prep: year(2008) });
await shot("wall-2024-390", "/wall?y=2024&k=trades", { w: 390, h: 844, prep: year(2024) });
await shot("wall-state-popover-1440", "/wall", {
  prep: async (p) => {
    await p.getByRole("button", { name: /State/ }).click();
    await p.keyboard.type("new");
  },
  clip: { x: 0, y: 0, width: 1440, height: 520 },
});
await shot("featured-1440", "/", { prep: async (p) => p.waitForSelector(".yarn", { state: "attached", timeout: 15000 }) });
await shot("featured-390", "/", { w: 390, h: 844 });

// Frayed strings: find the first frayed yarn on the featured board and zoom on it.
const fray = (pad) => async (p) => {
  await p.waitForSelector(".yv--frayed", { state: "attached", timeout: 15000 });
  await p.waitForTimeout(2500);
  const boxes = await p.locator(".yv--frayed").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const b = boxes.sort((a, c) => Math.hypot(c.width, c.height) - Math.hypot(a.width, a.height))[0];
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(b.width + pad * 2, 900), height: Math.min(b.height + pad * 2, 600) };
};
const frayUrl = process.env.FRAY_URL ?? "/?s=PA&m=K000376";
await shot("frayed-normal-1440", frayUrl, { clip: fray(40) });
await shot("frayed-closeup-2x", frayUrl, { scale: 2, clip: fray(12) });
await shot("frayed-closeup-4x", frayUrl, { scale: 4, clip: fray(8) });
await shot("records-1440", "/m/K000389/records", { prep: async (p) => p.waitForSelector("[data-testid=records-ready]", { timeout: 30000 }) });
await shot("records-390", "/m/K000389/records", { w: 390, h: 844, prep: async (p) => p.waitForSelector("[data-testid=records-ready]", { timeout: 30000 }) });
await shot("holdings-member-1440", "/m/P000197", { full: false, prep: async (p) => { await p.getByTestId("holdings").scrollIntoViewIfNeeded(); await p.evaluate(() => document.querySelector("[data-testid=holdings]").scrollIntoView()); } });
await shot("holdings-records-1440", "/m/P000197/records#rec-holdings", { prep: async (p) => { await p.waitForSelector("[data-testid=records-ready]", { timeout: 30000 }); await p.evaluate(() => document.querySelector("#rec-holdings").scrollIntoView()); } });
await shot("member-assume-1440", "/m/K000389?as=own", { prep: async (p) => { await p.waitForFunction(() => /trades count/.test(document.querySelector("[data-testid=assume-line]")?.textContent ?? ""), null, { timeout: 60000 }); } });
await shot("board-assume-1440", "/?s=CA&m=K000389&as=own", { prep: async (p) => { await p.waitForFunction(() => /trades count/.test(document.querySelector("[data-testid=assume-line]")?.textContent ?? ""), null, { timeout: 60000 }); await p.waitForTimeout(1500); } });
await browser.close();
