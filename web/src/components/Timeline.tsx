import type { MemberFile } from "@/lib/types";
import type { TradeRow } from "@/lib/decode";
import { YEAR_MAX, YEAR_MIN } from "@/lib/site";

type Coverage = MemberFile["coverage"];
type Props = { trades: TradeRow[]; moneyByYear: Record<number, number>; coverage: Coverage; served: [string, string | null] };

const COVER_WORD = { full: "complete", partial: "partial", none: "no coverage in this build", "n/a": "no reports existed" } as const;

/**
 * Activity by year, 2000–2026: trades reported and money records, with how
 * complete the underlying data is for each year. Trades before July 2012
 * cannot exist: the STOCK Act created the reports.
 */
export function Timeline({ trades, moneyByYear, coverage, served }: Props) {
  const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
  const tradeByYear: Record<number, number> = {};
  for (const t of trades) {
    const y = Number(t.date?.slice(0, 4));
    if (y) tradeByYear[y] = (tradeByYear[y] ?? 0) + 1;
  }
  const cov = new Map(coverage.map((c) => [c.year, c]));
  const maxT = Math.max(1, ...Object.values(tradeByYear));
  const maxM = Math.max(1, ...Object.values(moneyByYear));
  const first = Number(served[0]?.slice(0, 4)) || YEAR_MIN;
  const last = served[1] ? Number(served[1].slice(0, 4)) : YEAR_MAX;

  const tradeCover = (y: number): keyof typeof COVER_WORD => {
    if (y < 2012) return "n/a";
    const c = cov.get(y)?.trades;
    return c ?? (y >= first && y <= last ? "none" : "n/a");
  };
  const moneyCover = (y: number): keyof typeof COVER_WORD => cov.get(y)?.money ?? "none";

  return (
    <div className="timeline">
      <div className="timeline__grid" role="table" aria-label="Activity and data coverage by year">
        <div role="row" className="timeline__row timeline__row--years">
          <span role="rowheader" className="timeline__label">Year</span>
          {years.map((y) => (
            <span role="columnheader" key={y} className={`timeline__year${y < first || y > last ? " is-out" : ""}`}>
              {y % 2 === 0 ? `’${String(y).slice(2)}` : ""}
              <span className="visually-hidden">{y}</span>
            </span>
          ))}
        </div>
        <Row label="Trades" years={years} value={(y) => tradeByYear[y] ?? 0} max={maxT} cover={tradeCover} unit="trades" />
        <Row label="Money records" years={years} value={(y) => moneyByYear[y] ?? 0} max={maxM} cover={moneyCover} unit="money records" />
      </div>
      <ul className="timeline__key" aria-label="Coverage key">
        <li><span className="cov cov--full" /> complete</li>
        <li><span className="cov cov--partial" /> partial</li>
        <li><span className="cov cov--none" /> not covered in this build</li>
        <li><span className="cov cov--na" /> no reports existed (trades before July 2012) or not in office</li>
      </ul>
    </div>
  );
}

function Row({ label, years, value, max, cover, unit }: {
  label: string; years: number[]; value: (y: number) => number; max: number; cover: (y: number) => keyof typeof COVER_WORD; unit: string;
}) {
  return (
    <div role="row" className="timeline__row">
      <span role="rowheader" className="timeline__label">{label}</span>
      {years.map((y) => {
        const v = value(y);
        const c = cover(y);
        const cls = c === "n/a" ? "na" : c;
        return (
          <span role="cell" key={y} className={`timeline__cell cov--${cls}`} title={`${y}: ${v} ${unit}; data ${COVER_WORD[c]}`}>
            {v > 0 && <span className="timeline__bar" style={{ height: `${Math.max(10, (Math.sqrt(v) / Math.sqrt(max)) * 100)}%` }} />}
            <span className="visually-hidden">{`${y}: ${v} ${unit}, data ${COVER_WORD[c]}`}</span>
          </span>
        );
      })}
    </div>
  );
}
