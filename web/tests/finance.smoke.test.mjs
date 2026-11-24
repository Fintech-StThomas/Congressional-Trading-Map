// Smoke tests for the member page's "Campaign money" section and the full file's finance tables, against the built
// site. Split out of smoke.test.mjs (file length cap). Uses BASE_URL when set; otherwise starts `next start` on port
// 3127 itself. These run on the sample fixtures and skip on a real-data build.
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
const SAMPLE_ONLY = "needs the sample fixtures (members X000001, X000003, X000008, X000012)";

before(async () => {
  if (!base) {
    base = "http://localhost:3127";
    server = spawn("npx", ["next", "start", "-p", "3127"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
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

// ---- Campaign money (FEC loans and leadership PAC spending), on the sample fixtures ----
// X000008: loans with a blank figure and a presidential row. X000001: leadership PACs with a no-category row and a
// category refunded more than spent. X000003: loans, no leadership PAC. X000012: no campaign summary at all.
test("campaign money: loans show 'not reported' for a blank figure and a presidential row, folded to the latest cycles", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000008");
  const sec = p.getByTestId("campaign-money");
  await sec.waitFor();
  assert.match(await p.getByTestId("section-index").innerText(), /Campaign money/);
  const rows = p.getByTestId("fin-loan-row");
  assert.equal(await rows.count(), 3, "the latest three cycles are visible");
  await p.getByTestId("fin-loans-fold").click();
  assert.equal(await rows.count(), 5);
  const text = await sec.innerText();
  assert.match(text, /not reported/);
  assert.match(text, /President/);
  assert.match(text, /does not show why it was made/);
  assert.match(await p.getByTestId("fin-coverage").innerText(), /Cycles loaded/);
  // No leadership PAC for this member: the coverage note is shown.
  assert.match(await p.getByTestId("fin-pac-none").innerText(), /no leadership PAC/i);
  await p.close();
});

test("campaign money: the no-category row comes first and refunds are their own column, in neutral colour", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const pacs = p.getByTestId("fin-pac");
  assert.equal(await pacs.count(), 2);
  const first = pacs.first();
  const firstRow = first.locator("ul.fin__bars:not(.fin__bars--purposes) > li").first();
  assert.equal(await firstRow.getAttribute("data-testid"), "fin-row-nocat");
  assert.match(await firstRow.innerText(), /No FEC category on the filing/);
  assert.match(await first.getByTestId("fin-nocat-line").innerText(), /of the spending carries no FEC category/);
  await first.getByTestId("explain-nocategory").click();
  assert.match(await first.getByTestId("explain-nocategory-text").innerText(), /most PAC spending without a category/);
  assert.equal(await first.getByTestId("fin-refunds").count(), 4, "one refunds figure per category row");
  // Travel (latest cycle): refunds $15,000 exceed the $9,000 spent and are not netted.
  assert.match(await first.innerText(), /\$15,000/);
  assert.match(await first.innerText(), /\$9,000/);
  // The committee id links to the FEC page.
  assert.ok(await first.locator('a[href="https://www.fec.gov/data/committee/C00900001/"]').count());
  // The cycle selector starts on the latest cycle and switches the breakdown.
  assert.equal(await first.getByTestId("fin-cycle").inputValue(), "2024");
  await first.getByTestId("fin-cycle").selectOption("2022");
  assert.match(await first.getByTestId("fin-pac-totals").innerText(), /\$200,000/);
  // Bars are never red.
  const fill = await first.locator(".fin__fill").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.ok(await first.getByTestId("fin-pac-totals").count(), "the operating-spending totals stay visible");
  const red = await p.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--red)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  assert.notEqual(fill, red);
  await p.close();
});

test("campaign money: a member without an FEC summary gets one line, not zeros", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000012");
  assert.equal((await p.getByTestId("fin-none").innerText()).trim(), "No FEC campaign summary for this member in the cycles loaded.");
  assert.equal(await p.getByTestId("fin-loans").count(), 0);
  // A member whose file has no such field reads the same way.
  await p.goto(base + "/m/X000002");
  assert.equal(await p.getByTestId("fin-none").count(), 1);
  await p.close();
});

test("campaign money: the full file has both tables with CSV and citations", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.ok(await p.getByTestId("rec-loans").count());
  assert.ok(await p.getByTestId("rec-pac").count());
  assert.ok(await p.getByTestId("rec-purposes").count(), "the third table: FEC purpose groups");
  assert.match(await p.getByTestId("rec-purposes-count").innerText(), /^\d+ rows$/);
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-purposes-csv").click()]);
  assert.match(dl2.suggestedFilename(), /X000001-fec-purpose-groups\.csv$/);
  assert.ok(await p.getByTestId("cite-purposes").count());
  assert.match(await p.getByTestId("rec-pac-count").innerText(), /^\d+ rows$/);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-pac-csv").click()]);
  assert.match(dl.suggestedFilename(), /X000001-leadership-pac\.csv$/);
  assert.ok(await p.getByTestId("cite-pac").count());
  await p.goto(base + "/m/X000012/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.match(await p.getByTestId("rec-money-none").innerText(), /No FEC campaign summary/);
  await p.close();
});

test("campaign money: no sideways scroll at phone width, and the case file prints it", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(390, 844);
  for (const id of ["X000001", "X000008", "X000012"]) {
    await p.goto(base + `/m/${id}`);
    await p.getByTestId("campaign-money").waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${id}: page scrolls sideways by ${overflow}px`);
  }
  await p.goto(base + "/m/X000001");
  assert.ok(await p.getByTestId("cf-money").count(), "the printable case file carries the block");
  await p.close();
});

// ---- FEC purpose groups on the member page (X000001: C00900001 has groups, C00900002 has [] in 2022 and null in 2024) ----
test("campaign money: purpose groups come first with shares, REFUNDS as a group, and the sponsor link line", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const first = p.getByTestId("fin-pac").first();
  const box = first.getByTestId("fin-purposes");
  assert.match(await box.innerText(), /How the FEC groups this committee's spending/);
  assert.match(await box.innerText(), /can differ from the operating spending below/);
  // The purpose block sits above the operating-spending table.
  const order = await first.evaluate((el) => {
    const a = el.querySelector('[data-testid="fin-purposes"]'), b = el.querySelector('[data-testid="fin-opex"]');
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, "purpose groups come before the category table");
  const rows = box.getByTestId("fin-purpose-row");
  assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-purpose"))), ["OTHER", "CONTRIBUTIONS", "REFUNDS", "ADVERTISING", "ADMINISTRATIVE", "TRAVEL"]);
  const other = await rows.first().innerText();
  assert.match(other, /Other/);
  assert.match(other, /\$250,000/);
  assert.match(other, /of groups/);
  assert.match(other, /120 payments/);
  assert.match(await rows.nth(2).innerText(), /Refunds[\s\S]*\$19,500/);
  assert.match(await box.getByTestId("fin-purposes-refunds").innerText(), /refunds as their own group; nothing is subtracted/);
  assert.match(await first.getByTestId("fin-sponsor-link").innerText(), /^Linked by the FEC's sponsor candidate id; Linked by the FEC candidate id on the committee record$/);
  const second = p.getByTestId("fin-pac").nth(1);
  assert.match(await second.getByTestId("fin-sponsor-link").innerText(), /exact match/);
  await p.close();
});

test("campaign money: a null total reads not published; null and [] cycles say so; no red", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const first = p.getByTestId("fin-pac").first();
  await first.getByTestId("fin-cycle").selectOption("2022");
  const transfers = first.locator('[data-purpose="TRANSFERS"]');
  assert.match(await transfers.innerText(), /not published \(negative figure\)/);
  assert.doesNotMatch(await transfers.innerText(), /\$0\b/);
  const second = p.getByTestId("fin-pac").nth(1);
  assert.equal((await second.getByTestId("fin-purposes-unavailable").innerText()).trim(), "The FEC's groupings are not available for this cycle.");
  await second.getByTestId("fin-cycle").selectOption("2022");
  assert.equal((await second.getByTestId("fin-purposes-none").innerText()).trim(), "The FEC reported no groupings for this committee in this cycle.");
  const red = await p.evaluate(() => { const d = document.createElement("i"); d.style.color = "var(--red)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const fills = await p.locator(".fin__fill").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  assert.ok(fills.length > 0 && fills.every((f) => f !== red), "no bar is red");
  await p.close();
});

test("campaign money: the category table is folded when over 90% has no FEC category, and opens", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(1200, 900);
  await p.goto(base + "/m/X000001");
  const first = p.getByTestId("fin-pac").first();
  assert.equal(await first.getByTestId("fin-opex-fold").count(), 0, "80% uncategorised stays open");
  assert.match(await first.innerText(), /Operating spending by FEC category/);
  const second = p.getByTestId("fin-pac").nth(1);
  await second.getByTestId("fin-cycle").selectOption("2022");
  const fold = second.getByTestId("fin-opex-fold");
  assert.equal(await fold.getAttribute("open"), null);
  assert.equal(await second.getByTestId("fin-row-nocat").isVisible(), false);
  await fold.locator("summary").click();
  assert.equal(await second.getByTestId("fin-row-nocat").isVisible(), true);
  assert.match(await second.getByTestId("fin-row-nocat").innerText(), /No FEC category on the filing/);
  await p.close();
});

test("campaign money: purpose groups fit at phone width and print in the case file", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page(390, 844);
  await p.goto(base + "/m/X000001");
  await p.getByTestId("campaign-money").waitFor();
  assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const second = p.getByTestId("fin-pac").nth(1);
  await second.getByTestId("fin-cycle").selectOption("2022");
  assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const cf = p.getByTestId("cf-purposes");
  assert.equal(await cf.count(), 1, "only the PAC with groups in its latest cycle");
  assert.match(await cf.first().innerText(), /Refunds/);
  await p.close();
});
