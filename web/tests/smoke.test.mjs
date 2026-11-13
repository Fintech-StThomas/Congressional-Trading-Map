// Smoke tests against the built site. Run `npm run build` first, then `npm test`.
// Uses BASE_URL when set; otherwise starts `next start` on port 3123 itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

let base = process.env.BASE_URL;
let server;
let browser;

async function up(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start at ${url}`);
}

before(async () => {
  if (!base) {
    base = "http://localhost:3123";
    server = spawn("npx", ["next", "start", "-p", "3123"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
    await up(base);
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function page(width = 1440, height = 900) {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on("pageerror", (e) => {
    throw e;
  });
  return p;
}

test("board loads with the map and a featured example", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".usmap__state");
  assert.ok((await p.locator(".usmap__state").count()) >= 50);
  await p.waitForSelector(".yarn", { timeout: 10000, state: "attached" });
  assert.match(await p.locator(".slip").first().innerText(), /Featured example/i);
  await p.close();
});

test("selecting a state and a member draws strings", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".usmap__state");
  await p.getByRole("button", { name: "United States" }).click();
  const state = p.locator(".usmap__state[tabindex='0']").first();
  await state.focus();
  await p.keyboard.press("Enter");
  await p.waitForSelector("[data-testid=delegation] .pick");
  await p.locator("[data-testid=delegation] .pick").first().click();
  await p.waitForSelector(".yarn", { timeout: 10000, state: "attached" });
  assert.ok((await p.locator(".yarn").count()) > 0);
  await p.close();
});

test("a string opens the evidence drawer with links to records", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".yarn", { timeout: 10000, state: "attached" });
  await p.locator(".yarn").first().focus();
  await p.keyboard.press("Enter");
  const drawer = p.getByTestId("evidence-drawer");
  await drawer.waitFor();
  assert.match(await drawer.innerText(), /A tie is not a finding/);
  assert.ok((await drawer.locator(".evidence__link, .evidence__nolink").count()) > 0);
  await p.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  await p.close();
});

test("a card opens its evidence, and its separate control re-centres the board", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".bcard__open");
  await p.locator(".bcard__open").first().click();
  const drawer = p.getByTestId("evidence-drawer");
  await drawer.waitFor();
  assert.match(await drawer.innerText(), /A tie is not a finding/);
  await p.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  await p.locator(".bcard__recentre").first().click();
  await p.waitForURL(/[?&](m|o)=/);
  await p.close();
});

test("table view lists the same ties", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".yarn", { timeout: 10000, state: "attached" });
  const strings = await p.locator(".yarn").count();
  await p.getByRole("button", { name: "View as table" }).click();
  await p.waitForSelector(".stage__table table.ties");
  const rows = await p.locator(".stage__table table.ties tbody tr:not(.ties__group)").count();
  assert.equal(rows, strings);
  await p.close();
});

test("member page renders ties and the trades table", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.waitForSelector(".slip a");
  await p.locator(".stage__board .slip a", { hasText: "Open case file" }).click();
  await p.getByTestId("member-page").waitFor();
  const trades = p.getByTestId("trades-table");
  if (await trades.count()) {
    await trades.locator("tbody tr").first().waitFor();
    assert.ok((await trades.locator("tbody tr:not(.vspacer)").count()) > 0);
  }
  assert.ok((await p.locator("table.ties tbody tr").count()) > 0);
  await p.close();
});

test("phone width shows the table layout without horizontal scroll", async () => {
  const p = await page(390, 844);
  await p.goto(base + "/");
  await p.waitForSelector(".stage__table table.ties", { timeout: 10000 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  await p.close();
});

test("the wall renders prints, switches markers and opens the board", async () => {
  const p = await page();
  await p.goto(base + "/wall");
  await p.waitForSelector("[data-testid=wall] .wall__print");
  const prints = await p.locator(".wall__band--sm .wall__print").count();
  assert.ok(prints > 400, `only ${prints} prints`);
  assert.match(await p.getByTestId("wall-sum-D").innerText(), /members · .* cases · \$/);
  const widths = () => p.locator(".wall__band--sm .wall__marker span").evaluateAll((els) => els.map((e) => e.style.width).join());
  const before = await widths();
  await p.getByRole("radio", { name: "PAC dollars received" }).check();
  await p.waitForSelector("[data-testid=wall][data-measure=pac]");
  assert.notEqual(await widths(), before);
  const first = p.locator(".wall__band--sm .wall__print").first();
  await first.hover();
  await p.getByRole("tooltip").waitFor();
  const href = await first.getAttribute("href");
  assert.match(href, /^\/\?(s=[A-Z]{2}&)?m=[A-Z]\d{6}$/);
  await first.click();
  await p.waitForURL((u) => u.pathname === "/" && u.searchParams.has("m"));
  await p.close();
});

test("organisations page lists both rankings with split bars", async () => {
  const p = await page();
  await p.goto(base + "/orgs");
  await p.waitForSelector("[data-testid=orgs-reach] .orgs__row");
  assert.ok((await p.locator("[data-testid=orgs-dollars] .orgs__row").count()) >= 20);
  assert.ok((await p.locator("[data-testid=orgs-reach] .split__bar .seg").count()) > 20);
  await p.getByLabel("Find an organisation").fill("realtors");
  assert.match(await p.locator("[data-testid=orgs-reach] .orgs__row").first().innerText(), /REALTORS/);
  await p.close();
});

test("a large organisation shows its party split and reach", async () => {
  const p = await page();
  await p.goto(base + "/o/co%3A732717");
  const split = p.getByTestId("org-split");
  await split.waitFor({ timeout: 15000 });
  assert.match(await split.innerText(), /Gave to [\d,]+ Republicans, [\d,]+ Democrats and \d+ independents: \$/);
  assert.ok((await split.locator(".split__bar").count()) >= 3);
  const reach = p.getByTestId("org-reach");
  assert.ok((await reach.locator(".reach__print").count()) >= 20);
  await reach.locator("button.reach__print").first().click();
  await p.getByTestId("evidence-drawer").waitFor();
  await p.close();
});

test("wall and organisation pages do not scroll sideways at phone width", async () => {
  const p = await page(390, 844);
  for (const url of ["/wall", "/orgs", "/o/co%3A732717"]) {
    await p.goto(base + url, { waitUntil: "networkidle" });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${url} scrolls sideways by ${overflow}px`);
  }
  await p.close();
});
