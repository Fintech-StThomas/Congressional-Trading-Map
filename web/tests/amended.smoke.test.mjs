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
  const found = { link: false, deleted: false, corrected: false, unmatched: false, marked: false };
  const scroller = table.locator(".vtable");
  for (let y = 0; y < 9000 && !(found.link && found.deleted && found.corrected && found.unmatched && found.marked); y += 450) {
    await scroller.evaluate((el, top) => el.scrollTo({ top }), y);
    if ((await table.locator("tr.is-notcounted").count()) > 0) found.marked = true;
    const txt = await table.locator("td.trades__later").allInnerTexts();
    for (const s of txt) {
      if (/later filing \d{1,2} \w{3} 20\d\d/.test(s)) found.link = true;
      if (s.includes("A later filing marks this transaction deleted; listed, not counted")) found.deleted = true;
      if (s.includes("amended; the original report was not identified, so days to public are not given")) found.unmatched = true;
      if (s.includes("date corrected by a later filing")) found.corrected = true;
    }
  }
  assert.deepEqual(found, { link: true, deleted: true, corrected: true, unmatched: true, marked: true });
  const href = await table.locator("td.trades__later a").first().getAttribute("href");
  assert.match(href, /^https:\/\/example\.org\/sample-record\/ptr\/SAMPAMD0\d\.pdf$/);
  const lag = await table.locator("td.num .nd", { hasText: "corrected" }).first().innerText();
  assert.equal(lag, "corrected");
  const timing = await p.getByTestId("trades-timing").innerText();
  assert.match(timing, /with a date corrected by a later filing/);
  assert.match(timing, /1 amended with the original report not identified \(days not given\)/);
  const count = await table.locator(".filters__count").innerText();
  assert.match(count, /186 trades/, "the listed-only deleted row is not in the count");
  assert.match(count, /1 more listed, not counted/);
  const short = await table.locator("td.num .nd", { hasText: "amended" }).first().innerText();
  assert.equal(short, "amended");
  assert.match(await table.locator("td.num .nd", { hasText: "amended" }).first().getAttribute("title"), /original report was not identified, so days to public are not given/);
  const lateChip = await table.locator("tr.is-notcounted .late").count();
  assert.equal(lateChip, 0, "no over-45 mark on a not-counted row");
  await p.close();
});

test("/delays: the date-corrected row, the file's own caveats, no hard-coded amended sentence", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/delays");
  const body = await p.locator("main").innerText();
  assert.match(body, /Date corrected by a later filing/);
  assert.match(body, /Amended, original not matched/);
  assert.match(body, /A trade that a later House filing marks Deleted is listed on the member's page and is not counted here/);
  assert.match(body, /A later filing corrected the transaction date, so elapsed days are not computed/);
  assert.match(body, /Each trade is counted once, from the earliest date it was public/);
  assert.doesNotMatch(body, /Amended reports may carry the amendment/);
  assert.doesNotMatch(body, /\blate\b/i, "no 'late' wording on the page");
  const caveats = await p.locator(".dl-list li").count();
  assert.equal(caveats, 10, "the ten caveats come from delays.json");
  await p.close();
});

test("/method: kept rows are labelled kept and counted, not excluded; the amended sentence matches what is done", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/method");
  const kept = await p.getByTestId("method-kept").innerText();
  assert.match(kept, /Kept in the data \(not excluded\)/);
  assert.match(kept, /rows = kept, not excluded/);
  assert.match(kept, /rows a later filing marks Deleted; kept and listed, not counted/i);
  const body = await p.locator("main").innerText();
  assert.match(body, /counted once, timed from its first filing/);
  assert.match(body, /stays a separate trade; as its original is not identified, its days to public are withheld and counted apart/);
  assert.match(body, /listed and marked but is not counted anywhere/);
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

test("a member with no counted trade and one listed-only row still lists it, on the member page and in the full file", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000011");
  const table = p.getByTestId("trades-table");
  await table.waitFor();
  assert.equal(await table.locator("tr.is-notcounted").count(), 1, "the listed-only row is shown, marked");
  assert.match(await table.locator("td.trades__later").first().innerText(), /listed, not counted/);
  assert.match(await table.locator(".filters__count").innerText(), /0 trades.*1 more listed, not counted/);
  await p.close();
  const r = await open("/m/X000011/records");
  const rec = r.getByTestId("rec-trades");
  await rec.waitFor();
  const text = await rec.innerText();
  assert.match(text, /Deleted by a later filing/, "the reason is in plain words, never the raw key");
  assert.doesNotMatch(text, /deleted_by_later_filing|amended_unmatched/);
  assert.match(await r.getByTestId("rec-trades-count").innerText(), /1 more listed, not counted/);
  await r.close();
});
