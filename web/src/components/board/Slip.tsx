"use client";
// The paper slip pinned to the board: who or what is at the centre, how many strings are drawn
// and how many more ties exist, and (for the featured example) why it was chosen.
import Link from "next/link";
import { date, plural, seat, stateName } from "@/lib/format";
import { memberHref, orgHref } from "@/lib/urls";
import { PartyTag } from "@/components/shared/Print";
import type { Center } from "./BoardCanvas";
import type { Sel } from "./types";

export function Slip({
  sel, center, featured, onNextFeatured, asOf, shown, more, onClear, onState,
}: {
  sel: Sel; center: Center; featured: { reason: string; n: number; of: number } | null; onNextFeatured: (() => void) | null; asOf: string | null; shown: number; more: number;
  onClear: () => void; onState: (s: string) => void;
}) {
  if (center?.kind === "member") {
    const m = center.member;
    return (
      <div className="slip">
        {featured && (
          <p className="slip__kicker">
            <span className="stamp-label">Featured example</span>
            {asOf && <span className="mono">as of {date(asOf)}</span>}
          </p>
        )}
        <h2 className="slip__title">
          {m.name} <PartyTag party={m.party} />
        </h2>
        <p className="slip__sub">{seat(m)}</p>
        {featured && <p className="slip__why">{featured.reason}</p>}
        <p className="slip__meta">
          <span className="mono">{shown}</span> {shown === 1 ? "string" : "strings"}
          {more > 0 && (
            <>
              , plus <span className="mono">{more.toLocaleString("en-US")}</span> more {more === 1 ? "tie" : "ties"} in the full list
            </>
          )}{" "}
          · <Link href={memberHref(m.id)}>Open case file</Link>
          {featured ? (
            <>
              {" · "}
              <button type="button" className="linkbtn" onClick={() => onState(m.state)}>
                Browse {stateName(m.state)}
              </button>
              {featured && onNextFeatured && (
                <>
                  {" · "}
                  <button type="button" className="linkbtn slip__next" onClick={onNextFeatured} aria-label={`Show another featured example (${featured.n} of ${featured.of})`}>
                    Show another <span className="mono">{featured.n}/{featured.of}</span>
                  </button>
                </>
              )}
            </>
          ) : null}
        </p>
      </div>
    );
  }
  if (center?.kind === "org") {
    const o = center.org;
    return (
      <div className="slip">
        <h2 className="slip__title">{o.name}</h2>
        <p className="slip__sub">
          Tied to {plural(o.degree, "member")}. The {shown} largest {shown === 1 ? "tie is" : "ties are"} drawn
          {more > 0 ? `, plus ${more.toLocaleString("en-US")} more in the full list` : ""}.
        </p>
        <p className="slip__meta">
          <Link href={orgHref(o.id)}>Every tie to {o.name}</Link> ·{" "}
          <button type="button" className="linkbtn" onClick={onClear}>
            Back to the map
          </button>
        </p>
      </div>
    );
  }
  if (sel.s) {
    return (
      <div className="slip">
        <h2 className="slip__title">{stateName(sel.s)}</h2>
        <p className="slip__sub">Pick a member from the delegation to pull their strings.</p>
      </div>
    );
  }
  if (sel.m || sel.o) {
    return (
      <div className="slip">
        <p className="slip__sub">Pulling the records…</p>
      </div>
    );
  }
  return (
    <div className="slip slip--hint">
      <p className="slip__sub">
        <strong>Pick a state.</strong> Each number is its delegation. Then pick a member to see their ties and the filings behind them.
      </p>
    </div>
  );
}
