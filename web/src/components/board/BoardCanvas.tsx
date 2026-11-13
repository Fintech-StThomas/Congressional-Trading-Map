"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edge, NodeRef, OrgSummary } from "@/lib/types";
import type { MapGeometry } from "@/lib/geo";
import { arrange, yarn, type Rect } from "@/lib/layout";
import { TYPE_LABEL, amountLabel, filteredAmount, otherEnd, stringStyle, strokeWidth } from "@/lib/edges";
import { count, seat } from "@/lib/format";
import { nodeName, ORG_KIND_LABEL, type BoardMember, type NameBook } from "@/lib/client";
import { tiltFor } from "@/lib/hash";
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
  onOpenEdge: (e: Edge, el: Element) => void;
  onRecenter: (n: NodeRef) => void;
  slip: ReactNode;
  loading: boolean;
};

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type NodeCard = { ref: NodeRef; edges: Edge[]; order: number };

export function BoardCanvas(props: Props) {
  const { geo, counts, selectedState, onSelectState, center, edges, book, caseNodes, focusNode, drawKey, range, activeEdge, onOpenEdge, onRecenter, slip, loading } = props;
  const box = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  const [slipBox, setSlipBox] = useState<Rect | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

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
    const compact = W < 940;
    const cw = compact ? 158 : 184, ch = compact ? 58 : 64;
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
      const pin = { x: p.x + p.w / 2, y: p.y + 7 };
      return n.edges.map((e, j) => {
        const k = n.edges.length;
        const slack = 1 + (j - (k - 1) / 2) * 0.42;
        const shift = (j - (k - 1) / 2) * 7;
        return { e, node: n, y: yarn(centerRect, pin, slack, shift) };
      });
    });
    // Draw order: strongest string first, as the edges arrived.
    const orderOf = new Map(edges.map((e, i) => [e.id, i]));
    strings.sort((a, b) => orderOf.get(a.e.id)! - orderOf.get(b.e.id)!);
    return { W, H, centerRect, placed, pos, strings, cw, ch, compact };
  }, [size, center, nodes, edges, slipBox]);

  const backdrop = Boolean(center);
  const hovered = layout?.strings.find((s) => s.e.id === (hover ?? activeEdge));
  const anyHot = Boolean(hover || hoverNode);

  return (
    <div className={`canvas${center ? " has-center" : ""}`} ref={box} data-testid="board-canvas">
      <USMap geo={geo} counts={counts} selected={selectedState} backdrop={backdrop} onSelect={onSelectState} />
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
            const label = `${name}${o ? `, ${ORG_KIND_LABEL[o.kind]}` : m ? `, ${seat(m)}` : ""}. ${n.edges.length} ${n.edges.length === 1 ? "string" : "strings"}.${isCase ? " Case: three or more kinds of tie." : ""} Re-centre the board here.`;
            return (
              <button
                key={`${drawKey}-${p.id}`}
                type="button"
                className={`bcard bcard--${n.ref.kind}${n.ref.id === focusNode ? " is-focus" : ""}${hoverNode === p.id ? " is-hot" : ""}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h, "--tilt": `${tiltFor(n.ref.id, 1.4)}deg`, "--i": i } as React.CSSProperties}
                onClick={() => onRecenter(n.ref)}
                onMouseEnter={() => setHoverNode(p.id)}
                onMouseLeave={() => setHoverNode(null)}
                onFocus={() => setHoverNode(p.id)}
                onBlur={() => setHoverNode(null)}
                aria-label={label}
                data-node={n.ref.id}
              >
                {m ? (
                  <>
                    <Print id={m.id} name={m.name} photo={m.photo} size="xs" pinned={false} tilt={false} />
                    <span className="bcard__text">
                      <span className="bcard__name">{m.name}</span>
                      <span className="bcard__kind">
                        <PartyTag party={m.party} /> {seat(m, false)}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="bcard__text">
                    <span className="bcard__kind">
                      {o ? ORG_KIND_LABEL[o.kind] : "Organisation"}
                      {o?.ticker ? ` · ${o.ticker}` : ""}
                    </span>
                    <span className="bcard__name">{name}</span>
                  </span>
                )}
                {isCase && <span className="tag">Case</span>}
              </button>
            );
          })}

          <svg className="yarns" viewBox={`0 0 ${layout.W} ${layout.H}`} width={layout.W} height={layout.H} aria-label="Strings" role="group">
            <defs>
              {layout.strings.map(({ e, y }, i) => (
                <mask key={`${drawKey}-${e.id}`} id={`reveal-${drawKey}-${e.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.W} height={layout.H}>
                  <path d={y.d} pathLength={1} className="yarn__reveal" style={{ "--i": i } as React.CSSProperties} />
                </mask>
              ))}
            </defs>
            {layout.strings.map(({ e, y, node }) => {
              const style = stringStyle(e);
              const w = strokeWidth(e, range);
              const nodeKey = `${node.ref.kind}:${node.ref.id}`;
              const hot = hover === e.id || activeEdge === e.id || hoverNode === nodeKey;
              const amt = amountLabel(e, range);
              const n = filteredAmount(e, range).n;
              const name = nodeName(node.ref, book);
              return (
                <g
                  key={`${drawKey}-${e.id}`}
                  className={`yarn yarn--${style}${hot ? " is-hot" : ""}${anyHot && !hot ? " is-dim" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${TYPE_LABEL[e.type]}, ${name}: ${amt ?? "no amount disclosed"}, ${n} ${n === 1 ? "record" : "records"}${e.basis === "derived" ? ", derived" : ""}${e.weak ? ", thin evidence" : ""}. Open the evidence.`}
                  data-edge={e.id}
                  onMouseEnter={() => setHover(e.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(e.id)}
                  onBlur={() => setHover(null)}
                  onClick={(ev) => onOpenEdge(e, ev.currentTarget)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onOpenEdge(e, ev.currentTarget);
                    }
                  }}
                >
                  <path className="yarn__hit" d={y.d} />
                  <g mask={`url(#reveal-${drawKey}-${e.id})`}>
                    <path className="yarn__halo" d={y.d} style={{ strokeWidth: w + 7 }} />
                    <path className="yarn__under" d={y.d} style={{ strokeWidth: w + 1.6 }} transform="translate(0.6 1.8)" />
                    <path className="yarn__main" d={y.d} style={{ strokeWidth: w }} />
                    {style !== "context" && <path className="yarn__twist" d={y.d} style={{ strokeWidth: Math.max(0.6, w * 0.3) }} />}
                  </g>
                </g>
              );
            })}
            {layout.placed.map((p) => (
              <g key={`pin-${drawKey}-${p.id}`} className="pinhead" transform={`translate(${p.x + p.w / 2} ${p.y + 7})`} aria-hidden="true">
                <circle r="5.2" className="pinhead__shadow" cx="1.2" cy="2" />
                <circle r="5" className="pinhead__head" />
                <circle r="1.7" className="pinhead__glint" cx="-1.4" cy="-1.5" />
              </g>
            ))}
          </svg>

          {hovered && (
            <div
              className="yarnlabel"
              role="presentation"
              style={{
                left: Math.max(90, Math.min(layout.W - 90, hovered.y.mid.x)),
                top: Math.max(30, Math.min(layout.H - 20, hovered.y.mid.y)),
              }}
            >
              <span className="yarnlabel__type">{TYPE_LABEL[hovered.e.type]}</span>
              <span className="mono">{amountLabel(hovered.e, range) ?? "no amount"}</span>
              <span className="mono">
                {count(filteredAmount(hovered.e, range).n)} {filteredAmount(hovered.e, range).n === 1 ? "record" : "records"}
              </span>
            </div>
          )}
        </>
      )}

      <div className="canvas__slip" ref={slipRef}>
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
