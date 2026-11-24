"use client";
// "Activity by year" on the member page: trades and money records per year with data coverage shading. Trades are
// counted by one date at a time (transaction date as filed, or date made public: the shared view's `d`), the
// other date never mixes in; trades lacking the chosen date are counted apart. The shared year window dims the
// years outside it. Money records have only record years, so they do not change with the date basis.
import type { MemberFile } from "@/lib/types";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { coverWord, type YearSeries } from "@/lib/domain/money-years";
import { YEAR_CHART } from "@/lib/copy-member-totals";
import { VIEW } from "@/lib/copy";
import { isDefault } from "@/lib/domain/assume";
import { countByBasis, type YearCounts } from "@/lib/domain/datebasis";
import type { DateBasis } from "@/lib/domain/viewstate";
import { useAssumptionContext } from "@/components/shared/Assume";
import { useView } from "@/components/shared/useViewState";

type Coverage = MemberFile["coverage"];
type Props = { trades: Record<DateBasis, YearCounts>; money: YearSeries; coverage: Coverage; served: [string, string | null] };

const COVER_WORD = { full: "complete", partial: "partial", none: "no coverage in this build", "n/a": "no reports existed" } as const;

/**
 * Activity by year, YEAR_MIN to YEAR_MAX: trades reported and money records, with how
 * complete the underlying data is for each year. Trades before July 2012
 * cannot exist: the STOCK Act created the reports.
 */
export function Timeline({ trades, money, coverage, served }: Props) {
  const view = useView();
  const assumptions = useAssumptionContext();
  // Under assumptions the counts come from the trades that still count (loaded on demand by the assumption state).
  const counting = !isDefault(view.assume);
  const counts: YearCounts | null = counting ? (assumptions?.kept ? countByBasis(assumptions.kept, view.basis) : null) : trades[view.basis];
  const tradeByYear = counts?.byYear ?? {};
  const win = view.years;
  const inWin = (y: number) => !win || (y >= win[0] && y <= win[1]);
  const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
  const cov = new Map(coverage.map((c) => [c.year, c]));
  const maxT = Math.max(1, ...Object.values(tradeByYear));
  const maxM = Math.max(1, ...Object.values(money.records));
  const maxS = Math.max(1, ...Object.values(money.spanTies));
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
      <p className="timeline__axis" data-testid="timeline-axis">
        {view.basis === "public" ? VIEW.axisPublic : VIEW.axisEvent}. {VIEW.axisMoney}.
        {win ? ` ${VIEW.filtered(win[0] === win[1] ? String(win[0]) : `${win[0]}–${win[1]}`)}: other years are dimmed.` : ""}
      </p>
      <div className="timeline__grid" role="table" aria-label="Activity and data coverage by year">
        <div role="row" className="timeline__row timeline__row--years">
          <span role="rowheader" className="timeline__label">Year</span>
          {years.map((y) => (
            <span role="columnheader" key={y} className={`timeline__year${y < first || y > last ? " is-out" : ""}${win ? (inWin(y) ? " is-in" : " is-dim") : ""}`}>
              {y % 2 === 0 ? `’${String(y).slice(2)}` : ""}
              <span className="visually-hidden">{y}</span>
            </span>
          ))}
        </div>
        <Row label="Trades" years={years} value={(y) => tradeByYear[y] ?? 0} max={maxT} cover={tradeCover} unit="trades" dim={(y) => !inWin(y)} />
        <Row label={YEAR_CHART.moneyLabel} years={years} value={(y) => money.records[y] ?? 0} max={maxM} cover={moneyCover} unit={YEAR_CHART.moneyUnit} dim={(y) => !inWin(y)} />
        <Row label={YEAR_CHART.spanLabel} years={years} value={(y) => money.spanTies[y] ?? 0} max={maxS} cover={moneyCover} unit={YEAR_CHART.spanUnit} dim={(y) => !inWin(y)} />
      </div>
      {money.multiYearRecords > 0 && <p className="view-undated" data-testid="timeline-multiyear">{YEAR_CHART.multiYear(money.multiYearRecords)}</p>}
      {counting && !counts && <p className="view-undated" role="status">Loading the trades to apply the assumptions…</p>}
      {counts && counts.undated > 0 && (
        <p className="view-undated" data-testid="timeline-undated">{VIEW.undated(counts.undated, view.basis)}</p>
      )}
      {view.basis === "public" && <p className="view-undated" data-testid="timeline-public-note">{VIEW.publicNote}</p>}
      <ul className="timeline__key" aria-label="Coverage key">
        <li><span className="cov cov--full" /> complete</li>
        <li><span className="cov cov--partial" /> partial</li>
        <li><span className="cov cov--none" /> not covered in this build</li>
        <li>{String(YEAR_MAX)} is {YEAR_CHART.inProgress}</li>
        <li><span className="cov cov--na" /> no reports existed (trades before July 2012) or not in office</li>
      </ul>
    </div>
  );
}

function Row({ label, years, value, max, cover, unit, dim }: {
  label: string; years: number[]; value: (y: number) => number; max: number; cover: (y: number) => keyof typeof COVER_WORD; unit: string; dim: (y: number) => boolean;
}) {
  const word = (y: number, c: keyof typeof COVER_WORD) => coverWord(c, y, YEAR_MAX, COVER_WORD, YEAR_CHART.inProgress);
  return (
    <div role="row" className="timeline__row">
      <span role="rowheader" className="timeline__label">{label}</span>
      {years.map((y) => {
        const v = value(y);
        const c = cover(y);
        const cls = c === "n/a" ? "na" : c;
        return (
          <span role="cell" key={y} className={`timeline__cell cov--${cls}${dim(y) ? " is-dim" : ""}`} title={`${y}: ${v} ${unit}; data ${word(y, c)}`}>
            {v > 0 && <span className="timeline__bar" style={{ height: `${Math.max(10, (Math.sqrt(v) / Math.sqrt(max)) * 100)}%` }} />}
            <span className="visually-hidden">{`${y}: ${v} ${unit}, data ${word(y, c)}`}</span>
          </span>
        );
      })}
    </div>
  );
}
