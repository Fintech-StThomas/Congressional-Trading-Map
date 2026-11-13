"use client";

import { memo } from "react";
import type { MapGeometry } from "@/lib/geo";
import { MAP_H, MAP_W } from "@/lib/geo";

type Props = {
  geo: MapGeometry;
  counts: Record<string, number>;
  selected: string | null;
  /** Map is a quiet backdrop behind a centred member or organisation. */
  backdrop: boolean;
  onSelect: (code: string) => void;
};

function zoomFor(geo: MapGeometry, code: string | null): string {
  if (!code) return "translate(0px, 0px) scale(1)";
  const s = geo.states.find((x) => x.code === code);
  if (!s) return "translate(0px, 0px) scale(1)";
  const [x0, y0, x1, y1] = s.box;
  const w = Math.max(40, x1 - x0), h = Math.max(30, y1 - y0);
  // Leave room on the left for the overlay slip.
  const k = Math.min(4.2, Math.min((MAP_W * 0.62) / w, (MAP_H * 0.66) / h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const tx = MAP_W * 0.56 - cx * k;
  const ty = MAP_H * 0.52 - cy * k;
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(3)})`;
}

/** The board's map: quiet state outlines and a delegation count per state. */
export const USMap = memo(function USMap({ geo, counts, selected, backdrop, onSelect }: Props) {
  const zoomed = Boolean(selected) && !backdrop;
  return (
    <svg
      className={`usmap${backdrop ? " is-backdrop" : ""}${zoomed ? " is-zoomed" : ""}`}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      preserveAspectRatio="xMidYMid meet"
      role={backdrop ? "presentation" : "group"}
      aria-label={backdrop ? undefined : "Map of the United States. Each state shows how many current members of Congress it has. Select a state to pin its delegation."}
    >
      <g className="usmap__zoom" style={{ transform: backdrop ? undefined : zoomFor(geo, selected) }}>
        {geo.nation && <path className="usmap__nation" d={geo.nation} />}
        {geo.states.map((s) => {
          const n = counts[s.code] ?? 0;
          const isSel = s.code === selected;
          const interactive = !backdrop && n > 0;
          return (
            <path
              key={s.code}
              d={s.d}
              className={`usmap__state${isSel ? " is-selected" : ""}${n ? "" : " is-empty"}`}
              tabIndex={interactive ? 0 : -1}
              role={interactive ? "button" : undefined}
              aria-pressed={interactive ? isSel : undefined}
              aria-label={interactive ? `${s.name}: ${n} current ${n === 1 ? "member" : "members"}` : undefined}
              data-state={s.code}
              onClick={interactive ? () => onSelect(s.code) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(s.code);
                      }
                    }
                  : undefined
              }
            />
          );
        })}
        {geo.borders && <path className="usmap__borders" d={geo.borders} />}
        <g className="usmap__labels" aria-hidden="true">
          {geo.states.map((s) => {
            const n = counts[s.code] ?? 0;
            if (!n) return null;
            return (
              <g key={s.code} className={s.code === selected ? "is-selected" : undefined}>
                {s.callout ? (
                  <>
                    <path className="usmap__leader" d={`M${s.cx} ${s.cy}L${s.lx - 21} ${s.ly - 4}`} />
                    <text x={s.lx - 18} y={s.ly} className="usmap__count usmap__count--callout">
                      <tspan className="usmap__code">{s.code}</tspan> {n}
                    </text>
                  </>
                ) : (
                  <text x={s.lx} y={s.ly} className="usmap__count">
                    {n}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
});
