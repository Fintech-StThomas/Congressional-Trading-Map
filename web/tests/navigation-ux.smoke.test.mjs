// Focused browser regression for deep-page navigation and vertical scroll chaining.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const cwd = new URL("..", import.meta.url).pathname;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("deep section shortcuts and case-file tables return scroll to the page", async (t) => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn("npx", ["next", "start", "-p", String(port)], { cwd, stdio: "ignore", detached: true });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, `built Next site unavailable at ${base}; run npm run build first`);
    const meta = await fetch(`${base}/data/meta.json`);
    if (meta.ok) return t.skip("fixture navigation regression; real-data pages use smoke.test.mjs");

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/m/X000001`, { waitUntil: "networkidle" });
    const sectionNav = page.getByTestId("section-index");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    assert.ok(await sectionNav.evaluate((el) => el.getBoundingClientRect().top < 100), "section navigation remains reachable deep in the case file");
    await sectionNav.getByRole("link", { name: "Ties" }).click();
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await page.locator("#ties").evaluate((el) => el.getBoundingClientRect().top)) < 100, "shortcut returns to the requested section");
    await sectionNav.getByRole("link", { name: "Back to sections" }).click();
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await sectionNav.evaluate((el) => el.getBoundingClientRect().top - 8)) < 16, "return link brings the section controls into view");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNav = await sectionNav.boundingBox();
    assert.ok(mobileNav && mobileNav.x >= 0 && mobileNav.x + mobileNav.width <= 391, "sticky section navigation stays within the phone viewport");
    await sectionNav.getByRole("link", { name: "Holdings" }).click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator("#holdings").evaluate((el) => el.getBoundingClientRect().top >= 55), "section heading stays below the sticky controls");

    await page.setViewportSize({ width: 1280, height: 800 });
    const caseTable = page.locator(".vtable").first();
    await caseTable.scrollIntoViewIfNeeded();
    for (const edge of ["top", "bottom"]) {
      await caseTable.evaluate((el, pos) => { el.scrollTop = pos === "top" ? 0 : el.scrollHeight; }, edge);
      await page.evaluate(() => {
        const el = document.querySelector(".vtable");
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150);
      });
      await page.waitForTimeout(100);
      const box = await caseTable.boundingBox();
      assert.ok(box && box.y > 0 && box.y < 300, "case table edge is visible below the page top");
      const before = await page.evaluate(() => window.scrollY);
      for (let i = 0; i < 2; i++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, edge === "top" ? -500 : 500);
        await page.waitForTimeout(100);
      }
      const after = await page.evaluate(() => window.scrollY);
      assert.ok(edge === "top" ? after < before : after > before, `page scroll resumes at the ${edge} of the Case file trade table (${before} → ${after})`);
    }

    await page.goto(`${base}/m/X000001/records`, { waitUntil: "networkidle" });
    const toc = page.locator(".rec__toc");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    assert.ok(await toc.evaluate((el) => el.getBoundingClientRect().top < 100), "full-file shortcuts remain reachable deep on the page");
    await toc.getByRole("link", { name: "Back to sections" }).click();
    await page.waitForTimeout(150);
    assert.ok(Math.abs(await toc.evaluate((el) => el.getBoundingClientRect().top - 8)) < 16);
    await page.setViewportSize({ width: 794, height: 1123 }); // A4 at CSS-pixel scale.
    await page.emulateMedia({ media: "print" });
    assert.ok(await toc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "printed section links wrap instead of being clipped in a scroll container");
  } finally {
    await browser?.close();
    try { process.kill(-server.pid); } catch {}
  }
});
