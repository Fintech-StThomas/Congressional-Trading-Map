"use client";
// The board canvas: the map behind, the centre print or organisation card, the cards around it
// placed by lib/board/layout (arrange), and one yarn string per tie, drawn in with a sway.
// Data in: the edges BoardApp has already filtered, the name book, and the case / excluded sets.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edge, NodeRef, OrgSummary } from "@/lib/types";
import type { MapGeometry } from "@/lib/board/geo";
import { yarnAt } from "@/lib/board/layout";
import { typeLabel, amountLabel, filteredAmount, otherEnd, stringStyle, strokeWidth, isFrayed, frayCue, tiePhrase, weakTag } from "@/lib/domain/edges";
import { count, seat } from "@/lib/format";
import { nodeName, ORG_KIND_LABEL, type BoardMember, type NameBook } from "@/lib/domain/names";
import { fnv1a, tiltFor } from "@/lib/hash";
import { Print, PartyTag } from "@/components/shared/Print";
import { CASE_TAG_TEXT } from "@/lib/copy";
import { USMap } from "./USMap";
import { useBoardLayout, type NodeCard } from "./useBoardLayout";
import { boxOf, distTo, FrayedYarn, LEAD, lightVars, SAG_KEYS, SAG_SPLINES, SAG_TIMES, SETTLE, STAGGER, useRichYarn } from "./yarn";

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
  /** Edge ids the assumption switches exclude: drawn faded, not removed. */
  excluded?: Set<string>;
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

export function BoardCanvas(props: Props) {
  const { geo, counts, selectedState, onSelectState, center, edges, book, caseNodes, excluded, focusNode, drawKey, range, activeEdge, onOpenEdge, onRecenter, slip, loading } = props;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
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
      if (r.width < 1 || r.height < 1) return; // The table view temporarily hides this canvas.
      setSize((s) => (s && Math.abs(s.W - r.width) < 1 && Math.abs(s.H - r.height) < 1 ? s : { W: Math.round(r.width), H: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
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

  const layout = useBoardLayout(size, center, nodes, edges);

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
  // Evidence already explains the selection; don't leave a duplicate tooltip over the portrait.
  const hovered = !activeEdge && layout?.strings.find((s) => s.e.id === (hover ?? focused));
  const anyHot = Boolean(hover || hoverNode || focused);
  const groupOf = (n: NodeCard) => n.edges;

  return (
    <>
    <div className="board-briefing" data-testid="board-briefing">{slip}</div>
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
            const n = nodes.find((x) => `${x.ref.kind}:${x.ref.id}` === p.id);
            const light = layout.lights.get(p.id);
            if (!n || !light) return null;
            const i = layout.strings.findIndex((s) => s.node === n);
            const isCase = caseNodes.has(n.ref.id);
            const wtag = n.edges.map(weakTag).find(Boolean) ?? null;
            const m = n.ref.kind === "member" ? book.members[n.ref.id] : null;
            const o = n.ref.kind === "org" ? book.orgs[n.ref.id] : null;
            const name = nodeName(n.ref, book);
            const says = n.edges.map((e) => tiePhrase(e, n.ref.id, centreName, range));
            const saysFull = n.edges.map((e) => tiePhrase(e, n.ref.id, centreName, range, true));
            const k = n.edges.length;
            const openLabel = `${name}${o ? `, ${ORG_KIND_LABEL[o.kind]}` : m ? `, ${seat(m)}` : ""}: ${saysFull.join("; ")}.${isCase ? ` Case: ${CASE_TAG_TEXT}.` : ""} Open the evidence${k > 1 ? ` for ${k} strings` : ""}.`;
            return (
              <div
                key={`${drawKey}-${p.id}`}
                className={`bcard bcard--${n.ref.kind}${name.length <= 22 ? " bcard--short" : ""}${n.ref.id === focusNode ? " is-focus" : ""}${hoverNode === p.id ? " is-hot" : ""}${excluded && n.edges.every((e) => excluded.has(e.id)) ? " is-excluded" : ""}`}
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
                      {wtag && <span className="tag tag--weak bcard__weak">{wtag}</span>}
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
                    {fuzz && !frayed && (
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
              const anim = !still && !done; // Release frozen SVG paths before later resizes/filter changes.
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
                  className={`yv yv--${style}${frayed ? " yv--frayed" : ""}${excluded?.has(e.id) ? " is-excluded" : ""}${hot ? " is-hot" : ""}${anyHot && !hot ? " is-dim" : ""}${focused === e.id ? " is-focus" : ""}`}
                  style={{ "--sx": light.sx, "--sy": light.sy, "--w": w } as React.CSSProperties}
                  aria-hidden="true"
                  data-edge-vis={e.id}
                >
                  <g mask={done ? undefined : `url(#reveal-${drawKey}-${e.id})`}>
                    {P("yv__halo", { style: { strokeWidth: w + 8 } })}
                    {frayed ? (
                      <FrayedYarn id={e.id} y={y} w={w} anim={anim} begin={begin} fibres={done ? (rich ? -1 : Math.round(y.length / 20) + 4) : 0} px={px} py={py} />
                    ) : (
                      <>
                        {P("yv__shadow-soft", { style: { strokeWidth: w + 4.5 } })}
                        {P("yv__shadow", { style: { strokeWidth: w + 0.6 } })}
                        <g className="yv__lift">
                          {fuzz && style !== "context" && P("yv__fuzz", { style: { strokeWidth: w + 2 }, filter: `url(#fz-${drawKey}-${e.id})` })}
                          {P("yv__core", { style: { strokeWidth: w } })}
                          {style !== "context" && (
                            <>
                              {P("yv__ply yv__ply--dark", { style: { strokeWidth: Math.max(0.5, w * 0.5) }, transform: `translate(${px} ${py})` })}
                              {P("yv__ply yv__ply--lite", { style: { strokeWidth: Math.max(0.45, w * 0.4) }, transform: `translate(${-px} ${-py})` })}
                            </>
                          )}
                        </g>
                      </>
                    )}
                  </g>
                </g>
              );
            })}

            {layout.placed.map((p) => {
              const pin = layout.pins.get(p.id) ?? { x: p.x + p.w / 2, y: p.y + 7 };
              const l = layout.lights.get(p.id);
              if (!l) return null;
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
    </>
  );
}
