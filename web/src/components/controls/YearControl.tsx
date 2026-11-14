"use client";

import { useEffect, useRef, useState } from "react";

export const PLAY_MS = 900;

/**
 * One year or all years: "All years" chip, step back, a slider, step forward,
 * and play/pause that advances a year every PLAY_MS and stops at the end.
 */
export function YearControl({ year, min, max, onChange, busy }: {
  year: number | null; min: number; max: number; onChange: (y: number | null) => void; busy?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const yRef = useRef(year);
  useEffect(() => {
    yRef.current = year;
  }, [year]);

  useEffect(() => {
    if (!playing || busy) return;
    const t = window.setInterval(() => {
      const y = yRef.current;
      if (y === null || y >= max) {
        setPlaying(false);
        return;
      }
      onChange(y + 1);
    }, PLAY_MS);
    return () => window.clearInterval(t);
  }, [playing, busy, max, onChange]);

  const v = year ?? max;
  const step = (d: number) => {
    setPlaying(false);
    onChange(Math.min(max, Math.max(min, (year ?? (d < 0 ? max + 1 : min - 1)) + d)));
  };
  return (
    <div className="yearctl" role="group" aria-label="Year">
      <button type="button" className="chip" aria-pressed={year === null} onClick={() => { setPlaying(false); onChange(null); }}>
        All years
      </button>
      <div className={`yearctl__track${year === null ? " is-all" : ""}`}>
        <button type="button" className="iconbtn" aria-label={playing ? "Pause" : `Play the years from ${year === null || year >= max ? min : year}`} onClick={() => {
          if (playing) return setPlaying(false);
          if (year === null || year >= max) onChange(min);
          setPlaying(true);
        }}>
          {playing ? (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 1.5l7 4.5-7 4.5z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="iconbtn" aria-label="Previous year" disabled={year !== null && year <= min} onClick={() => step(-1)}>
          <svg viewBox="0 0 8 12" width="7" height="11" aria-hidden="true"><path d="M6 1L2 6l4 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <input
          type="range"
          className="yearctl__range"
          min={min}
          max={max}
          step={1}
          value={v}
          aria-label="Year"
          aria-valuetext={year === null ? "All years" : String(year)}
          onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)); }}
        />
        <button type="button" className="iconbtn" aria-label="Next year" disabled={year !== null && year >= max} onClick={() => step(1)}>
          <svg viewBox="0 0 8 12" width="7" height="11" aria-hidden="true"><path d="M2 1l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
        <output className="yearctl__out mono" aria-live="polite">{busy ? "…" : year ?? "All"}</output>
      </div>
    </div>
  );
}
