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

test("wall by year: a year loads, members and summaries change, and 2008 trades say so in words", async () => {
  const p = await page();
  await p.goto(base + "/wall");
  await p.waitForSelector("[data-testid=wall] .wall__print");
  const allSum = await p.getByTestId("wall-sum-D").innerText();
  await p.getByRole("slider", { name: "Year" }).fill("2008");
  await p.waitForSelector('[data-testid=wall][data-year="2008"]', { timeout: 15000 });
  assert.match(new URL(p.url()).search, /y=2008/);
  const sum = await p.getByTestId("wall-sum-D").innerText();
  assert.notEqual(sum, allSum);
  assert.match(sum, /in 2008/);
  const prints = await p.locator(".wall__band--sm .wall__print").count();
  assert.ok(prints >= 535 && prints < 600, `${prints} prints in 2008`);
  await p.getByRole("radio", { name: "Household trades" }).check();
  assert.match(await p.getByTestId("wall-gap").innerText(), /2012/);
  assert.equal(await p.locator(".wall__band--sm .wall__marker").count(), 0, "no empty markers before the data");
  await p.getByRole("button", { name: "All years" }).click();
  await p.waitForSelector('[data-testid=wall][data-year="all"]');
  await p.close();
});

test("wall state picker searches and filters", async () => {
  const p = await page(390, 844);
  await p.goto(base + "/wall");
  await p.getByRole("button", { name: /State/ }).click();
  await p.keyboard.type("Vermont");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelectorAll(".wall__band--sm .wall__print").length <= 3);
  assert.match(new URL(p.url()).search, /st=VT/);
  await p.close();
});

test("featured example explains itself and steps to another", async () => {
  const p = await page();
  await p.goto(base + "/");
  const slip = p.locator(".slip").first();
  await slip.getByText("Featured example").waitFor();
  assert.match(await slip.innerText(), /Shown because this member/);
  const before = await slip.locator(".slip__title").innerText();
  await slip.getByRole("button", { name: /Show another/ }).click();
  await p.waitForFunction((b) => document.querySelector(".slip .slip__title")?.textContent !== b, before);
  assert.match(await p.locator(".slip").first().innerText(), /Featured example/i);
  await p.close();
});

test("the full file: K000389 loads every table, filters, and CSV has rows", async () => {
  const p = await page();
  await p.goto(base + "/m/K000389/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  const n = (s) => Number(s.replace(/[^\d]/g, ""));
  const trades = n(await p.getByTestId("rec-trades-count").innerText());
  assert.ok(trades > 40000, `trades ${trades}`);
  assert.ok(n(await p.getByTestId("rec-ties-count").innerText()) > 1000);
  assert.ok(n(await p.getByTestId("rec-docs-count").innerText()) > 100);
  assert.ok((await p.locator("[data-testid=rec-trades] tbody tr").count()) < 200, "trade rows are windowed");
  await p.getByLabel("Filter Owner").first().fill("spouse");
  await p.waitForFunction(() => /of/.test(document.querySelector("[data-testid=rec-trades-count]").textContent));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-ties-csv").click()]);
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  const lines = text.trim().split(/\r\n/);
  assert.match(lines[0], /^Published as,Type,Basis,Counterparty/);
  assert.ok(lines.length > 1000, `${lines.length} CSV lines`);
  assert.equal(await p.getByTestId("rec-holdings").count() + await p.getByTestId("rec-holdings-none").count(), 1, "holdings: tables or a one-line note");
  await p.close();
});

test("member page links to the full file and assumption switches recompute cases", async () => {
  const p = await page();
  await p.goto(base + "/m/K000389");
  assert.ok(await p.getByRole("link", { name: "Open the full file" }).count());
  await p.locator(".assume summary").first().click();
  await p.getByRole("switch", { name: "Member’s own trades only" }).click();
  await p.waitForFunction(() => /of .* trades count/.test(document.querySelector("[data-testid=assume-line]")?.textContent ?? ""), null, { timeout: 60000 });
  assert.match(new URL(p.url()).search, /as=own/);
  await p.close();
});

test("senators get a one-line holdings note; a House holdings file renders the section", async () => {
  const p = await page();
  await p.goto(base + "/m/W000817/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 30000 });
  assert.match(await p.getByTestId("rec-holdings-none").innerText(), /senators/);
  await p.goto(base + "/m/W000817");
  assert.match(await p.getByTestId("holdings-note").innerText(), /senators/);
  await p.close();
});

// Runs when the build used PT_HOLDINGS_DIR (unmerged holdings data): serves those files to the browser.
test("holdings: member section and full-file tables from a House holdings file", { skip: !process.env.PT_HOLDINGS_DIR }, async () => {
  const { readFileSync } = await import("node:fs");
  const p = await page();
  await p.route("**/holdings/*.json", (r) => {
    const id = r.request().url().split("/").pop();
    try {
      r.fulfill({ body: readFileSync(`${process.env.PT_HOLDINGS_DIR}/${id}`), contentType: "application/json" });
    } catch {
      r.fulfill({ status: 404 });
    }
  });
  await p.goto(base + "/m/P000197");
  assert.match(await p.getByTestId("holdings").innerText(), /Disclosed net worth range/);
  await p.goto(base + "/m/P000197/records");
  await p.getByTestId("records-ready").waitFor({ timeout: 30000 });
  assert.ok(Number((await p.getByTestId("rec-assets-count").innerText()).replace(/[^\d]/g, "")) > 50);
  await p.close();
});
