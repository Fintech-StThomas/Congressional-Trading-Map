// Dense boards must leave every card and the central subject readable at supported sizes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, isClear } from "../src/lib/board/layout.ts";

test("up to twelve cards stay clear with the briefing outside the canvas", () => {
  for (const width of [660, 700, 800, 900, 1000, 1200]) {
    for (const height of [540, 600, 720, 860]) {
      const compact = width < 1000 || height < 620;
      for (const subject of ["member", "organisation"]) {
        const w = subject === "member" ? (compact ? 112 : 136) : 240;
        const h = subject === "member" ? Math.round(w * 1.22) + 14 : 104;
        const center = { x: Math.round(width / 2 - w / 2), y: Math.round(height / 2 - h / 2 + (subject === "member" ? 4 : 0)), w, h };
        for (let count = 1; count <= 12; count++) {
          const cards = arrange(width, height, center, Array.from({ length: count }, (_, i) => ({ id: String(i), w: compact ? 176 : 190, h: compact ? 80 : 88 })));
          assert.ok(isClear(cards, [center]), `${subject}: ${count} cards at ${width}×${height}`);
          assert.ok(cards.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= width && p.y + p.h <= height));
        }
      }
    }
  }
});

test("a dense board that needs an alternate ellipse phase remains deterministic", () => {
  const width = 660, height = 540, subject = { x: 274, y: 199, w: 112, h: 150 };
  const cards = Array.from({ length: 9 }, (_, i) => ({ id: String(i), w: 176, h: 80 }));
  const first = arrange(width, height, subject, cards);
  const second = arrange(width, height, subject, cards);
  assert.deepEqual(second, first);
  assert.ok(isClear(first, [subject]));
});
