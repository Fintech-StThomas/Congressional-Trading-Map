// Smoke tests (packets P2 and P5) against the built sample site: an amended trade's later filing is linked, a Deleted
// mark is said plainly, a corrected date reads "corrected" (full wording in the new column), /delays has its date-corrected row and the file's
// caveats and /method separates kept rows from excluded ones. (The neutral mark for spending against a member is covered by
// the stringStyle unit test in precision.test.mjs and was checked on live data; the sample fixtures have no opposing edge.)
// Uses BASE_URL when set; otherwise starts `next start` on port 3129. Skips on a real-data build.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

let base = process.env.BASE_URL;
let server;
let browser;
let realData = false;
const SAMPLE_ONLY = "needs the sample fixtures (amended rows on member X000001)";

before(async () => {
  if (!base) {
    base = "http://localhost:3129";
    server = spawn("npx", ["next", "start", "-p", "3129"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  realData = await fetch(base + "/data/meta.json").then((r) => (r.ok ? r.json() : null)).then((m) => Boolean(m && m.publication_budget)).catch(() => false);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server?.pid) try { process.kill(-server.pid); } catch {}
});

async function open(path, width = 1280) {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  p.on("pageerror", (e) => { throw e; });
  await p.goto(base + path);
  return p;
}

test("trades table: later filings are linked, Deleted is said plainly, a corrected date reads as such", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001");
  const table = p.getByTestId("trades-table");
  await table.waitFor();
  await p.getByTestId("trades-timing").waitFor();
  await p.waitForFunction(() => /\d+ trades? ·/.test(document.querySelector('[data-testid="trades-table"] .filters__count')?.textContent ?? ""));
  // Show every row at once: filter to the amended trades by sorting is not offered, so read the whole windowed list through the DOM after scrolling.
  const found = { link: false, deleted: false, corrected: false };
  const scroller = table.locator(".vtable");
  for (let y = 0; y < 9000 && !(found.link && found.deleted && found.corrected); y += 450) {
    await scroller.evaluate((el, top) => el.scrollTo({ top }), y);
    const txt = await table.locator("td.trades__later").allInnerTexts();
    for (const s of txt) {
      if (/later filing \d{1,2} \w{3} 20\d\d/.test(s)) found.link = true;
      if (s.includes("a later filing marks this transaction deleted")) found.deleted = true;
      if (s.includes("date corrected by a later filing")) found.corrected = true;
    }
  }
  assert.deepEqual(found, { link: true, deleted: true, corrected: true });
  const href = await table.locator("td.trades__later a").first().getAttribute("href");
  assert.match(href, /^https:\/\/example\.org\/sample-record\/ptr\/SAMPAMD0\d\.pdf$/);
  const lag = await table.locator("td.num .nd", { hasText: "corrected" }).first().innerText();
  assert.equal(lag, "corrected");
  assert.match(await p.getByTestId("trades-timing").innerText(), /with a date corrected by a later filing/);
  await p.close();
});

test("/delays: the date-corrected row, the file's own caveats, no hard-coded amended sentence", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/delays");
  const body = await p.locator("main").innerText();
  assert.match(body, /Date corrected by a later filing/);
  assert.match(body, /A later filing corrected the transaction date, so elapsed days are not computed/);
  assert.match(body, /Each trade is counted once, from the earliest date it was public/);
  assert.doesNotMatch(body, /Amended reports may carry the amendment/);
  assert.doesNotMatch(body, /\blate\b/i, "no 'late' wording on the page");
  const caveats = await p.locator(".dl-list li").count();
  assert.equal(caveats, 8, "the eight caveats come from delays.json");
  await p.close();
});

test("/method: kept rows are labelled kept and counted, not excluded; the amended sentence matches what is done", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/method");
  const kept = await p.getByTestId("method-kept").innerText();
  assert.match(kept, /Kept and counted \(not excluded\)/);
  assert.match(kept, /rows = kept, not excluded/);
  const body = await p.locator("main").innerText();
  assert.match(body, /counted once, timed from its first filing/);
  assert.match(body, /stays a separate trade, timed from the amending filing/);
  assert.doesNotMatch(body, /filed late|\blate-filed\b/i);
  await p.close();
});

test("trades table at 390 px keeps the later-filings column reachable (the table scrolls sideways inside its box, the page does not)", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001", 390);
  await p.getByTestId("trades-table").waitFor();
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(wide, false, "no sideways page scroll");
  await p.close();
});
