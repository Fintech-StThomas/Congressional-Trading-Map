import type { StringStyle } from "@/lib/edges";
import { frayed as fray } from "@/lib/fray";

/**
 * A short sample of a string, drawn the way the board draws it: a wool core with
 * twisted plies, or frayed (thinner, broken, loose fibres) for derived and weak
 * strings. Used in the legend, chips and drawer. Static: no filters.
 */
export function LineSample({ style, width = 28, scale = 1 }: { style: StringStyle; width?: number; scale?: number }) {
  const w = width;
  const d = `M2 4 Q${w / 2} 9 ${w - 2} 4`;
  const frayed = style === "derived" || style === "weak";
  if (frayed) {
    // The same worn-yarn geometry the board draws, at sample size.
    const f = fray(`legend-frayed-${w}`, { p0: { x: 2, y: 4 }, c: { x: w / 2, y: 9 }, p1: { x: w - 2, y: 4 }, length: Math.max(80, w * 2.6) }, 2.1, 1, Math.round(w / 2.2));
    return (
      <svg className={`linesample linesample--${style}`} viewBox={`0 0 ${w} 12`} width={w * scale} height={12 * scale} aria-hidden="true">
        <path className="linesample__shadowfill" d={f.core} transform="translate(0.4 1.4)" />
        <path className="linesample__corefill" d={f.core} />
        <path className="linesample__ply" d={f.plies} />
        <path className="linesample__thread" d={f.threads} />
        <path className="linesample__fibre" d={f.fibres + f.fibresFine} />
      </svg>
    );
  }
  return (
    <svg className={`linesample linesample--${style}`} viewBox={`0 0 ${w} 12`} width={w * scale} height={12 * scale} aria-hidden="true">
      <path className="linesample__shadow" d={d} transform="translate(0.4 1.4)" />
      <path className="linesample__core" d={d} />
      {style !== "context" && <path className="linesample__ply" d={d} />}
    </svg>
  );
}
