// Geometry for a frayed (weak or statistical) string: worn yarn, not a dotted line.
// Along the sagging path the strand thins at two or three worn spots, where its
// plies separate into finer threads that splay apart and rejoin; at most one spot
// hangs by a single thread. Short loose fibres stand off the strand, denser near
// the worn spots. Everything follows the path's normals and is seeded by edge id.
// Pure and free of runtime imports so tests can load it directly.

type Pt = { x: number; y: number };
export type Curve = { p0: Pt; c: Pt; p1: Pt; length: number };

export type Spot = { t: number; h: number; hang: boolean };
export type Fray = {
  spots: Spot[];
  /** Filled outline of the strand; its width pinches at each spot. */
  core: string;
  /** Twisted plies on the sound stretches between spots. */
  plies: string;
  /** Finer threads across each spot (separated plies, or the one thread it hangs by). */
  threads: string;
  /** Short loose fibres; stroke these thin. */
  fibres: string;
  fibresFine: string;
};

/** FNV-1a 32-bit, as lib/hash.ts. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function at(y: Curve, t: number, k: number) {
  const mx = (y.p0.x + y.p1.x) / 2, my = (y.p0.y + y.p1.y) / 2;
  const cx = mx + (y.c.x - mx) * k, cy = my + (y.c.y - my) * k;
  const u = 1 - t;
  const x = u * u * y.p0.x + 2 * u * t * cx + t * t * y.p1.x;
  const yy = u * u * y.p0.y + 2 * u * t * cy + t * t * y.p1.y;
  const dx = 2 * u * (cx - y.p0.x) + 2 * t * (y.p1.x - cx);
  const dy = 2 * u * (cy - y.p0.y) + 2 * t * (y.p1.y - cy);
  const l = Math.hypot(dx, dy) || 1;
  return { x, y: yy, tx: dx / l, ty: dy / l, nx: -dy / l, ny: dx / l };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number) => `${r1(x)} ${r1(y)}`;

/** Two or three worn spots (one on very short strings), seeded; at most one hangs by a thread. */
export function spotsFor(id: string, length: number): Spot[] {
  const rand = rng(hash(`spots|${id}`));
  const n = length < 70 ? 1 : length < 170 ? 2 : 3;
  const h = Math.min(0.2, Math.max(7, Math.min(26, length * 0.11)) / Math.max(1, length) / 2 + 0.004);
  const spots: Spot[] = [];
  const lo = 0.16, hi = 0.84, slot = (hi - lo) / n;
  for (let i = 0; i < n; i++) spots.push({ t: lo + slot * (i + 0.2 + rand() * 0.6), h: h * (0.8 + rand() * 0.5), hang: false });
  if (length >= 60 && rand() < 0.7) spots[Math.floor(rand() * n)].hang = true;
  return spots;
}

/** 0 away from spots, 1 at a spot's centre (smooth cosine window). */
function wear(spots: Spot[], t: number): { v: number; s: Spot | null } {
  let best = 0, sp: Spot | null = null;
  for (const s of spots) {
    const d = Math.abs(t - s.t) / s.h;
    if (d < 1) {
      const v = 0.5 + 0.5 * Math.cos(Math.PI * d);
      if (v > best) {
        best = v;
        sp = s;
      }
    }
  }
  return { v: best, s: sp };
}

/**
 * The frayed string for edge `id`, drawn `w` px wide, with its sag scaled by `k`
 * (1 = at rest; other values for the settle sway). `fibres` = how many loose fibres
 * to draw (0 for none, e.g. before settle or on low-power devices).
 */
