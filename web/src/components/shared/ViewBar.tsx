"use client";
// The filters every view of a member shares: the year window, which date trades are counted by, and a plain line
// saying what the page is filtered to (with a way to clear it). ViewPrintLine states the same on paper.
import "@/styles/view.css";
import { VIEW } from "@/lib/copy";
import { viewLine, viewNotes, yearsText } from "@/lib/domain/viewstate";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { YearRange } from "./YearRange";
import { updateView, useView } from "./useViewState";

/** Year window, date basis and the "filtered to" line. `showBasis` is off where no date basis applies. */
export function ViewBar({ showBasis = true, testId = "view-bar" }: { showBasis?: boolean; testId?: string }) {
  const view = useView();
  const years = view.years ?? ([YEAR_MIN, YEAR_MAX] as [number, number]);
  const clear = () => updateView({ years: null });
  return (
    <section className="viewbar no-print" aria-label="Filters for this view" data-testid={testId}>
      <div className="viewbar__row">
        <YearRange value={years} onChange={(r) => updateView({ years: r[0] <= YEAR_MIN && r[1] >= YEAR_MAX ? null : r })} />
        {showBasis && (
          <div className="viewbar__basis" role="group" aria-label={VIEW.basisLabel}>
            <span className="viewbar__k">{VIEW.basisLabel}</span>
            <button type="button" className="chip" aria-pressed={view.basis === "event"} title={VIEW.basisEventHint} onClick={() => updateView({ basis: "event" })} data-testid="basis-event">
              {VIEW.basisEvent}
            </button>
            <button type="button" className="chip" aria-pressed={view.basis === "public"} title={VIEW.basisPublicHint} onClick={() => updateView({ basis: "public" })} data-testid="basis-public">
              {VIEW.basisPublic}
            </button>
          </div>
        )}
      </div>
      {view.years && (
        <p className="viewbar__label" data-testid="view-filter-label" role="status">
          {VIEW.filtered(yearsText(view.years))} ·{" "}
          <button type="button" className="linkbtn" onClick={clear} aria-label={VIEW.clearAria} data-testid="view-clear-years">
            {VIEW.showAll}
          </button>
        </p>
      )}
      {showBasis && viewNotes(view).map((n) => (
        <p key={n} className="viewbar__note" data-testid="view-note">{n}</p>
      ))}
    </section>
  );
}

/** What the numbers on this page are limited to, printed (hidden on screen, where the controls say it). */
export function ViewPrintLine() {
  const view = useView();
  return (
    <p className="print-only view-printline" data-testid="view-print-line">
      {viewLine(view)}
      {viewNotes(view).map((n) => ` ${n}`)}
    </p>
  );
}
