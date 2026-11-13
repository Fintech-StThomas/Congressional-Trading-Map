"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edge, NodeRef, OrgSummary } from "@/lib/types";
import type { MapGeometry } from "@/lib/geo";
import { arrange, yarn, yarnAt, yarnPoint, type Rect, type Yarn } from "@/lib/layout";
import { typeLabel, amountLabel, filteredAmount, otherEnd, stringStyle, strokeWidth, isFrayed, frayCue, tiePhrase } from "@/lib/edges";
import { count, seat } from "@/lib/format";
import { nodeName, ORG_KIND_LABEL, type BoardMember, type NameBook } from "@/lib/client";
import { fnv1a, tiltFor } from "@/lib/hash";
import { Print, PartyTag } from "../Print";
import { USMap } from "./USMap";

export type Center =
  | { kind: "member"; member: BoardMember; total: number }
  | { kind: "org"; org: OrgSummary; total: number }
  | null;

type Props = {
  geo: MapGeometry;
  counts: Record<string, number>;
  selectedState: string | null;
  onSelectState: (code: string) => void;
  center: Center;
  edges: Edge[];
  book: NameBook;
  caseNodes: Set<string>;
  focusNode: string | null;
  drawKey: string;
  range: [number, number];
  activeEdge: string | null;
  /** Open the evidence for `e`; `group` holds every string to the same card. */
  onOpenEdge: (e: Edge, el: Element, group?: Edge[]) => void;
  onRecenter: (n: NodeRef) => void;
  slip: ReactNode;
  loading: boolean;
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type NodeCard = { ref: NodeRef; edges: Edge[]; order: number };

// ---- the lamp ------------------------------------------------------------------
// One light above the board and slightly in front, centred a little above the
// middle. Everything casts its shadow away from it; further out, longer and softer.
const LAMP = { x: 0.5, y: 0.36 };
type Light = { sx: number; sy: number; blur: number; dim: number; ang: number; gx: number; gy: number };
function lightAt(W: number, H: number, x: number, y: number): Light {
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
const lightVars = (l: Light) =>
  ({ "--sx": l.sx, "--sy": l.sy, "--sb": l.blur, "--dim": l.dim, "--lang": `${l.ang}deg` }) as React.CSSProperties;

// ---- the draw-in -----------------------------------------------------------------
const STAGGER = 55; // ms between strings
const LEAD = 80; // ms before the first string
const SETTLE = 620; // ms: overshoot, then a damped sway back to rest
const SAG_KEYS = [0.55, 1.12, 0.95, 1.02, 1];
const SAG_TIMES = "0;0.38;0.64;0.84;1";
const SAG_SPLINES = "0.2 0.6 0.35 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1";

/** Breaks in a frayed string, as a dash pattern in pathLength=100 units. */
const GAP = 5.5;
function breaksFor(e: Edge, long: boolean): { dash: string; at: number } {
  const h = fnv1a(e.id);
  const a = 26 + (h % 22); // first break between 26% and 48% of the way
  if (!long) return { dash: `${a} ${GAP} 100`, at: a };
  const b = a + GAP + 18 + ((h >>> 8) % 14);
  return { dash: `${a} ${GAP} ${b - a - GAP} 3 100`, at: a };
}

/**
 * A loose, partly unravelled ply peeling off one side of the first break:
 * `side` -1 is the end before the gap, 1 the end after it.
 */
function strandAt(y: Yarn, at: number, w: number, k: number, flip: number, side: -1 | 1): string {
  const edge = side < 0 ? at / 100 : (at + GAP) / 100;
  const span = side < 0 ? 0.11 : 0.07;
  const pts: string[] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const f = i / N; // 0 = attached to the yarn, 1 = loose tip in the gap
    const t = edge - side * span * (1 - f) + side * 0.012 * f;
    const p = yarnPoint(y, Math.min(0.99, Math.max(0.01, t)), k);
    const lift = Math.pow(f, 1.6) * (4.5 + w * 1.2) * flip * (side < 0 ? 1 : -0.8) + Math.sin(i * 1.9) * 0.45;
    pts.push(`${Math.round((p.x + p.nx * lift) * 10) / 10} ${Math.round((p.y + p.ny * lift) * 10) / 10}`);
  }
  return `M${pts[0]}L${pts.slice(1).join(" ")}`;
}

/** Bounding box of a yarn (control hull) padded for fibres and sway. */
function boxOf(y: Yarn, pad: number) {
  const xs = [y.p0.x, y.c.x, y.p1.x], ys = [y.p0.y, y.c.y, y.p1.y];
  const x = Math.min(...xs) - pad, yy = Math.min(...ys) - pad;
  return { x: Math.floor(x), y: Math.floor(yy), w: Math.ceil(Math.max(...xs) - x + pad), h: Math.ceil(Math.max(...ys) - yy + pad) };
}

/** Distance from a point to the yarn, sampled. Used so the nearer string wins. */
function distTo(y: Yarn, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i <= 24; i++) {
    const p = yarnPoint(y, i / 24);
    best = Math.min(best, Math.hypot(p.x - px, p.y - py));
  }
  return best;
}

