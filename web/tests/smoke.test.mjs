// Smoke tests against the built site. Run `npm run build` first, then `npm test`.
// Uses BASE_URL when set; otherwise starts `next start` on port 3123 itself.
// What they run against is whatever the build used (README "Tests"): the sample fixtures in a clean checkout,
// real data when the build had DATA_BASE_URL or a pipeline build in public/data. Tests declared with realTest
// need real members and files (K000389, the wall, organisations) and are skipped, with a message, on the sample site.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

let base = process.env.BASE_URL;
let server;
let browser;
let realData = false; // set in before(): does the site serve a real build at /data/meta.json?
const NEEDS_REAL =
  "needs real data: the site was built on the SAMPLE fixtures; build with DATA_BASE_URL=<bucket>/data (or a pipeline build in public/data)";

function realTest(name, fn) {
  test(name, async (t) => {
    if (!realData) return t.skip(NEEDS_REAL);
    return fn(t);
  });
}

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
    // detached: its own process group, so after() can stop next-server too (killing npx alone left it running).
    server = spawn("npx", ["next", "start", "-p", "3123"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
    await up(base);
  }
  // Real builds (local or remote) serve /data/meta.json with a publication budget; the sample site serves /sample-data.
  realData = await fetch(base + "/data/meta.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => Boolean(m && m.publication_budget))
    .catch(() => false);
  if (process.env.EXPECT_REAL_DATA === "1") {
    assert.ok(realData, "Expected real data, but /data/meta.json is missing, failed, or lacks publication_budget");
  }
  if (!realData) console.log(`# smoke: ${NEEDS_REAL}`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {}
  }
});

// Every Content-Security-Policy violation seen by any page in this file (console reports and
// securitypolicyviolation events); the last test asserts there were none.
const cspViolations = [];

async function page(width = 1440, height = 900) {
  const p = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  p.on("pageerror", (e) => {
    throw e;
  });
  p.on("console", (m) => {
    if (/Content[- ]Security[- ]Policy|CSP violation/i.test(m.text())) cspViolations.push(`${p.url()}: ${m.text()}`);
  });
  await p.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`)),
  );
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
  const fix = drawer.getByTestId("correction-link");
  assert.equal((await fix.innerText()).trim(), "Something wrong with this record?");
  const body = new URL(await fix.getAttribute("href")).searchParams.get("body");
  assert.match(body, /Tie: \w+ .*edge \S+/);
  assert.match(body, /From: .*\nTo: /);
  assert.match(body, /Records: /);
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
  const rows = await p.locator(".stage__table table.ties").first().locator("tbody tr:not(.ties__group)").count();
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

realTest("the wall renders prints, switches markers and opens the board", async () => {
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

realTest("organisations page lists both rankings with split bars", async () => {
  const p = await page();
  await p.goto(base + "/orgs");
  await p.waitForSelector("[data-testid=orgs-reach] .orgs__row");
  assert.ok((await p.locator("[data-testid=orgs-dollars] .orgs__row").count()) >= 20);
  assert.ok((await p.locator("[data-testid=orgs-reach] .split__bar .seg").count()) > 20);
  await p.getByLabel("Find an organisation").fill("realtors");
  assert.match(await p.locator("[data-testid=orgs-reach] .orgs__row").first().innerText(), /REALTORS/);
  await p.close();
});

realTest("a large organisation shows its party split and reach", async () => {
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

realTest("wall and organisation pages do not scroll sideways at phone width", async () => {
  const p = await page(390, 844);
  for (const url of ["/wall", "/orgs", "/o/co%3A732717"]) {
    await p.goto(base + url, { waitUntil: "networkidle" });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${url} scrolls sideways by ${overflow}px`);
  }
  await p.close();
});

