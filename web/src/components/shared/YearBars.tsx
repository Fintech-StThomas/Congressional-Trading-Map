import type { Edge } from "@/lib/types";
import { YEAR_MAX, YEAR_MIN } from "@/lib/site";
import { amountText } from "@/lib/format";

/** A tiny bar per year, 2000–2026. Height by money where filed, else by record count. */
export function YearBars({ e, range }: { e: Edge; range?: [number, number] }) {
  const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
  const byYear = new Map(e.by_year.map((b) => [b.y, b]));
  const useMoney = e.by_year.some((b) => (b.exact ?? b.high ?? b.low) != null);
  const val = (y: number) => {
    const b = byYear.get(y);
    if (!b) return 0;
    return useMoney ? (b.exact ?? b.high ?? b.low ?? 0) : b.n;
  };
  const max = Math.max(1, ...years.map(val));
  const W = 270, H = 40, gap = 2;
  const bw = (W - gap * (years.length - 1)) / years.length;
  const active = e.by_year.filter((b) => b.n > 0);
  const summary = active.length
    ? active.map((b) => `${b.y}: ${b.n} ${b.n === 1 ? "record" : "records"}${useMoney ? `, ${amountText(b) ?? "amount not disclosed"}` : ""}`).join("; ")
    : "No dated records";
  return (
    <figure className="yearbars">
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`By year. ${summary}`}>
        {years.map((y, i) => {
          const v = val(y);
          const h = v ? Math.max(2, (Math.sqrt(v) / Math.sqrt(max)) * H) : 0;
          const inRange = !range || (y >= range[0] && y <= range[1]);
          return (
            <g key={y}>
              <rect x={i * (bw + gap)} y={H - 1} width={bw} height={1} className="yearbars__base" />
              {v > 0 && (
                <rect x={i * (bw + gap)} y={H - h} width={bw} height={h} className={inRange ? "yearbars__bar" : "yearbars__bar is-out"}>
                  <title>{`${y}: ${byYear.get(y)?.n ?? 0} records`}</title>
                </rect>
              )}
            </g>
          );
        })}
        {[2000, 2012, 2026].map((y) => (
          <text key={y} x={(y - YEAR_MIN) * (bw + gap) + bw / 2} y={H + 12} textAnchor={y === 2000 ? "start" : y === 2026 ? "end" : "middle"} className="yearbars__tick">
            {y}
          </text>
        ))}
      </svg>
    </figure>
  );
}
