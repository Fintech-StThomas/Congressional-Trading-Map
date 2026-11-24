// Smoke tests for "Money in and out, as summarised by the FEC" on a leadership PAC panel, the full file's table and the printed case
// file, against the built sample site (fixtures from scripts/fixture-finance.mjs). Uses BASE_URL when set; otherwise starts `next start` on
// port 3132. Skipped on a real-data build. X000001: C00900001 has totals in 2022 and 2024 (2024 with cash on hand and other disbursements
// not reported); C00900002 has totals null in 2022 and no `totals` field at all in 2024, like a file built before totals existed.
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
const SAMPLE_ONLY = "needs the sample fixtures (member X000001)";

before(async () => {
  if (!base) {
    base = "http://localhost:3132";
    server = spawn("npx", ["next", "start", "-p", "3132"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
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

async function page(width = 1440, height = 900) {
  const p = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  p.on("pageerror", (e) => { throw e; });
  return p;
}

test("totals: the block leads the panel with figures, 'through' date, FEC link and the reconciliation line", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const first = p.getByTestId("fin-pac").first();
  const box = first.getByTestId("fin-totals");
  assert.match(await box.innerText(), /Money in and out, as summarised by the FEC/);
  assert.match(await box.getByTestId("fin-totals-receipts").innerText(), /\$512,300/);
  assert.match(await box.getByTestId("fin-totals-disbursements").innerText(), /\$411,500/);
  assert.match(await box.getByTestId("fin-totals-contributions").innerText(), /\$100,000/);
  assert.match(await box.getByTestId("fin-totals-operating").innerText(), /\$300,000/);
  assert.match(await box.getByTestId("fin-totals-cash").innerText(), /not reported/, "a null figure is not reported, never $0");
  assert.equal((await box.getByTestId("fin-totals-through").innerText()).split("·")[0].trim(), "through 16 Oct 2024");
  const href = await box.getByTestId("fin-totals-through").locator("a").getAttribute("href");
  assert.match(href, /C00900001/);
  assert.match(await box.getByTestId("fin-totals-reconcile").innerText(), /purpose groups below cover the committee's disbursements/);
  const order = await first.evaluate((el) => {
    const a = el.querySelector('[data-testid="fin-totals"]'), b = el.querySelector('[data-testid="fin-purposes"]');
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, "totals come before the purpose groups");
  await first.getByTestId("fin-cycle").selectOption("2022");
  assert.match(await first.getByTestId("fin-totals-cash").innerText(), /\$86,000/);
  assert.equal((await first.getByTestId("fin-totals-through").innerText()).split("·")[0].trim(), "through 31 Dec 2022");
  const red = await p.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--red)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const colours = await first.getByTestId("fin-totals").locator("*").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  assert.ok(colours.every((c) => c !== red), "no red in the block");
  await p.close();
});

test("totals: null says not reported; a year from an old file (no field) shows no block", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const second = p.getByTestId("fin-pac").nth(1);
  assert.equal(await second.getByTestId("fin-totals").count(), 0, "2024 has no totals field: rendered as before");
  assert.equal(await second.getByTestId("fin-purposes").count(), 1);
  await second.getByTestId("fin-cycle").selectOption("2022");
  assert.match(await second.getByTestId("fin-totals-unavailable").innerText(), /^Not reported: the FEC's committee summary is not available/);
  assert.doesNotMatch(await second.getByTestId("fin-totals").innerText(), /\$0\b/);
  await p.close();
});

test("totals: the full file has the table with CSV and a citation; the case file prints one line per PAC", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.ok(await p.getByTestId("rec-totals").count());
  assert.match(await p.getByTestId("rec-totals-count").innerText(), /^3 rows$/, "two cycles of C00900001 and the null 2022 year; the old-file year adds none");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-totals-csv").click()]);
  assert.match(dl.suggestedFilename(), /X000001-leadership-pac-totals\.csv$/);
  assert.ok(await p.getByTestId("cite-totals").count());
  await p.goto(base + "/m/X000001");
  const lines = p.getByTestId("cf-totals");
  assert.equal(await lines.count(), 1, "only the PAC whose latest cycle has totals");
  assert.match(await lines.first().innerText(), /FEC committee summary through 16 Oct 2024: receipts \$512,300; disbursements \$411,500;.*cash on hand not reported\./);
  await p.close();
});

test("totals: no sideways scroll at phone width", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(390, 844);
  await p.goto(base + "/m/X000001");
  await p.getByTestId("campaign-money").waitFor();
  assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await p.close();
});