test("member case file and full file do not scroll sideways at phone width", async () => {
  // The year timeline's hidden labels once escaped its scroll box and let phones pan the whole page.
  const id = realData ? "P000197" : "X000001";
  const p = await page(390, 844);
  for (const url of [`/m/${id}`, `/m/${id}/records`]) {
    await p.goto(base + url, { waitUntil: "networkidle" });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${url} scrolls sideways by ${overflow}px`);
  }
  await p.close();
});

realTest("wall by year: a year loads, members and summaries change, and 2008 trades say so in words", async () => {
  const p = await page();
  // The local prerender can be visible before the slider's client handler hydrates.
  await p.goto(base + "/wall", { waitUntil: "networkidle" });
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

realTest("wall state picker searches and filters", async () => {
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
  // The next pick may be in another state whose strings are still loading (on demand in remote data mode).
  await p.locator(".slip").first().getByText(/Featured example/i).waitFor({ timeout: 20000 });
  await p.close();
});

realTest("the full file: K000389 loads every table, filters, and CSV has rows", async () => {
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

realTest("member page links to the full file and assumption switches recompute cases", async () => {
  const p = await page();
  await p.goto(base + "/m/K000389");
  assert.ok(await p.getByRole("link", { name: "Open the full file" }).count());
  await p.locator(".assume summary").first().click();
  await p.getByRole("switch", { name: "Member’s own and jointly owned trades only" }).click();
  await p.waitForFunction(() => /of .* trades count/.test(document.querySelector("[data-testid=assume-line]")?.textContent ?? ""), null, { timeout: 60000 });
  assert.match(new URL(p.url()).search, /as=own/);
  await p.close();
});

realTest("senators get a one-line holdings note; a House holdings file renders the section", async () => {
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

realTest("spending against sits in its own unconnected zone; frayed strings carry a word tag", async () => {
  const p = await page();
  await p.goto(base + "/?s=CA&m=K000389");
  const zone = p.getByTestId("against-zone");
  await zone.waitFor({ timeout: 15000 });
  // The against zone can arrive before the independently loaded board cards.
  await p.waitForSelector(".bcard", { timeout: 15000 });
  assert.match(await zone.innerText(), /Spent against this member[\s\S]*Not a relationship[\s\S]*AGAINST/);
  const cardIds = await p.locator(".bcard").evaluateAll((els) => els.map((e) => e.getAttribute("data-node")));
  const zoneText = await zone.innerText();
  assert.ok(!/opposing/.test(await p.locator(".bcard").allInnerTexts().then((t) => t.join(" "))), "no opposing spender on a yarn card");
  assert.ok(cardIds.length > 0 && zoneText.length > 0);
  await zone.locator(".against__open").first().click();
  await p.getByTestId("evidence-drawer").waitFor();
  assert.ok(await p.locator(".bcard .tag--weak").count() >= 1, "frayed string's card is stamped");
  await p.close();
});

// ---- fixes from the code review (REVIEW.md) ---------------------------------------

realTest("an organisation's tie total adds the ledger-only ties to the listed ones", async () => {
  const id = "co:732717";
  const { createHash } = await import("node:crypto");
  const shard = createHash("sha1").update(id).digest("hex").slice(0, 2);
  const file = (await (await fetch(`${base}/data/orgs/${shard}.json`)).json())[id];
  const listed = file.ties.rows.length;
  const ledger = Object.values(file.ledger_totals ?? {}).reduce((n, t) => n + t.edges, 0);
  const p = await page();
  await p.goto(`${base}/o/${encodeURIComponent(id)}`);
  await p.getByTestId("org-page").waitFor({ timeout: 20000 });
  const note = await p.locator("#ties-h + .section__note").innerText();
  if (ledger > 0) assert.match(note, new RegExp(`largest ${listed.toLocaleString("en-US")} of ${(listed + ledger).toLocaleString("en-US")} ties`));
  await p.close();
});

realTest("a case built on a disclosed holding does not say the household traded", async () => {
  const cases = await (await fetch(`${base}/data/cases.json`)).json();
  const i = cases.findIndex((c) => !c.types.includes("traded"));
  if (i < 0) return;
  const p = await page();
  const n = Math.floor(i / 50) + 1;
  await p.goto(base + (n > 1 ? `/cases/page/${n}` : "/cases"));
  const row = p.locator(".caserow").nth(i % 50);
  const what = await row.locator(".caserow__what").innerText();
  assert.match(what, /held the stock/);
  assert.doesNotMatch(what, /traded/);
  await p.close();
});

realTest("cases come 50 to a page, with a count, a pager and filters that keep each page small", async () => {
  const cases = await (await fetch(`${base}/data/cases.json`)).json();
  if (cases.length <= 50) return;
  const p = await page();
  await p.goto(base + "/cases/page/2");
  assert.equal(await p.locator(".caserow").count(), Math.min(50, cases.length - 50));
  assert.match(await p.getByTestId("case-count").innerText(), new RegExp(`Cases 51–${Math.min(100, cases.length)} of ${cases.length.toLocaleString("en-US")}`));
  assert.equal((await p.locator(".caserow__rank").first().innerText()).trim(), "51");
  await p.getByTestId("case-pager").getByRole("link", { name: "Next →" }).click();
  await p.waitForURL(/\/cases\/page\/3$/);
  await p.getByTestId("case-filters").getByRole("link", { name: /^Senate/ }).click();
  await p.waitForURL(/\/cases\/chamber\/senate$/);
  const seats = await p.locator(".caserow__sub").allInnerTexts();
  assert.ok(seats.length > 0 && seats.every((t) => /Senator|Senate|Sen\./i.test(t)), "senate filter shows senators only");
  const html = await (await fetch(`${base}/cases`)).text();
  assert.ok(html.length < 1_000_000, `page 1 is ${html.length} bytes`);
  await p.close();
});

test("every page links to a prefilled correction issue", async () => {
  const p = await page();
  await p.goto(base + "/method");
  const href = await p.locator("footer.site-footer [data-testid=correction-link]").getAttribute("href");
  const u = new URL(href);
  assert.equal(u.pathname, "/Fintech-StThomas/Congressional-Trading-Map/issues/new");
  assert.equal(u.searchParams.get("labels"), "correction");
  assert.match(u.searchParams.get("body"), /Page: .*\/method/);
  assert.match(u.searchParams.get("body"), /Data build: /);
  assert.ok(await p.locator("#corrections-h").isVisible());
  await p.close();
});

realTest("ledger rows say which way the money went", async () => {
  const p = await page();
  await p.goto(base + "/m/K000389");
  const dirs = await p.getByTestId("ledger").locator("tbody .ties__dir").allInnerTexts();
  assert.ok(dirs.length > 0 && dirs.every((d) => /^(from|to|with)$/.test(d.trim())), "every ledger row has a direction word");
  await p.close();
});

test("security headers are sent; the share image stays readable cross-origin", async () => {
  const home = await fetch(base + "/");
  for (const h of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"])
    assert.ok(home.headers.get(h), `${h} missing on /`);
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(home.headers.get("cross-origin-resource-policy"), "same-origin");
  const og = await fetch(base + "/opengraph-image");
  assert.equal(og.status, 200);
  assert.equal(og.headers.get("cross-origin-resource-policy"), "cross-origin");
  const geo = await fetch(base + "/geo/us-states.json");
  assert.match(geo.headers.get("cache-control") ?? "", /max-age=604800/);
});

test("junk ids are 404s, not errors", async () => {
  for (const path of ["/m/zzjunk", "/m/" + "a".repeat(2000), "/m/%3Cscript%3E", "/m/Z999999", "/m/junk/records", "/board-member/junk", "/board-data/ZZ", "/cases/page/99999", "/cases/ties/junk", "/o/junk"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, `${path.slice(0, 40)} gave ${r.status}`);
  }
});

// The published bucket may predate the positions contract; local fresh pipeline builds exercise this flow.
realTest("annual positions, financial history and transition CSV agree with the data", async (t) => {
  const indexResponse = await fetch(base + "/data/holdings-index.json");
  if (!indexResponse.ok) return t.skip("holdings index unavailable");
  const index = await indexResponse.json();
  const column = (key) => index.cols.indexOf(key);
  if (column("pos_assets") < 0) return t.skip("published build predates position timelines");
  const row = index.rows.find((r) => r[column("pos_assets")] > 0 && r[column("nw_first_year")] && r[column("margin_loan_years")] > 0);
  assert.ok(row, "a multi-year profile with assets and margin loans exists");
  const id = row[column("id")];
  const wire = await fetch(`${base}/data/holdings/positions/${id}.json`).then((r) => r.json());
  const p = await page();
  await p.goto(`${base}/m/${id}`);
  await p.getByTestId("tenure-change").waitFor();
  await p.getByTestId("leverage").waitFor();
  let failFirstPositionRequest = true;
  await p.route("**/data/holdings/positions/*.json", async (route) => {
    if (failFirstPositionRequest) {
      failFirstPositionRequest = false;
      return route.fulfill({ status: 503, body: "temporary data failure" });
    }
    return route.continue();
  });
  await p.getByRole("button", { name: "Load position timelines" }).click();
  await p.getByRole("alert").filter({ hasText: "positions file failed" }).waitFor();
  await p.getByRole("button", { name: "Retry loading positions" }).click();
  await p.locator(".positions__table").waitFor();
  assert.equal(await p.locator(".positions__table tbody tr").count(), Math.min(20, wire.assets.rows.length));
  await p.locator(".positions__table summary").first().click();
  assert.ok(await p.locator('.positions__table a[href*="financial-pdfs"]').count() > 0);
  await p.setViewportSize({ width: 390, height: 844 });
  const mobileTable = p.locator(".positions .tablewrap");
  assert.ok(await mobileTable.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1 && el.scrollWidth > el.clientWidth;
  }), "year columns scroll inside the timeline's mobile container");
  assert.equal(await p.locator(".positions__table thead").isVisible(), true, "year headers stay visible on phones");
  await p.goto(`${base}/m/${id}/records`);
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  await p.getByRole("button", { name: "Load every position transition" }).click();
  await p.getByTestId("rec-positions").waitFor();
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByTestId("rec-positions-csv").click()]);
  const { readFile } = await import("node:fs/promises");
  const { decodePositions, transitionRows, TRANSITION_COLS } = await import("../src/lib/domain/positions.ts");
  const { toCSV } = await import("../src/lib/domain/records.ts");
  assert.equal(await readFile(await download.path(), "utf8"), toCSV(TRANSITION_COLS, transitionRows(wire, decodePositions(wire))));
  await p.close();
});

// Runs last: the main journeys not covered above, then the check over every page this file opened.
// ---- one investigation across the board, the case file and the full file (shared view state in the URL)
// These use the invented sample member X000001 (and one of its tie ids), so they skip on a real-data build.
const SAMPLE_ONLY = "needs the sample fixtures (member X000001)";

test("the year range carries from the case file to the full file through the view switcher", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000001?y=2016-2020");
  const sw = p.getByTestId("view-switch");
  await sw.waitFor();
  assert.match(await p.getByTestId("view-filter-label").innerText(), /Filtered to 2016–2020/);
  assert.equal(await sw.locator("a[aria-current=page]").innerText(), "Case file");
  await sw.getByRole("link", { name: "Full file", exact: true }).click();
  await p.waitForURL(/\/m\/X000001\/records\?.*y=2016-2020/);
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  assert.match(await p.getByTestId("view-filter-label").innerText(), /Filtered to 2016–2020/);
  assert.match(await p.getByTestId("rec-ties-years").innerText(), /2016–2020/);
  await p.getByTestId("view-clear-years").click();
  await p.waitForFunction(() => !location.search.includes("y="));
  assert.equal(await p.getByTestId("view-filter-label").count(), 0);
  await p.close();
});

test("a tie selected on the case file puts e= in the URL and survives the switch to the board", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000001");
  await p.locator("table.ties tbody tr[data-edge]").first().waitFor();
  await p.locator("table.ties tbody tr[data-edge] button", { hasText: "Evidence" }).first().click();
  await p.waitForURL(/[?&]e=[0-9a-f]{12}/);
  const e = new URL(p.url()).searchParams.get("e");
  await p.getByTestId("evidence-drawer").waitFor();
  await p.getByTestId("view-switch").getByRole("link", { name: "Board", exact: true }).click();
  await p.waitForURL(/\/\?.*m=X000001/);
  assert.equal(new URL(p.url()).searchParams.get("e"), e);
  // The board opens that string's drawer, or says the tie is not drawn there (the board draws only the largest ties).
  await p.locator("[data-testid=evidence-drawer], [data-testid=board-tie-missing]").first().waitFor({ timeout: 15000 });
  await p.close();
});

test("arriving with e highlights the tie's row in the full file", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await page();
  await p.goto(base + "/m/X000001/records?e=2c115a69f293");
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  await p.waitForSelector("[data-testid=rec-ties] tr.is-selected");
  assert.equal(await p.locator("[data-testid=rec-ties] tr.is-selected").count(), 1);
  assert.match(await p.getByTestId("rec-selected-tie").innerText(), /2c115a69f293/);
  await p.close();
});

test("embeds can be framed, feeds are RSS, and ordinary pages still refuse framing", async () => {
  const embed = await fetch(base + "/embed/m/X000001");
  if (embed.status === 404) return; // a build without that member (real data)
  assert.match(embed.headers.get("content-security-policy") ?? "", /frame-ancestors \*/);
  assert.equal(embed.headers.get("x-frame-options"), null);
  const about = await fetch(base + "/about");
  assert.match(about.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const feed = await fetch(base + "/feed/trades.xml");
  assert.match(feed.headers.get("content-type") ?? "", /application\/rss\+xml/);
});

test("no Content-Security-Policy violations on any page", async () => {
  const p = await page();
  for (const url of ["/", "/wall", "/cases", "/orgs", "/method", "/about"]) {
    await p.goto(base + url, { waitUntil: "networkidle" });
  }
  // A state on the board, then a string's evidence drawer.
  await p.goto(base + "/");
  await p.waitForSelector(".yarn", { timeout: 10000, state: "attached" });
  await p.locator(".yarn").first().focus();
  await p.keyboard.press("Enter");
  await p.getByTestId("evidence-drawer").waitFor();
  // The member's case file, printed (print stylesheet and the print-only case file).
  await p.keyboard.press("Escape");
  await p.locator(".stage__board .slip a", { hasText: "Open case file" }).click();
  await p.getByTestId("member-page").waitFor();
  await p.emulateMedia({ media: "print" });
  await p.waitForLoadState("networkidle");
  await p.emulateMedia({ media: "screen" });
  // The full file and its CSV download.
  const id = new URL(p.url()).pathname.split("/")[2];
  await p.goto(`${base}/m/${id}/records`);
  await p.getByTestId("records-ready").waitFor({ timeout: 60000 });
  const csv = p.getByTestId("rec-ties-csv");
  if (await csv.count()) await Promise.all([p.waitForEvent("download"), csv.click()]);
  // The correction link opens GitHub in a new tab (a navigation, which the CSP does not govern).
  const [tab] = await Promise.all([p.context().waitForEvent("page"), p.locator("footer.site-footer [data-testid=correction-link]").click()]);
  await tab.close();
  // The organisation shell also renders in sample mode (using an invented company).
  await p.goto(base + (realData ? "/o/co%3A732717" : "/o/co%3A9000001"), { waitUntil: "networkidle" });
  if (realData) {
    // The wall's year control.
    await p.goto(base + "/wall");
    await p.waitForSelector("[data-testid=wall] .wall__print");
    await p.goto(base + "/wall?y=2012");
    await p.waitForSelector('[data-testid=wall][data-year="2012"]', { timeout: 15000 });
  }
  await p.close();
  assert.deepEqual(cspViolations, []);
});
