"use client";

import { useId } from "react";
import { YEAR_MAX, YEAR_MIN } from "@/lib/site";

type Props = { value: [number, number]; onChange: (v: [number, number]) => void };

/** Two-thumb year window built from two native range inputs. */
export function YearRange({ value, onChange }: Props) {
  const id = useId();
  const [a, b] = value;
  const pct = (y: number) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
  const all = a === YEAR_MIN && b === YEAR_MAX;
  return (
    <div className="yearrange" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="yearrange__label">
        Years <span className="mono">{a === b ? a : `${a}–${b}`}</span>
      </span>
      <span className="yearrange__track" style={{ "--a": `${pct(a)}%`, "--b": `${pct(b)}%` } as React.CSSProperties}>
        <input
          type="range"
          min={YEAR_MIN}
          max={YEAR_MAX}
          value={a}
          aria-label="From year"
          onChange={(e) => onChange([Math.min(Number(e.target.value), b), b])}
        />
        <input
          type="range"
          min={YEAR_MIN}
          max={YEAR_MAX}
          value={b}
          aria-label="To year"
          onChange={(e) => onChange([a, Math.max(Number(e.target.value), a)])}
        />
      </span>
      {!all && (
        <button type="button" className="linkbtn" onClick={() => onChange([YEAR_MIN, YEAR_MAX])}>
          All
        </button>
      )}
    </div>
  );
}
