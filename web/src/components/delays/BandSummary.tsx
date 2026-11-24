// The site-wide count per band as a table with a bar: numbers and words always visible, the bar is only a picture of them.
// Undated and negative lags are their own rows (never banded); amended overlaps and is noted apart. No colour carries meaning.
import { DELAYS } from "@/lib/copy";
import { DELAYS_AMEND } from "@/lib/copy-amend";
import { BAND_KEYS, overCount, overShare, share } from "@/lib/domain/delays";
import { count, days, percent } from "@/lib/format";
import type { DelayGroup } from "@/lib/types";

function Row({ label, note, n, total, kind }: { label: string; note?: string; n: number; total: number; kind: "band" | "apart" }) {
  const f = share(n, total);
  return (
    <tr className={kind === "apart" ? "dl-apart" : undefined}>
      <th scope="row">
        {label}
        {note && <span className="dl-note">{note}</span>}
      </th>
      <td className="dl-num mono">{count(n)}</td>
      <td className="dl-num mono">{percent(f)}</td>
      <td className="dl-barcell" aria-hidden="true">
        <span className={kind === "apart" ? "dl-bar dl-bar--apart" : "dl-bar"} style={{ width: `${Math.round((f ?? 0) * 1000) / 10}%` }} />
      </td>
    </tr>
  );
}

export function BandSummary({ g }: { g: DelayGroup }) {
  const over = overCount(g.bands);
  return (
    <section className="dl-sec" aria-labelledby="dl-bands">
      <h2 id="dl-bands">{DELAYS.bandsHeading}</h2>
      <p className="dl-sub">{g.date_corrected !== undefined ? DELAYS_AMEND.bandsNote : DELAYS_AMEND.bandsNoteOld}</p>
      <table className="dl-table dl-bands">
        <caption className="visually-hidden">Trades by days from transaction date to public availability</caption>
        <thead>
          <tr><th scope="col">Days</th><th scope="col" className="dl-num">Trades</th><th scope="col" className="dl-num">Share of all</th><th scope="col"><span className="visually-hidden">Bar</span></th></tr>
        </thead>
        <tbody>
          {BAND_KEYS.map((k) => (
            <Row key={k} label={DELAYS.bandLabels[k]} n={g.bands[k]} total={g.count} kind="band" />
          ))}
          <Row label={DELAYS.negativeLabel} note={DELAYS.negativeNote} n={g.negative} total={g.count} kind="apart" />
          <Row label={DELAYS.undatedLabel} note={DELAYS.undatedNote} n={g.undated} total={g.count} kind="apart" />
          {g.date_corrected !== undefined && <Row label={DELAYS_AMEND.label} note={DELAYS_AMEND.note} n={g.date_corrected} total={g.count} kind="apart" />}
        </tbody>
        <tfoot>
          <tr><th scope="row">All published trades</th><td className="dl-num mono">{count(g.count)}</td><td className="dl-num mono">{percent(share(g.count, g.count))}</td><td /></tr>
          <tr className="dl-apart"><th scope="row">{DELAYS.amendedLabel}<span className="dl-note">{DELAYS_AMEND.amendedNote}</span></th><td className="dl-num mono">{count(g.amended)}</td><td className="dl-num mono">{percent(share(g.amended, g.count))}</td><td /></tr>
        </tfoot>
      </table>
      <p className="dl-sub" data-testid="delays-over">
        {DELAYS.overLabel}: {count(over)} of {count(g.dated)} trades with both dates ({percent(overShare(over, g.dated))}). Median {days(g.median)}, 90th percentile {days(g.p90)}, longest {days(g.max)}.
      </p>
    </section>
  );
}
