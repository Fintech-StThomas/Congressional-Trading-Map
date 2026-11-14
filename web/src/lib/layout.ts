// Deterministic, collision-free placement of pinned cards around a centre print,
// and the yarn geometry between them. Pure functions: same input, same board.

export type Rect = { x: number; y: number; w: number; h: number };
export type Item = { id: string; w: number; h: number };
export type Placed = Item & { x: number; y: number };

const PAD = 14; // clear space between cards
const EDGE = 12; // clear space to the board edge

function overlap(a: Rect, b: Rect, pad: number) {
  const dx = Math.min(a.x + a.w + pad - b.x, b.x + b.w + pad - a.x);
  const dy = Math.min(a.y + a.h + pad - b.y, b.y + b.h + pad - a.y);
  return dx > 0 && dy > 0 ? { dx, dy } : null;
}

function clamp(p: Placed, W: number, H: number) {
  p.x = Math.max(EDGE, Math.min(W - p.w - EDGE, p.x));
  p.y = Math.max(EDGE, Math.min(H - p.h - EDGE, p.y));
}

/**
 * Arrange cards on an ellipse around `center`, strongest first starting just
 * right of twelve o'clock and going clockwise, then separate any overlaps with a
 * fixed number of deterministic relaxation passes. `avoid` holds rectangles that
 * must stay clear (the featured-case slip, overlay controls).
 */
export function arrange(W: number, H: number, center: Rect, items: Item[], avoid: Rect[] = []): Placed[] {
  const n = items.length;
  if (!n) return [];
  const cx = center.x + center.w / 2;
  const cy = center.y + center.h / 2;
  const maxW = Math.max(...items.map((i) => i.w));
  const maxH = Math.max(...items.map((i) => i.h));
  const rxMax = Math.max(40, Math.min(cx, W - cx) - maxW / 2 - EDGE);
  const ryMax = Math.max(40, Math.min(cy, H - cy) - maxH / 2 - EDGE);
  const rxMin = center.w / 2 + maxW / 2 + 36;
  const ryMin = center.h / 2 + maxH / 2 + 24;
  const spread = n <= 2 ? 0.45 : n <= 4 ? 0.6 : n <= 7 ? 0.8 : 1;
  const rx = Math.max(Math.min(rxMin, rxMax), rxMin + (rxMax - rxMin) * spread);
  const ry = Math.max(Math.min(ryMin, ryMax), ryMin + (ryMax - ryMin) * spread);
  const start = -Math.PI / 2 + Math.PI / n;

  const placed: Placed[] = items.map((it, i) => {
    const a = start + (i * 2 * Math.PI) / n;
    return { ...it, x: cx + rx * Math.cos(a) - it.w / 2, y: cy + ry * Math.sin(a) - it.h / 2 };
  });
  placed.forEach((p) => clamp(p, W, H));

  const fixed: Rect[] = [{ x: center.x - 8, y: center.y - 14, w: center.w + 16, h: center.h + 22 }, ...avoid];
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = placed[i];
      for (const f of fixed) {
        const o = overlap(a, f, PAD);
        if (!o) continue;
        moved = true;
        // Push away from the obstacle along the shorter way out.
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
        const fx = f.x + f.w / 2, fy = f.y + f.h / 2;
        if (o.dx < o.dy) a.x += (ax >= fx ? 1 : -1) * o.dx;
        else a.y += (ay >= fy ? 1 : -1) * o.dy;
        clamp(a, W, H);
      }
      for (let j = i + 1; j < n; j++) {
        const b = placed[j];
        const o = overlap(a, b, PAD);
        if (!o) continue;
        moved = true;
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
        const bx = b.x + b.w / 2, by = b.y + b.h / 2;
        if (o.dx < o.dy) {
          const s = (ax < bx || (ax === bx && i < j) ? -1 : 1) * (o.dx / 2 + 0.5);
          a.x += s; b.x -= s;
        } else {
          const s = (ay < by || (ay === by && i < j) ? -1 : 1) * (o.dy / 2 + 0.5);
          a.y += s; b.y -= s;
        }
        clamp(a, W, H);
        clamp(b, W, H);
      }
    }
    if (!moved) break;
  }
  return placed.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) }));
}

