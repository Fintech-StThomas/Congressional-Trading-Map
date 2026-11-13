import type { StringStyle } from "@/lib/edges";

/** A short sample of a string's line style, used in the legend, chips and drawer. */
export function LineSample({ style, width = 28 }: { style: StringStyle; width?: number }) {
  return (
    <svg className={`linesample linesample--${style}`} viewBox={`0 0 ${width} 10`} width={width} height={10} aria-hidden="true">
      <path d={`M2 4 Q${width / 2} 9 ${width - 2} 4`} />
    </svg>
  );
}
