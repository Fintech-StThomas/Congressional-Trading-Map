"use client";
// The yarn's look, shared by the board canvas: the lamp that sets every shadow, the draw-in and
// sway timings, hit-testing helpers, and the frayed (weak or statistical) strand.
//
// How the lamp works: one light sits above the board at LAMP (fractions of width and height).
// lightAt() turns a point's offset from it into a shadow offset, blur and dimming, so strings and
// cards further out cast longer, softer shadows away from the centre. CSS reads these as --sx/--sy/--sb.
import { useEffect, useMemo, useState } from "react";
import { yarnPoint, type Yarn } from "@/lib/board/layout";
import { frayed as fray } from "@/lib/board/fray";

// ---- the lamp ------------------------------------------------------------------
// One light above the board and slightly in front, centred a little above the
// middle. Everything casts its shadow away from it; further out, longer and softer.
export const LAMP = { x: 0.5, y: 0.36 };
export type Light = { sx: number; sy: number; blur: number; dim: number; ang: number; gx: number; gy: number };
export function lightAt(W: number, H: number, x: number, y: number): Light {
  const R = Math.max(200, Math.hypot(W, H) / 2);
  const vx = (x - W * LAMP.x) / R, vy = (y - H * LAMP.y) / R;
  const d = Math.min(1.1, Math.hypot(vx, vy));
  const r = (v: number) => Math.round(v * 100) / 100;
  const ul = Math.hypot(vx, vy) || 1;
  return {
    sx: r(vx * 10),
    sy: r(2.2 + vy * 9),
    blur: r(7 + d * 14),
    dim: r(Math.min(1, d * 1.15)),
    ang: Math.round((Math.atan2(vx, -vy) * 180) / Math.PI),
    // Specular glint sits on the lamp side of a pin head.
    gx: r(d < 0.05 ? 0 : (-vx / ul) * 1.7),
    gy: r(d < 0.05 ? -1.6 : (-vy / ul) * 1.7 - 0.4),
  };
}
export const lightVars = (l: Light) =>
  ({ "--sx": l.sx, "--sy": l.sy, "--sb": l.blur, "--dim": l.dim, "--lang": `${l.ang}deg` }) as React.CSSProperties;

// ---- the draw-in -----------------------------------------------------------------
export const STAGGER = 55; // ms between strings
export const LEAD = 80; // ms before the first string
export const SETTLE = 620; // ms: overshoot, then a damped sway back to rest
export const SAG_KEYS = [0.55, 1.12, 0.95, 1.02, 1];
export const SAG_TIMES = "0;0.38;0.64;0.84;1";
export const SAG_SPLINES = "0.2 0.6 0.35 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1";

/** Bounding box of a yarn (control hull) padded for fibres and sway. */
export function boxOf(y: Yarn, pad: number) {
  const xs = [y.p0.x, y.c.x, y.p1.x], ys = [y.p0.y, y.c.y, y.p1.y];
  const x = Math.min(...xs) - pad, yy = Math.min(...ys) - pad;
  return { x: Math.floor(x), y: Math.floor(yy), w: Math.ceil(Math.max(...xs) - x + pad), h: Math.ceil(Math.max(...ys) - yy + pad) };
}

/** Distance from a point to the yarn, sampled. Used so the nearer string wins. */
export function distTo(y: Yarn, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const p = yarnPoint(y, i / 24);
    best = Math.min(best, Math.hypot(p.x - px, p.y - py));
  }
  return best;
}

/**
 * A weak or statistical string as worn yarn: the strand pinches at two or three
 * worn spots where its plies part into finer threads (one spot may hang by a
 * single thread), with loose fibres added once the board has settled.
 */
export function FrayedYarn({ id, y, w, anim, begin, fibres, px, py }: { id: string; y: Yarn; w: number; anim: boolean; begin: string; fibres: number; px: number; py: number }) {
  const rest = useMemo(() => fray(id, y, w, 1, fibres), [id, y, w, fibres]);
  const keys = useMemo(() => (anim ? SAG_KEYS.map((k) => fray(id, y, w, k, 0)) : null), [anim, id, y, w]);
  const A = (pick: (f: ReturnType<typeof fray>) => string) =>
    keys ? <animate attributeName="d" values={keys.map(pick).join(";")} keyTimes={SAG_TIMES} calcMode="spline" keySplines={SAG_SPLINES} dur={`${SETTLE}ms`} begin={begin} fill="freeze" /> : null;
  return (
    <>
      <path className="yv__shadow yv__shadow--fill" d={rest.core}>{A((f) => f.core)}</path>
      <path className="yv__shadow yv__shadow--thread" d={rest.threads}>{A((f) => f.threads)}</path>
      <g className="yv__lift">
        <path className="yv__corefill" d={rest.core}>{A((f) => f.core)}</path>
        <path className="yv__ply yv__ply--dark" d={rest.plies} style={{ strokeWidth: Math.max(0.45, w * 0.45) }} transform={`translate(${px} ${py})`}>{A((f) => f.plies)}</path>
        <path className="yv__ply yv__ply--lite" d={rest.plies} style={{ strokeWidth: Math.max(0.4, w * 0.35) }} transform={`translate(${-px} ${-py})`}>{A((f) => f.plies)}</path>
        <path className="yv__thread" d={rest.threads}>{A((f) => f.threads)}</path>
        {fibres !== 0 && (
          <>
            <path className="yv__fibre" d={rest.fibres} />
            <path className="yv__fibre yv__fibre--fine" d={rest.fibresFine} />
          </>
        )}
      </g>
    </>
  );
}

/** Renders the fuzz (displacement) only on capable, fine-pointer, wide screens. */
export function useRichYarn(): { rich: boolean; still: boolean } {
  const [v, setV] = useState({ rich: false, still: false });
  useEffect(() => {
    const cheap = window.matchMedia("(max-width: 719px), (pointer: coarse)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const weak = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) < 4 || Boolean(nav.connection?.saveData);
    const apply = () => setV({ rich: !cheap.matches && !weak, still: still.matches });
    apply();
    cheap.addEventListener("change", apply);
    still.addEventListener("change", apply);
    return () => {
      cheap.removeEventListener("change", apply);
      still.removeEventListener("change", apply);
    };
  }, []);
  return v;
}