/** True when no two placed cards (or a card and an obstacle) overlap. Used by tests and dev checks. */
export function isClear(placed: Rect[], obstacles: Rect[] = []): boolean {
  for (let i = 0; i < placed.length; i++) {
    for (const o of obstacles) if (overlap(placed[i], o, 0)) return false;
    for (let j = i + 1; j < placed.length; j++) if (overlap(placed[i], placed[j], 0)) return false;
  }
  return true;
}

type Pt = { x: number; y: number };
export type Yarn = { d: string; mid: Pt; length: number; p0: Pt; c: Pt; p1: Pt };

/** The yarn's path with its sag scaled by `k` (1 = at rest): used for the settle sway. */
export function yarnAt(y: Pick<Yarn, "p0" | "c" | "p1">, k: number): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  const mx = (y.p0.x + y.p1.x) / 2, my = (y.p0.y + y.p1.y) / 2;
  return `M${r(y.p0.x)} ${r(y.p0.y)}Q${r(mx + (y.c.x - mx) * k)} ${r(my + (y.c.y - my) * k)} ${r(y.p1.x)} ${r(y.p1.y)}`;
}

/** A point on the yarn at parameter t, and the unit normal there. */
export function yarnPoint(y: Pick<Yarn, "p0" | "c" | "p1">, t: number, k = 1): { x: number; y: number; nx: number; ny: number } {
  const mx = (y.p0.x + y.p1.x) / 2, my = (y.p0.y + y.p1.y) / 2;
  const cx = mx + (y.c.x - mx) * k, cy = my + (y.c.y - my) * k;
  const u = 1 - t;
  const x = u * u * y.p0.x + 2 * u * t * cx + t * t * y.p1.x;
  const yy = u * u * y.p0.y + 2 * u * t * cy + t * t * y.p1.y;
  const dx = 2 * u * (cx - y.p0.x) + 2 * t * (y.p1.x - cx);
  const dy = 2 * u * (cy - y.p0.y) + 2 * t * (y.p1.y - cy);
  const l = Math.hypot(dx, dy) || 1;
  return { x, y: yy, nx: -dy / l, ny: dx / l };
}

/** Where a ray from the centre of `r` towards `to` leaves the rectangle, pulled in by `inset`. */
function exitPoint(r: Rect, to: { x: number; y: number }, inset: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = (r.w / 2 - inset) / Math.abs(dx || 1e-9);
  const sy = (r.h / 2 - inset) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Yarn from a print to a card's pin. One quadratic Bezier approximates a
 * hanging catenary: the control point drops below the midpoint by an amount
 * that grows with length, most for level runs, least for steep ones.
 */
export function yarn(from: Rect, pin: { x: number; y: number }, slack = 1, shift = 0): Yarn {
  const s0 = exitPoint(from, pin, 10);
  // Several strings to one pin leave the print a few pixels apart.
  const ux = pin.x - s0.x, uy = pin.y - s0.y;
  const ul = Math.hypot(ux, uy) || 1;
  const s = { x: s0.x + (-uy / ul) * shift, y: s0.y + (ux / ul) * shift };
  const dx = pin.x - s.x, dy = pin.y - s.y;
  const L = Math.hypot(dx, dy);
  const level = L ? Math.abs(dx) / L : 0;
  const sag = Math.min(130, L * (0.05 + 0.13 * level) * slack);
  const c = { x: (s.x + pin.x) / 2, y: (s.y + pin.y) / 2 + sag };
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * pin.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * pin.y };
  const r = (v: number) => Math.round(v * 10) / 10;
  return { d: `M${r(s.x)} ${r(s.y)}Q${r(c.x)} ${r(c.y)} ${r(pin.x)} ${r(pin.y)}`, mid, length: L, p0: s, c, p1: { x: pin.x, y: pin.y } };
}
