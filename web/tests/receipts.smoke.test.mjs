// Smoke tests for "Campaign receipts, as summarised by the FEC" on the member page, the full file and the printed case file,
// against the built sample site (X000008: five cycles with blanks, a presidential row and a negative cash balance; X000003: two
// cycles; X000001: leadership PAC only, no receipts; X000012: no block). Uses BASE_URL when set, otherwise starts `next start`
// on port 3131. Skips on a real-data build.
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
const SAMPLE_ONLY = "needs the sample fixtures (members X000001, X000003, X000004, X000008, X000012)";

before(async () => {
  if (!base) {
    base = "http://localhost:3131";
    server = spawn("npx", ["next", "start", "-p", "3131"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
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

async function page(width = 1280, height = 900) {
  const p = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  p.on("pageerror", (e) => { throw e; });
  return p;
}

test("receipts: newest cycles first, folded to three, 'not reported' for a blank, FEC link, the not-ties note, no red", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000008");
  const sec = p.getByTestId("fin-receipts");
  await sec.waitFor();
  const text = await p.getByTestId("campaign-money").innerText();
  assert.match(text, /Campaign receipts, as summarised by the FEC/);
  assert.match(text, /not ties/);
  assert.match(text, /Individual contributors are never published/);
  const rows = p.getByTestId("fin-receipt-row");
  assert.equal(await rows.count(), 3);
  assert.match(await rows.first().innerText(), /2024[\s\S]*\$2,600,000[\s\S]*\$1,800,000[\s\S]*\$450,000[\s\S]*\$520,000[\s\S]*2024-11-25/);
  await p.getByTestId("fin-receipts-fold").click();
  assert.equal(await rows.count(), 5);
  const all = await sec.innerText();
  assert.match(all, /not reported/, "the 2018 other-committees figure is blank");
  assert.match(all, /-\$2,501/, "a negative cash balance is shown as filed");
  assert.match(all, /President/, "the presidential row is labelled when a member has two candidate ids");
  const links = p.getByTestId("fin-receipts-links").locator("a");
  assert.equal(await links.count(), 2);
  assert.equal(await links.first().getAttribute("href"), "https://www.fec.gov/data/candidate/H0SAMPLE008/");
  const red = await p.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--red)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const colours = await sec.locator("th, td, a").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  assert.ok(colours.every((c) => c !== red), "no red in the receipts table");
  await p.close();
});

test("receipts: a member with loans and no receipts rows says so; no block reads as before", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000001");
  assert.match(await p.getByTestId("fin-receipts-none").innerText(), /No FEC receipts summary/);
  assert.equal(await p.getByTestId("fin-receipt-row").count(), 0);
  await p.goto(base + "/m/X000012");
  assert.equal(await p.getByTestId("fin-receipts").count(), 0);
  assert.equal(await p.getByTestId("fin-none").count(), 1);
  await p.close();
});

test("receipts: the full file has the table with CSV and citation", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000003/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.match(await p.getByTestId("rec-receipts-count").innerText(), /^2 rows$/);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-receipts-csv").click()]);
  assert.match(dl.suggestedFilename(), /X000003-campaign-receipts\.csv$/);
  assert.ok(await p.getByTestId("cite-receipts").count());
  await p.close();
});

test("receipts: the printed case file carries a compact line for the latest cycle; no sideways scroll at phone width", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(390, 844);
  await p.goto(base + "/m/X000003");
  const line = p.getByTestId("cf-receipts");
  assert.equal(await line.count(), 1);
  const txt = await line.innerText();
  assert.match(txt, /2024 cycle, as summarised by the FEC/);
  assert.match(txt, /total receipts \$720,000/);
  assert.match(txt, /not ties/);
  assert.doesNotMatch(txt, /2022/);
  for (const id of ["X000003", "X000008", "X000001"]) {
    await p.goto(base + `/m/${id}`);
    await p.getByTestId("campaign-money").waitFor();
    assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${id} scrolls sideways`);
  }
  await p.close();
});

test("old-shape file (X000004: no receipts, no totals): no receipts or totals section, no false 'No FEC' line, no conduit sentence", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000004");
  assert.equal(await p.getByTestId("fin-receipts").count(), 0);
  assert.equal(await p.getByTestId("fin-receipts-none").count(), 0);
  assert.doesNotMatch(await p.getByTestId("campaign-money").innerText(), /receipts summary|Campaign receipts/i);
  const tables = (await p.locator(".cf__table").allTextContents()).join(" ");
  assert.match(tables, /Does not show what, if anything, the PAC expected/);
  assert.doesNotMatch(tables, /conduit|earmarked/i, "the sample build has no conduit_pass_through exclusion");
  await p.goto(base + "/m/X000004/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.ok(await p.getByTestId("rec-money").count());
  for (const id of ["receipts", "totals"]) {
    assert.equal(await p.getByTestId(`rec-${id}-count`).count(), 0, `no ${id} table`);
    assert.equal(await p.getByTestId(`rec-${id}-csv`).count(), 0, `no ${id} CSV`);
  }
  assert.doesNotMatch(await p.getByTestId("rec-money").innerText(), /receipts|FEC committee summary/i);
  await p.close();
});