/** Renders the fuzz (displacement) only on capable, fine-pointer, wide screens. */
function useRichYarn(): { rich: boolean; still: boolean } {
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

export function BoardCanvas(props: Props) {
  const { geo, counts, selectedState, onSelectState, center, edges, book, caseNodes, focusNode, drawKey, range, activeEdge, onOpenEdge, onRecenter, slip, loading } = props;
  const box = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  const [slipBox, setSlipBox] = useState<Rect | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const { rich, still } = useRichYarn();
  const [settled, setSettled] = useState<string | null>(null);

  useIsoLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s && Math.abs(s.W - r.width) < 1 && Math.abs(s.H - r.height) < 1 ? s : { W: Math.round(r.width), H: Math.round(r.height) }));
      const sl = slipRef.current;
      if (sl) {
        const b = sl.getBoundingClientRect();
        setSlipBox({ x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (slipRef.current) ro.observe(slipRef.current);
    return () => ro.disconnect();
  }, []);

  const selfId = center?.kind === "member" ? center.member.id : center?.kind === "org" ? center.org.id : "";
  const centreName = center?.kind === "member" ? center.member.name : center?.kind === "org" ? center.org.name : "";

  const nodes = useMemo<NodeCard[]>(() => {
    const map = new Map<string, NodeCard>();
    edges.forEach((e, i) => {
      const o = otherEnd(e, selfId);
      const k = `${o.kind}:${o.id}`;
      const n = map.get(k);
      if (n) n.edges.push(e);
      else map.set(k, { ref: o, edges: [e], order: i });
    });
    // Put the focused node (a case being opened) first so it lands at the top.
    const list = [...map.values()];
    if (focusNode) list.sort((a, b) => (b.ref.id === focusNode ? 1 : 0) - (a.ref.id === focusNode ? 1 : 0));
    return list;
  }, [edges, selfId, focusNode]);

  const layout = useMemo(() => {
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
    const avoid = slipBox ? [{ ...slipBox, w: slipBox.w + 4, h: slipBox.h + 4 }] : [];
    const placed = arrange(W, H, centerRect, nodes.map((n) => ({ id: `${n.ref.kind}:${n.ref.id}`, w: cw, h: ch })), avoid);
    const pos = new Map(placed.map((p) => [p.id, p]));
    const strings = nodes.flatMap((n) => {
      const p = pos.get(`${n.ref.kind}:${n.ref.id}`)!;
      // Pin on the edge facing the centre so yarn never crosses the card's text.
      const ccx = centerRect.x + centerRect.w / 2;
      const pin =
        p.y + p.h < centerRect.y + 10
          ? { x: p.x + p.w / 2, y: p.y + p.h - 7 }
          : p.y > centerRect.y + centerRect.h - 10
            ? { x: p.x + p.w / 2, y: p.y + 7 }
            : p.x + p.w / 2 < ccx
              ? { x: p.x + p.w - 11, y: p.y + 8 }
              : { x: p.x + 11, y: p.y + 8 };
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
    strings.sort((a, b) => orderOf.get(a.e.id)! - orderOf.get(b.e.id)!);
    const lights = new Map(placed.map((p) => [p.id, lightAt(W, H, p.x + p.w / 2, p.y + p.h / 2)]));
    const slipLight = slipBox ? lightAt(W, H, slipBox.x + slipBox.w / 2, slipBox.y + slipBox.h / 2) : null;
    return { W, H, centerRect, placed, pos, strings, pins, lights, slipLight, cw, ch, compact };
  }, [size, center, nodes, edges, slipBox]);

  // Fuzz goes on once the strings have come to rest, so no filter runs while they sway.
  const nStrings = layout?.strings.length ?? 0;
  useEffect(() => {
    if (!nStrings || still) return;
    const t = window.setTimeout(() => setSettled(drawKey), LEAD + (nStrings - 1) * STAGGER + SETTLE + 40);
    return () => window.clearTimeout(t);
  }, [drawKey, nStrings, still]);
  const done = still || settled === drawKey;
  const fuzz = rich && done;

  const nearest = useCallback(
    (clientX: number, clientY: number) => {
      const el = box.current;
      if (!el || !layout) return null;
      const r = el.getBoundingClientRect();
      const px = clientX - r.left, py = clientY - r.top;
      let best: (typeof layout.strings)[number] | null = null;
      let bd = 14;
      for (const s of layout.strings) {
        const d = distTo(s.y, px, py);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    },
    [layout],
  );

  const backdrop = Boolean(center);
  const hovered = layout?.strings.find((s) => s.e.id === (hover ?? focused ?? activeEdge));
  const anyHot = Boolean(hover || hoverNode || focused);
  const groupOf = (n: NodeCard) => n.edges;

  return (
    <div className={`canvas${center ? " has-center" : ""}${layout?.compact ? " is-compact" : ""}`} ref={box} data-testid="board-canvas">
      <USMap geo={geo} counts={counts} selected={selectedState} backdrop={backdrop} onSelect={onSelectState} />
      <div className="canvas__light" aria-hidden="true" />
      {!geo.states.length && <p className="canvas__nomap">State outlines are unavailable in this build. Use the state list beside the board.</p>}

      {layout && center && (
        <>
          <div className="canvas__center" style={{ left: layout.centerRect.x, top: layout.centerRect.y, width: layout.centerRect.w, height: layout.centerRect.h }}>
            {center.kind === "member" ? (
              <Print id={center.member.id} name={center.member.name} photo={center.member.photo} size="xl" />
            ) : (
              <div className="bcard bcard--centre" style={{ "--tilt": `${tiltFor(center.org.id, 1)}deg` } as React.CSSProperties}>
                <span className="bcard__kind">
                  {ORG_KIND_LABEL[center.org.kind]}
                  {center.org.ticker ? ` · ${center.org.ticker}` : ""}
                </span>
                <span className="bcard__name">{center.org.name}</span>
                <span className="bcard__meta">
                  Tied to {count(center.org.degree)} {center.org.degree === 1 ? "member" : "members"}
                </span>
              </div>
            )}
          </div>

          {layout.placed.map((p) => {
            const n = nodes.find((x) => `${x.ref.kind}:${x.ref.id}` === p.id)!;
            const i = layout.strings.findIndex((s) => s.node === n);
            const isCase = caseNodes.has(n.ref.id);
            const m = n.ref.kind === "member" ? book.members[n.ref.id] : null;
            const o = n.ref.kind === "org" ? book.orgs[n.ref.id] : null;
            const name = nodeName(n.ref, book);
            const says = n.edges.map((e) => tiePhrase(e, n.ref.id, centreName, range));
            const saysFull = n.edges.map((e) => tiePhrase(e, n.ref.id, centreName, range, true));
            const k = n.edges.length;
            const openLabel = `${name}${o ? `, ${ORG_KIND_LABEL[o.kind]}` : m ? `, ${seat(m)}` : ""}: ${saysFull.join("; ")}.${isCase ? " Case: traded the stock and received PAC money in the same years." : ""} Open the evidence${k > 1 ? ` for ${k} strings` : ""}.`;
            const light = layout.lights.get(p.id)!;
            return (
              <div
                key={`${drawKey}-${p.id}`}
                className={`bcard bcard--${n.ref.kind}${n.ref.id === focusNode ? " is-focus" : ""}${hoverNode === p.id ? " is-hot" : ""}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h, "--tilt": `${tiltFor(n.ref.id, 1.4)}deg`, "--i": i, ...lightVars(light) } as React.CSSProperties}
                onMouseEnter={() => setHoverNode(p.id)}
                onMouseLeave={() => setHoverNode(null)}
                data-node={n.ref.id}
              >
                <button
                  type="button"
                  className="bcard__open"
                  onClick={(ev) => onOpenEdge(n.edges[0], ev.currentTarget, groupOf(n))}
                  onFocus={() => setHoverNode(p.id)}
                  onBlur={() => setHoverNode(null)}
                  aria-label={openLabel}
                >
                  {m && <Print id={m.id} name={m.name} photo={m.photo} size="xs" pinned={false} tilt={false} />}
                  <span className="bcard__text">
                    {m ? (
                      <>
                        <span className="bcard__name">{m.name}</span>
                        <span className="bcard__kind">
                          <PartyTag party={m.party} /> {seat(m, false)}
                          {isCase && <span className="tag tag--inline">Case</span>}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="bcard__kind">
                          {o ? ORG_KIND_LABEL[o.kind] : "Organisation"}
                          {o?.ticker ? ` · ${o.ticker}` : ""}
                          {isCase && <span className="tag tag--inline">Case</span>}
                        </span>
                        <span className="bcard__name">{name}</span>
                      </>
                    )}
                    <span className="bcard__says">
                      {says[0]}
                      {k > 1 && <span className="bcard__more"> +{k - 1}</span>}
                    </span>
                  </span>
                </button>
                <button type="button" className="bcard__recentre" onClick={() => onRecenter(n.ref)} aria-label={`Re-centre the board on ${name}`} title="Re-centre the board here">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                    <path d="M8 0.8v2.6M8 12.6v2.6M0.8 8h2.6M12.6 8h2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}

          <svg key={drawKey} className="yarns" viewBox={`0 0 ${layout.W} ${layout.H}`} width={layout.W} height={layout.H} aria-label="Strings" role="group">
            <defs>
              {layout.strings.map(({ e, y }, i) => {
                const frayed = isFrayed(e);
                const b = boxOf(y, 26);
                // Masks cover only this string (plus sway room), never the whole board.
                const m = boxOf(y, 44);
                return (
                  <g key={`${drawKey}-${e.id}`}>
                    <mask id={`reveal-${drawKey}-${e.id}`} maskUnits="userSpaceOnUse" x={m.x} y={m.y} width={m.w} height={m.h}>
                      <path d={y.d} pathLength={1} className="yarn__reveal" style={{ "--i": i } as React.CSSProperties} />
                    </mask>
                    {frayed && (
                      <mask id={`brk-${drawKey}-${e.id}`} maskUnits="userSpaceOnUse" x={m.x} y={m.y} width={m.w} height={m.h}>
                        <path d={y.d} pathLength={100} className="yarn__breaks" strokeDasharray={breaksFor(e, y.length > 150).dash} />
                      </mask>
                    )}
                    {fuzz && (
                      <filter id={`fz-${drawKey}-${e.id}`} filterUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h} colorInterpolationFilters="sRGB">
                        <feTurbulence type="fractalNoise" baseFrequency={frayed ? "0.5" : "0.9"} numOctaves={2} seed={fnv1a(e.id) % 97} result="n" />
                        <feDisplacementMap in="SourceGraphic" in2="n" scale={frayed ? 9 : 5.5} xChannelSelector="R" yChannelSelector="G" />
                      </filter>
                    )}
                  </g>
                );
              })}
            </defs>

            {layout.strings.map(({ e, y, node, light }, i) => {
              const style = stringStyle(e);
              const frayed = isFrayed(e);
              const base = strokeWidth(e, range);
              const w = frayed ? Math.max(1.1, Math.round(base * 0.55 * 10) / 10) : base;
              const nodeKey = `${node.ref.kind}:${node.ref.id}`;
              const hot = hover === e.id || focused === e.id || activeEdge === e.id || hoverNode === nodeKey;
              const brk = frayed ? breaksFor(e, y.length > 150) : null;
              const flip = fnv1a(e.id) % 2 ? 1 : -1;
              const anim = !still;
              const begin = `${LEAD + i * STAGGER}ms`;
              const sway = (vals: string) =>
                anim ? <animate attributeName="d" values={vals} keyTimes={SAG_TIMES} calcMode="spline" keySplines={SAG_SPLINES} dur={`${SETTLE}ms`} begin={begin} fill="freeze" /> : null;
              const dVals = anim ? SAG_KEYS.map((k) => yarnAt(y, k)).join(";") : "";
              const ul = Math.hypot(light.sx, light.sy) || 1;
              // Plies: the lit one shifts toward the lamp, the shaded one away.
              const px = Math.round((light.sx / ul) * w * 0.17 * 100) / 100, py = Math.round((light.sy / ul) * w * 0.17 * 100) / 100;
              const P = (cls: string, extra?: React.SVGProps<SVGPathElement>) => (
                <path className={cls} d={y.d} {...extra}>
                  {sway(dVals)}
                </path>
              );
              return (
                <g
                  key={`${drawKey}-${e.id}`}
                  className={`yv yv--${style}${frayed ? " yv--frayed" : ""}${hot ? " is-hot" : ""}${anyHot && !hot ? " is-dim" : ""}${focused === e.id ? " is-focus" : ""}`}
                  style={{ "--sx": light.sx, "--sy": light.sy, "--w": w } as React.CSSProperties}
                  aria-hidden="true"
                  data-edge-vis={e.id}
                >
                  <g mask={done ? undefined : `url(#reveal-${drawKey}-${e.id})`}>
                    {P("yv__halo", { style: { strokeWidth: w + 8 } })}
                    <g mask={brk ? `url(#brk-${drawKey}-${e.id})` : undefined}>
                      {P("yv__shadow-soft", { style: { strokeWidth: w + 4.5 } })}
                      {P("yv__shadow", { style: { strokeWidth: w + 0.6 } })}
                      <g className="yv__lift">
                        {fuzz && style !== "context" && P("yv__fuzz", { style: { strokeWidth: w + (frayed ? 3 : 2) }, filter: `url(#fz-${drawKey}-${e.id})` })}
                        {P("yv__core", { style: { strokeWidth: w } })}
                        {style !== "context" && (
                          <>
                            {P("yv__ply yv__ply--dark", { style: { strokeWidth: Math.max(0.5, w * 0.5) }, transform: `translate(${px} ${py})` })}
                            {P("yv__ply yv__ply--lite", { style: { strokeWidth: Math.max(0.45, w * 0.4) }, transform: `translate(${-px} ${-py})` })}
                          </>
                        )}
                      </g>
                    </g>
                    {brk &&
                      ([-1, 1] as const).map((side) => (
                        <path key={side} className={`yv__strand yv__strand--${side < 0 ? "a" : "b"}`} d={strandAt(y, brk.at, w, 1, flip, side)}>
                          {sway(anim ? SAG_KEYS.map((k) => strandAt(y, brk.at, w, k, flip, side)).join(";") : "")}
                        </path>
                      ))}
                  </g>
                </g>
              );
            })}

            {layout.placed.map((p) => {
              const pin = layout.pins.get(p.id) ?? { x: p.x + p.w / 2, y: p.y + 7 };
              const l = layout.lights.get(p.id)!;
              return (
                <g key={`pin-${drawKey}-${p.id}`} className="pinhead" transform={`translate(${pin.x} ${pin.y})`} aria-hidden="true">
                  <ellipse rx="5.6" ry="5" className="pinhead__shadow" cx={l.sx * 0.32} cy={l.sy * 0.32 + 0.8} />
                  <circle r="5" className="pinhead__head" />
                  <circle r="3.2" className="pinhead__sheen" cx={l.gx * 0.6} cy={l.gy * 0.6} />
                  <circle r="1.3" className="pinhead__glint" cx={l.gx} cy={l.gy} />
                </g>
              );
            })}

            <g className="yarnhits" onPointerLeave={() => setHover(null)}>
              {layout.strings.map(({ e, y, node }) => {
                const amt = amountLabel(e, range);
                const nrec = filteredAmount(e, range).n;
                const name = nodeName(node.ref, book);
                const cue = frayCue(e);
                const pick = (ev: { clientX: number; clientY: number }) => nearest(ev.clientX, ev.clientY)?.e ?? e;
                return (
                  <path
                    key={`${drawKey}-${e.id}`}
                    className="yarn"
                    d={y.d}
                    tabIndex={0}
                    role="button"
                    aria-label={`${name} ${tiePhrase(e, node.ref.id, centreName, range, true)}. ${typeLabel(e)}: ${amt ?? "no amount disclosed"}, ${nrec} ${nrec === 1 ? "record" : "records"}${cue ? `, ${cue}` : ""}. Open the evidence.`}
                    data-edge={e.id}
                    onPointerMove={(ev) => {
                      const id = pick(ev).id;
                      if (id !== hover) setHover(id);
                    }}
                    onFocus={() => setFocused(e.id)}
                    onBlur={() => setFocused(null)}
                    onClick={(ev) => {
                      const hit = ev.detail === 0 ? e : pick(ev);
                      onOpenEdge(hit, ev.currentTarget);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onOpenEdge(e, ev.currentTarget);
                      }
                    }}
                  />
                );
              })}
            </g>
          </svg>

          {hovered && (
            <div
              className="yarnlabel"
              role="presentation"
              style={{
                left: Math.max(130, Math.min(layout.W - 130, hovered.y.mid.x)),
                top: Math.max(30, Math.min(layout.H - 60, hovered.y.mid.y)),
              }}
            >
              <span className="yarnlabel__line">
                <span className="yarnlabel__who">{nodeName(hovered.node.ref, book)}</span> {tiePhrase(hovered.e, hovered.node.ref.id, centreName, range, true)}
              </span>
              <span className="yarnlabel__meta">
                <span className="yarnlabel__type">{typeLabel(hovered.e)}</span>
                <span className="mono">
                  {amountLabel(hovered.e, range) ?? "no amount"} · {count(filteredAmount(hovered.e, range).n)} {filteredAmount(hovered.e, range).n === 1 ? "record" : "records"}
                </span>
                {frayCue(hovered.e) && <span className="yarnlabel__cue">{frayCue(hovered.e)}</span>}
              </span>
            </div>
          )}
        </>
      )}

      <div className="canvas__slip" ref={slipRef} style={layout?.slipLight ? lightVars(layout.slipLight) : undefined}>
        {slip}
      </div>
      {loading && (
        <div className="canvas__loading" role="status">
          Pulling the records…
        </div>
      )}
      {center && layout && edges.length === 0 && !loading && (
        <p className="canvas__empty" role="status">
          No strings match the current filters. Turn on more families or widen the years.
        </p>
      )}
    </div>
  );
}
