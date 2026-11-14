#!/usr/bin/env node
// Visual regression check: capture a fixed set of pages, or compare two captures pixel by pixel.
//   node scripts/visual-snapshots.mjs capture <outDir> [baseUrl]     (server must be running, e.g. :3100)
//   node scripts/visual-snapshots.mjs compare <beforeDir> <afterDir>  (prints differing pixels per shot)
// Animations are settled by waiting after load; reduced motion is not forced, so the page renders as users see it.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [mode, a, b] = process.argv.slice(2);

const MEMBER = "K000389"; // a current member with cases, trades and a "Spent against" zone
const ORG = "co:732717";

/** [name, path, width, height, prepare?] */
const SHOTS = [
  ["home-board", "/", 1440, 900],
  ["member-board", `/?m=${MEMBER}`, 1440, 900],
  ["member-board-drawer", `/?m=${MEMBER}`, 1440, 900, async (p) => {
    await p.locator(".bcard__open").first().click();
    await p.getByTestId("evidence-drawer").waitFor();
  }],
  ["board-table", `/?m=${MEMBER}`, 1440, 900, (p) => p.getByRole("button", { name: "View as table" }).click()],
  ["wall-all", "/wall", 1440, 900],
  ["wall-2012", "/wall?y=2012", 1440, 900],
  ["org", `/o/${encodeURIComponent(ORG)}`, 1440, 900],
  ["orgs", "/orgs", 1440, 900],
  ["member-page", `/m/${MEMBER}`, 1440, 900],
  ["member-page-full", `/m/${MEMBER}`, 1440, 900, null, true],
  ["records", `/m/${MEMBER}/records`, 1440, 900, (p) => p.getByTestId("records-ready").waitFor({ timeout: 60000 })],
  ["cases", "/cases", 1440, 900],
  ["method", "/method", 1440, 900, null, true],
  ["phone-home", "/", 390, 844],
  ["phone-member-board", `/?m=${MEMBER}`, 390, 844],
  ["phone-member-page", `/m/${MEMBER}`, 390, 844],
  ["phone-wall", "/wall", 390, 844],
  ["phone-org", `/o/${encodeURIComponent(ORG)}`, 390, 844],
  ["phone-records", `/m/${MEMBER}/records`, 390, 844, (p) => p.getByTestId("records-ready").waitFor({ timeout: 60000 })],
];

async function capture(outDir, base = "http://localhost:3100") {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, path, width, height, prep, full] of SHOTS) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500); // the yarn draws in, sways and settles in under 2 s
    if (prep) {
      await prep(page);
      await page.waitForTimeout(1200);
    }
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: Boolean(full) });
    console.log(name, errors.length ? `page errors: ${errors.slice(0, 2).join(" | ")}` : "ok");
    await page.close();
  }
  await browser.close();
}

async function compare(before, after) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = [];
  for (const f of readdirSync(before).filter((x) => x.endsWith(".png")).sort()) {
    if (!existsSync(join(after, f))) {
      report.push(`${f}: missing after`);
      continue;
    }
    const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
    const r = await page.evaluate(async ([x, y]) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [p, q] = await Promise.all([load(x), load(y)]);
      if (p.width !== q.width || p.height !== q.height) return { size: `${p.width}x${p.height} vs ${q.width}x${q.height}` };
      const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
      const d1 = px(p), d2 = px(q);
      let diff = 0, minY = Infinity, maxY = -1;
      for (let i = 0; i < d1.length; i += 4) {
        if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 24) {
          diff++;
          const yy = Math.floor(i / 4 / p.width);
          minY = Math.min(minY, yy); maxY = Math.max(maxY, yy);
        }
      }
      return { diff, total: d1.length / 4, rows: diff ? [minY, maxY] : null };
    }, [uri(join(before, f)), uri(join(after, f))]);
    report.push(r.size ? `${f}: size changed ${r.size}` : `${f}: ${r.diff} of ${r.total} px differ${r.rows ? ` (rows ${r.rows[0]}-${r.rows[1]})` : ""}`);
  }
  await browser.close();
  const text = report.join("\n");
  console.log(text);
  writeFileSync(join(after, "diff-report.txt"), text + "\n");
}

if (mode === "capture" && a) await capture(a, b);
else if (mode === "compare" && a && b) await compare(a, b);
else console.log("usage: capture <outDir> [baseUrl] | compare <beforeDir> <afterDir>");
