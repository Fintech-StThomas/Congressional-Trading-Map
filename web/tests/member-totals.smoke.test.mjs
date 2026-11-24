// Smoke tests (packets P3 and P4) for the member page: the all-in money totals, the activity-by-year wording and the
// holdings section's missing values, against the built site. Uses BASE_URL when set; otherwise starts `next start` on
// port 3128 itself. Runs on the sample fixtures and skips on a real-data build.
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
    base = "http://localhost:3128";
    server = spawn("npx", ["next", "start", "-p", "3128"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname, detached: true });
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

test("money totals: one all-in line per kind, with record counts and no red", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001");
  const box = p.getByTestId("money-totals");
  await box.waitFor();
  const text = await box.innerText();
  assert.match(text, /PAC contributions/);
  assert.match(text, /\d+ ties? · [\d,]+ records?/);
  assert.match(text, /spending is kept apart|never added to support/);
  assert.doesNotMatch(text, /\$0\b(?!\d)/, "no figure is a bare $0");
  const pac = await p.getByTestId("money-total-pac_money-all").innerText();
  assert.match(pac, /smaller ties only/, "the ledger-only subtotal is labelled");
  const colors = await box.evaluate((el) => [...el.querySelectorAll("*")].map((n) => getComputedStyle(n).color));
  for (const c of colors) assert.ok(!/^rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)$/.test(c), `no red text: ${c}`);
  await p.close();
});

test("activity by year: says what the money row counts and marks the open year in progress", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001");
  const tl = p.locator(".timeline");
  await tl.waitFor();
  const text = await tl.innerText();
  assert.match(text, /Money records \(dated to one year\)/);
  assert.match(text, /Further ties with a first or last record/);
  assert.match(text, /in progress/);
  const year = new Date().getFullYear();
  const cell = await tl.locator(".timeline__cell .visually-hidden", { hasText: `${year}:` }).first().textContent();
  assert.doesNotMatch(cell ?? "", /data complete/, "the open year is never complete");
  await p.close();
});

test("holdings: the net-worth note says when a mortgage is subtracted; residence-secured shows not identified, never $0-$0", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001");
  const note = p.getByTestId("nw-mortgage-note");
  if (!(await note.count())) { await p.close(); return t.skip("sample member has no holdings"); }
  assert.match(await note.innerText(), /subtracted unless/);
  const lev = p.getByTestId("leverage");
  if (await lev.count()) assert.doesNotMatch(await lev.innerText(), /\$0.\$0/);
  await p.close();
});

test("phone width: totals and chart do not widen the page", async (t) => {
  if (realData) return t.skip(SAMPLE_ONLY);
  const p = await open("/m/X000001", 390);
  await p.getByTestId("money-totals").waitFor();
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `page overflows by ${over}px`);
  await p.close();
});
