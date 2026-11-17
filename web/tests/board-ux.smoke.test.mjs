// Browser regressions for visible board records and non-modal evidence dismissal.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:3126";
let server, browser;
before(async () => {
  server = spawn("npx", ["next", "start", "-p", "3126"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore", detached: true });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Build the site before running browser regressions");
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  try { process.kill(-server.pid); } catch {}
});

test("briefing never covers cards, including when expanded and resized", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(base);
    await page.locator(".bcard__open").first().waitFor();
    for (const width of [1440, 1200, 800, 720]) {
      await page.setViewportSize({ width, height: 900 });
      const briefing = page.getByTestId("board-briefing");
      const summary = briefing.locator("summary");
      for (const expanded of [false, true]) {
        if (await summary.evaluate((el) => el.parentElement.open) !== expanded) await summary.click();
        await page.waitForTimeout(100);
        const intro = await briefing.boundingBox();
        const canvas = await page.getByTestId("board-canvas").boundingBox();
        assert.ok(intro.y + intro.height <= canvas.y, `briefing above board at ${width}px`);
        const boxes = await page.locator(".bcard:not(.bcard--centre)").evaluateAll((els) => els.map((el) => {
          const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }));
        for (let i = 0; i < boxes.length; i++) {
          assert.ok(boxes[i].y >= intro.y + intro.height, "every card below the briefing");
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, "cards do not overlap after rotation");
          }
        }
      }
    }
  } finally { await page.close(); }
});

test("evidence closes outside, preserves inside interactions and keeps other controls usable", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(base);
    const trigger = page.locator(".bcard__open").first();
    await trigger.click();
    const drawer = page.getByTestId("evidence-drawer");
    await drawer.waitFor();
    assert.ok(new URL(page.url()).searchParams.has("e"));
    assert.equal(await page.locator(".yarnlabel").count(), 0, "no duplicate tooltip over the portrait");
    await drawer.locator("h2").click();
    assert.ok(await drawer.isVisible(), "inside clicks keep evidence open");
    await drawer.getByTestId("cite-tie-button").click();
    await page.keyboard.press("Escape");
    assert.ok(await drawer.isVisible(), "Escape closes the citation before the drawer");

    // Dragging a text selection outside is not an outside click.
    const title = await drawer.locator("h2").boundingBox();
    await page.mouse.move(title.x + 15, title.y + 10);
    await page.mouse.down();
    await page.mouse.move(5, title.y + 10, { steps: 10 });
    await page.mouse.up();
    assert.ok(await drawer.isVisible());
    await page.mouse.click(5, 150);
    await drawer.waitFor({ state: "detached" });
    assert.equal(new URL(page.url()).searchParams.has("e"), false);
    assert.ok(await trigger.evaluate((el) => el === document.activeElement), "blank-area dismissal restores the trigger");

    await trigger.click();
    await drawer.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    const search = page.getByRole("combobox");
    await search.click();
    await drawer.waitFor({ state: "detached" });
    assert.ok(await search.evaluate((el) => el === document.activeElement), "outside search keeps focus");

    await trigger.click();
    await drawer.waitFor();
    const close = drawer.getByRole("button", { name: "Close evidence (Escape)", exact: true });
    const bounds = await close.boundingBox();
    assert.ok(bounds.height >= 44 && bounds.width >= 44);
    await close.click();
    await drawer.waitFor({ state: "detached" });

    await trigger.click();
    await drawer.waitFor();
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
  } finally { await page.close(); }
});

test("phone evidence sheet supports tapping outside", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await page.goto(base);
    const row = page.locator(".stage__table").getByRole("button", { name: /^Evidence:/ }).first();
    await row.waitFor();
    await row.click();
    const drawer = page.getByTestId("evidence-drawer");
    await drawer.waitFor();
    const box = await drawer.boundingBox();
    assert.ok(box.y > 0, "outside area remains available above the sheet");
    await page.touchscreen.tap(5, Math.floor(box.y / 2));
    await drawer.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  } finally { await page.close(); }
});

test("settled yarn follows the cards after table switching and resizing", async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.goto(base);
    await page.locator(".yv__core").first().waitFor({ state: "attached" });
    await page.waitForFunction(() => document.querySelectorAll(".yv animate").length === 0);
    await page.getByRole("button", { name: "View as table", exact: true }).click();
    await page.getByRole("button", { name: "View as board", exact: true }).click();
    await page.setViewportSize({ width: 800, height: 900 });
    await page.waitForTimeout(150);
    const lengths = await page.locator(".yv__core").evaluateAll((paths) => paths.map((p) => p.getTotalLength()));
    assert.ok(lengths.length > 0 && lengths.every((n) => n > 80), "strings stay full length after the hidden canvas is restored");
    assert.equal(await page.locator(".yv animate").count(), 0, "frozen animation geometry cannot override the current paths");
  } finally { await page.close(); }
});
