// Smoke tests for review flags against the built site: /flags (statement, rules, both views, rule filter, row links),
// a member page with a flagged trade (summary line, neutral badge, the "Around this trade" panel and its sources),
// /method's anchors and the flags feed. Uses BASE_URL when set; otherwise starts `next start` on port 3129. They need a
// data build that carries flags.json and skip on the sample fixtures and older builds.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

let base = process.env.BASE_URL;
let server;
let browser;
let flags = null;
const NEEDS = "needs a data build with flags.json";
const BANNED = /suspicious|\bsus\b|corrupt|insider trading|red flag/i;

before(async () => {
  if (!base) {
    base = "http://localhost:3129";
    server = spawn("npx", ["next", "start", "-p", "3129"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  flags = await fetch(base + "/data/flags.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server?.pid) try { process.kill(-server.pid); } catch {}
});

async function page(width = 1440, height = 900) {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on("pageerror", (e) => { throw e; });
  return p;
}

const red = (c) => /rgb\((\d+), (\d+), (\d+)\)/.exec(c);
/** A colour is "red" when its red channel clearly dominates (the tie colour family). */
function isReddish(c) {
  const m = red(c);
  return Boolean(m && +m[1] > 150 && +m[1] > +m[2] * 1.6 && +m[1] > +m[3] * 1.6);
}

test("/flags: statement first, rules with counts and method anchors, two views and a rule filter", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const p = await page();
  const res = await p.goto(base + "/flags");
  assert.equal(res.status(), 200);
  assert.equal((await p.getByTestId("flags-statement").innerText()).includes(flags.statement), true);
  assert.equal(await p.getByTestId("flags-rule").count(), flags.rules.length);
  assert.ok(await p.locator('a[href="/method#flag-pile_on"]').count());
  const multi = flags.rows.filter((r) => r[9].length >= 2).length;
  assert.match(await p.getByTestId("flags-count").innerText(), new RegExp(`of ${multi.toLocaleString("en-US")} trades`));
  assert.ok((await p.getByTestId("flags-row").count()) <= 100, "the table renders 100 rows at a time");
  const chip = p.locator(".fl-rows .flagchip").first();
  assert.equal(isReddish(await chip.evaluate((el) => getComputedStyle(el).borderColor)), false, "badges never use the tie colour");
  assert.equal(isReddish(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)), false);
  await p.getByTestId("flags-view-recent").click();
  const recentText = await p.getByTestId("flags-count").innerText();
  assert.doesNotMatch(recentText, new RegExp(`of ${multi.toLocaleString("en-US")} trades`));
  await p.getByTestId("flags-view-multi").click();
  await p.getByTestId("flags-rule-filter").selectOption("large_amount");
  const n = await p.getByTestId("flags-row").count();
  for (let i = 0; i < Math.min(n, 10); i++) assert.match(await p.getByTestId("flags-row").nth(i).innerText(), /Large amount/);
  assert.doesNotMatch(await p.locator("main").innerText(), BANNED);
  await p.close();
});

test("/flags row link opens the member's trade row with its badge and the panel", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const p = await page();
  await p.goto(base + "/flags");
  const link = p.getByTestId("flags-row-link").first();
  const href = await link.getAttribute("href");
  assert.match(href, /^\/m\/[A-Z]\d{6}\?t=.+#trades$/);
  await link.click();
  await p.waitForURL(/\/m\/[A-Z]\d{6}\?t=/);
  const panel = p.getByTestId("trade-around");
  await panel.waitFor({ timeout: 15000 });
  assert.match(await panel.innerText(), /Review flags met/);
  assert.match(await panel.innerText(), new RegExp(flags.statement.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(await p.locator("tr.is-active").count(), "the linked row is marked");
  await p.close();
});

test("member page: summary line, neutral badges and 'Around this trade' with SEC filings and a news link", async (t) => {
  if (!flags) return t.skip(NEEDS);
  // A flagged trade in an SEC company: the panel shows its 8-Ks as context (or says why it cannot).
  const row = flags.rows.find((r) => r[5]?.startsWith("co:")) ?? flags.rows[0];
  const p = await page();
  await p.goto(`${base}/m/${row[0]}?t=${encodeURIComponent(row[1])}#trades`);
  assert.match(await p.getByTestId("trades-flag-summary").innerText(), /prompt for reporting, not a finding/);
  const panel = p.getByTestId("trade-around");
  await panel.waitFor({ timeout: 15000 });
  await p.getByTestId("around-sec").or(p.getByTestId("around-sec-note")).first().waitFor({ timeout: 15000 });
  if (await p.getByTestId("around-sec").count()) {
    assert.ok(await panel.locator('a[href^="https://www.sec.gov/"]').count(), "listed 8-Ks link to the SEC");
  }
  assert.match(await p.getByTestId("around-news").getAttribute("href"), /^https:\/\/www\.google\.com\/search\?tbm=nws/);
  const badge = p.getByTestId("trade-flag-badge").first();
  assert.ok(await badge.count());
  const chip = badge.locator(".flagchip");
  assert.equal(isReddish(await chip.evaluate((el) => getComputedStyle(el).borderColor)), false);
  assert.ok((await badge.getAttribute("title")).length > 0, "the badge carries the detail as a tooltip");
  assert.doesNotMatch(await panel.innerText(), BANNED);
  await p.getByTestId("around-close").click();
  assert.equal(await p.getByTestId("trade-around").count(), 0);
  // Any row opens the panel, flagged or not.
  await p.locator(".trades__around button").first().click();
  await panel.waitFor();
  await p.close();
});

test("/method has a section per rule and the flags feed lists recent flagged trades", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const p = await page();
  await p.goto(base + "/method#flag-pile_on");
  assert.ok(await p.locator("#flag-pile_on").count());
  assert.equal(await p.locator("#flag-before_company_news").count(), 0, "the 8-K rule is context only, not a flag");
  assert.match(await p.getByTestId("method-flags").innerText(), /prompt for reporting, not a finding/);
  assert.ok(await p.getByTestId("method-sec").count());
  await p.close();
  const res = await fetch(base + "/feed/flags.xml");
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<channel>/);
  assert.doesNotMatch(xml, BANNED);
});

// Real-data cases from the review of 2026-11-26 (skipped when the build lacks these trades).
async function openTrade(member, trade) {
  const p = await page();
  const res = await p.goto(`${base}/m/${member}?t=${encodeURIComponent(trade)}#trades`);
  if (res.status() !== 200) return null;
  const panel = p.getByTestId("trade-around");
  try { await panel.waitFor({ timeout: 15000 }); } catch { await p.close(); return null; }
  return { p, panel };
}

test("Around: a money flag on a ledger-only tie lists that tie, never 'no PAC money'", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const o = await openTrade("M001136", "house:20033446:441");
  if (!o) return t.skip("trade not in this build");
  await o.p.getByTestId("around-pac-ledger").first().waitFor({ timeout: 5000 });
  assert.equal(await o.p.getByTestId("around-pac-none").count(), 0);
  assert.doesNotMatch(await o.panel.innerText(), /No PAC money from this company/);
  await o.p.close();
});

test("Around: a not-counted row says the rules were not checked and never claims 'no 8-K'", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const o = await openTrade("L000579", "house:20000717:0");
  if (!o) return t.skip("trade not in this build");
  await o.p.getByTestId("around-not-counted").waitFor({ timeout: 5000 });
  const text = await o.panel.innerText();
  assert.doesNotMatch(text, /met none of/);
  await o.p.getByTestId("around-sec-note").or(o.p.getByTestId("around-sec")).first().waitFor({ timeout: 15000 });
  assert.doesNotMatch(await o.panel.innerText(), /No 8-K was filed/);
  await o.p.close();
});

test("links and the over-45-days chip are never in the tie red", async (t) => {
  if (!flags) return t.skip(NEEDS);
  const row = flags.rows.find((r) => r[9].includes("late")) ?? flags.rows[0];
  const p = await page();
  await p.goto(`${base}/m/${row[0]}#trades`);
  const link = p.locator("main a").first();
  assert.equal(isReddish(await link.evaluate((el) => getComputedStyle(el).textDecorationColor)), false);
  const chip = p.locator(".tradetable .late").first();
  if (await chip.count()) {
    for (const k of ["borderColor", "backgroundColor", "color"]) assert.equal(isReddish(await chip.evaluate((el, k) => getComputedStyle(el)[k], k)), false);
    const fits = await chip.evaluate((el) => el.getBoundingClientRect().right <= el.closest("td").getBoundingClientRect().right + 0.5);
    assert.ok(fits, "the chip fits its column");
  }
  await p.close();
});
