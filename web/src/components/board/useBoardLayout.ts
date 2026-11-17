"use client";
// Memoized card placement and yarn paths; the briefing lives outside the canvas.
import { useMemo } from "react";
import { arrange, yarn, type Rect } from "@/lib/board/layout";
import type { Edge, NodeRef } from "@/lib/types";
import type { Center } from "./BoardCanvas";
import { lightAt } from "./yarn";

export type NodeCard = { ref: NodeRef; edges: Edge[]; order: number };

export function useBoardLayout(size: { W: number; H: number } | null, center: Center, nodes: NodeCard[], edges: Edge[]) {
  return useMemo(() => {
    if (!size || !center) return null;
    const { W, H } = size;
    const compact = W < 1000 || H < 620;
    const cw = compact ? 176 : 190, ch = compact ? 80 : 88;
    const centerRect: Rect =
      center.kind === "member"
        ? (() => {
            const w = compact ? 112 : 136, h = Math.round(w * 1.22) + 14;
            return { x: Math.round(W / 2 - w / 2), y: Math.round(H / 2 - h / 2 + 4), w, h };
          })()
        : { x: Math.round(W / 2 - 120), y: Math.round(H / 2 - 52), w: 240, h: 104 };
    const placed = arrange(W, H, centerRect, nodes.map((n) => ({ id: `${n.ref.kind}:${n.ref.id}`, w: cw, h: ch })));
    const pos = new Map(placed.map((p) => [p.id, p]));
    const strings = nodes.flatMap((n) => {
      const p = pos.get(`${n.ref.kind}:${n.ref.id}`);
      if (!p) return [];
      // Pin on the edge facing the centre, clear of the text and the re-centre control.
      const ccx = centerRect.x + centerRect.w / 2;
      const pin =
        p.y + p.h < centerRect.y + 10
          ? { x: p.x + p.w / 2, y: p.y + p.h - 7 }
          : p.y > centerRect.y + centerRect.h - 10
            ? { x: p.x + p.w / 2, y: p.y + 7 }
            : p.x + p.w / 2 < ccx
              ? { x: p.x + p.w - 6, y: p.y + Math.round(p.h * 0.42) }
              : { x: p.x + 6, y: p.y + Math.round(p.h * 0.42) };
      return n.edges.map((e, j) => {
        const k = n.edges.length;
        const slack = 1 + (j - (k - 1) / 2) * 0.42;
        const shift = (j - (k - 1) / 2) * 7;
        const y = yarn(centerRect, pin, slack, shift);
        return { e, node: n, pin, y, light: lightAt(W, H, y.mid.x, y.mid.y) };
      });
    });
    const pins = new Map(strings.map((x) => [`${x.node.ref.kind}:${x.node.ref.id}`, x.pin]));
    // Draw order: strongest string first, as the edges arrived.
    const orderOf = new Map(edges.map((e, i) => [e.id, i]));
    strings.sort((a, b) => (orderOf.get(a.e.id) ?? 0) - (orderOf.get(b.e.id) ?? 0));
    const lights = new Map(placed.map((p) => [p.id, lightAt(W, H, p.x + p.w / 2, p.y + p.h / 2)]));
    return { W, H, centerRect, placed, pos, strings, pins, lights, cw, ch, compact };
  }, [size, center, nodes, edges]);
}