export function frayed(id: string, y: Curve, w: number, k = 1, fibres = -1): Fray {
  const L = Math.max(1, y.length);
  const spots = spotsFor(id, L);
  const N = Math.max(28, Math.min(140, Math.round(L / 2.5)));
  const left: string[] = [], right: string[] = [];
  const plyRuns: string[] = [];
  let run: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = at(y, t, k);
    const { v, s } = wear(spots, t);
    // Thins to ~18% at a split spot and to nothing where it hangs by one thread.
    const hw = (w / 2) * (1 - v * (s?.hang ? 1 : 0.82));
    left.push(pt(p.x + p.nx * hw, p.y + p.ny * hw));
    right.push(pt(p.x - p.nx * hw, p.y - p.ny * hw));
    if (v < 0.05) run.push(pt(p.x, p.y));
    else if (run.length) {
      if (run.length > 1) plyRuns.push(`M${run[0]}L${run.slice(1).join(" ")}`);
      run = [];
    }
  }
  if (run.length > 1) plyRuns.push(`M${run[0]}L${run.slice(1).join(" ")}`);
  const core = `M${left[0]}L${left.slice(1).join(" ")}L${right.reverse().join(" ")}Z`;

  // Threads across each spot.
  const threads: string[] = [];
  for (const [si, s] of spots.entries()) {
    const rand = rng(hash(`threads|${id}|${si}`));
    const M = 14;
    const t0 = Math.max(0.005, s.t - s.h * 1.05), t1 = Math.min(0.995, s.t + s.h * 1.05);
    const count = s.hang ? 1 : 2 + (rand() < 0.55 ? 1 : 0);
    const signs = count === 1 ? [0.18] : count === 2 ? [-1, 1] : [-1, 0.25, 1];
    for (const sign of signs) {
      const amp = sign * (w * 0.75 + 1.3) * (0.75 + rand() * 0.5);
      const twist = 0.3 + rand() * 0.35, ph = rand() * Math.PI * 2, skew = 0.65 + rand() * 0.8;
      const pts: string[] = [];
      for (let j = 0; j <= M; j++) {
        const u = j / M;
        const t = t0 + (t1 - t0) * u;
        const p = at(y, t, k);
        const bulge = Math.pow(Math.sin(Math.PI * Math.pow(u, skew)), 0.85);
        const off = amp * bulge + twist * Math.sin(u * Math.PI * 3 + ph) * bulge;
        pts.push(pt(p.x + p.nx * off, p.y + p.ny * off));
      }
      threads.push(`M${pts[0]}L${pts.slice(1).join(" ")}`);
    }
  }

  // Loose fibres, about one per 8px, most near the spots.
  const fa: string[] = [], fb: string[] = [];
  const want = fibres >= 0 ? fibres : Math.min(36, Math.round(L / 11) + spots.length * 4);
  const rand = rng(hash(`fibres|${id}`));
  for (let i = 0; i < want; i++) {
    const near = rand() < 0.55;
    const s = spots[Math.floor(rand() * spots.length)];
    const g = (rand() + rand() + rand() - 1.5) / 1.5; // roughly normal in [-1, 1]
    const t = near ? s.t + g * s.h * 1.4 : 0.04 + rand() * 0.92;
    if (t <= 0.02 || t >= 0.98) continue;
    const p = at(y, t, k);
    const { v, s: spot } = wear(spots, t);
    const hw = (w / 2) * (1 - v * (spot?.hang ? 1 : 0.82));
    const side = rand() < 0.5 ? -1 : 1;
    const len = (near ? 1.4 : 0.9) + Math.pow(rand(), 2) * (near ? 4.2 : 2.6) * (0.7 + w * 0.15);
    const ang = (0.35 + rand() * 0.95) * (rand() < 0.5 ? 1 : -1); // radians off the normal, either way along
    const dx = p.nx * side * Math.cos(ang) + p.tx * Math.sin(ang);
    const dy = p.ny * side * Math.cos(ang) + p.ty * Math.sin(ang);
    const rx = p.x + p.nx * side * hw * 0.9, ry = p.y + p.ny * side * hw * 0.9;
    const curl = (rand() - 0.5) * len * 0.55;
    const cx = rx + dx * len * 0.5 - dy * curl, cy = ry + dy * len * 0.5 + dx * curl;
    const seg = `M${pt(rx, ry)}Q${pt(cx, cy)} ${pt(rx + dx * len, ry + dy * len)}`;
    (rand() < 0.45 ? fb : fa).push(seg);
  }
  return { spots, core, plies: plyRuns.join(""), threads: threads.join(""), fibres: fa.join(""), fibresFine: fb.join("") };
}
