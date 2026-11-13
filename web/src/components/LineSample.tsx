import type { StringStyle } from "@/lib/edges";

/**
 * A short sample of a string, drawn the way the board draws it: a wool core with
 * twisted plies, or frayed (thinner, broken, loose fibres) for derived and weak
 * strings. Used in the legend, chips and drawer. Static: no filters.
 */
export function LineSample({ style, width = 28, scale = 1 }: { style: StringStyle; width?: number; scale?: number }) {
  const w = width;
  const d = `M2 4 Q${w / 2} 9 ${w - 2} 4`;
  const frayed = style === "derived" || style === "weak";
  // Two breaks in the frayed core, at fixed fractions of the length.
  const gap: { strokeDasharray?: string; pathLength?: number } = frayed ? { strokeDasharray: style === "weak" ? "34 7 59" : "56 8 36", pathLength: 100 } : {};
  return (
    <svg className={`linesample linesample--${style}`} viewBox={`0 0 ${w} 12`} width={w * scale} height={12 * scale} aria-hidden="true">
      <path className="linesample__shadow" d={d} transform="translate(0.4 1.4)" {...gap} />
      <path className="linesample__core" d={d} {...gap} />
      {style !== "context" && <path className="linesample__ply" d={d} {...gap} strokeDasharray={frayed ? gap.strokeDasharray : "1.3 2.2"} />}
      {frayed && (
        <path
          className="linesample__fibre"
          d={style === "weak" ? `M${w * 0.33} 6.4 q1.5 2.6 3.6 1.4 t3 2.2 M${w * 0.4} 6.9 l1.4 -2.6` : `M${w * 0.55} 7.1 q1.2 -2.8 3.4 -1.9 t2.8 -2.4 M${w * 0.6} 6.6 l1.6 2.5`}
        />
      )}
    </svg>
  );
}
