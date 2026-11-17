"use client";
// The evidence drawer: one tie's amount, years, rule, "what this does not show" and its filed records with links.
// Used by the board, the member page and the organisation page.
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Edge, NodeRef } from "@/lib/types";
import { CORRECTIONS, notShown, SITE } from "@/lib/copy";
import { BOARD_UI } from "@/lib/copy-ui";
import { CorrectionLink } from "./CorrectionLink";
import { weakTag, WEAK_WHY, typeLabel, TYPE_RULE, FAMILY_LABEL, filteredAmount, plainStat, stringStyle } from "@/lib/domain/edges";
import { amountText, count, date, NOT_DISCLOSED, plural } from "@/lib/format";
import { IS_SAMPLE_CLIENT } from "@/lib/data/fetch";
import { memberHref, orgHref, recordUrlFor, safeHttpUrl } from "@/lib/urls";
import { nodeName, type NameBook } from "@/lib/domain/names";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { YearBars } from "./YearBars";
import { LineSample } from "./LineSample";
import { ExternalIcon } from "./ExternalIcon";
import { TieCite } from "./TieCite";
import { TieSave } from "@/components/saved/Savers";
import { CoverageNote } from "./CoverageNote";
import { Explain } from "./Explain";
import { edgeFacts } from "@/lib/domain/coverage";

type Props = {
  edge: Edge | null;
  book: NameBook;
  sources: Record<string, string>;
  range?: [number, number];
  onClose: (restoreFocus?: boolean) => void;
  /** The full record is being fetched. */
  loading?: boolean;
  /** Every string to the same card, when the drawer was opened from a card. */
  siblings?: Edge[];
  onPick?: (e: Edge) => void;
};

function NodeLink({ n, book }: { n: NodeRef; book: NameBook }) {
  const name = nodeName(n, book);
  return n.kind === "member" ? <Link href={memberHref(n.id)}>{name}</Link> : <Link href={orgHref(n.id)}>{name}</Link>;
}

function LedgerOnly({ edge }: { edge: Edge }) {
  const org = [edge.from, edge.to].find((n) => n.kind === "org");
  const url = org && !IS_SAMPLE_CLIENT ? recordUrlFor(org.id) : null;
  return (
    <div className="drawer__ledger">
      <p>
        This tie comes from the summary ledger, which totals the filings without listing them one by one.
        {url ? " The committee's filings are on the official record:" : " Search the source for the organisation to read the filings."}
      </p>
      {url && (
        <a className="evidence__link" href={url} target="_blank" rel="noopener noreferrer">
          {url.includes("fec.gov") ? "Open the FEC committee page" : "Open the SEC filings"} <ExternalIcon />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}

export function EvidenceDrawer({ edge, book, sources, range, onClose, loading, siblings, onPick }: Props) {
  const ref = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const open = Boolean(edge);

  useEffect(() => {
    if (!open) return;
    if (!(document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("drawer__tab"))) titleRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, edge?.id, onClose]);

  useEffect(() => {
    if (!open) return;
    // This is a non-modal inspector: outside controls remain usable. Only dismiss
    // deliberate outside clicks, not a text selection dragged out of the drawer.
    let startedOutside = false;
    const outside = (event: Event) => event.target instanceof Node && !ref.current?.contains(event.target);
    const onPointerDown = (event: PointerEvent) => { startedOutside = event.button === 0 && outside(event); };
    const onClick = (event: MouseEvent) => {
      if (event.button === 0 && startedOutside && outside(event)) {
        // Switching view intentionally carries the selected tie to the next page.
        if (event.target instanceof Element && event.target.closest(".viewswitch a")) {
          startedOutside = false;
          return;
        }
        // A clicked search field, link or other control should keep its focus.
        const control = event.target instanceof Element && event.target.closest('a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
        onClose(!control);
      }
      startedOutside = false;
    };
    const onCancel = () => { startedOutside = false; };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointercancel", onCancel, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [open, onClose]);

  if (!edge) return null;
  const filtered = range && (range[0] > YEAR_MIN || range[1] < YEAR_MAX) ? range : undefined;
  const totals = filteredAmount(edge);
  const inRange = filtered ? filteredAmount(edge, filtered) : null;
  const style = stringStyle(edge);
  const shown = edge.evidence.length;
  const weak = weakTag(edge);

  return (
    <aside ref={ref} className="drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title" data-testid="evidence-drawer">
      <div className="drawer__bar">
        <span className="drawer__kicker">Evidence</span>
        <button type="button" className="iconbtn drawer__close" onClick={() => onClose()} aria-label={BOARD_UI.closeEvidenceHint}>
          <span>{BOARD_UI.closeEvidence}</span>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {siblings && siblings.length > 1 && onPick && (
        <div className="drawer__tabs" role="tablist" aria-label="Strings to this card">
          {siblings.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === edge.id}
              className="drawer__tab"
              onClick={() => onPick(s)}
              onKeyDown={(ev) => {
                if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
                ev.preventDefault();
                const i = siblings.findIndex((x) => x.id === s.id);
                const next = siblings[(i + (ev.key === "ArrowRight" ? 1 : siblings.length - 1)) % siblings.length];
                onPick(next);
                const tabs = (ev.currentTarget.parentElement?.children ?? []) as HTMLCollectionOf<HTMLElement>;
                tabs[siblings.indexOf(next)]?.focus();
              }}
            >
              <LineSample style={stringStyle(s)} width={18} />
              {typeLabel(s)}
              <span className="mono">{amountText(filteredAmount(s, range), true) ?? `${count(s.count)} rec.`}</span>
            </button>
          ))}
        </div>
      )}
      <div className="drawer__body">
        <h2 id="drawer-title" ref={titleRef} tabIndex={-1}>
          {typeLabel(edge)}
        </h2>
        <p className="drawer__ends">
          <NodeLink n={edge.from} book={book} />
          <span className="drawer__arrow" aria-label={edge.directed ? "to" : "and"}>{edge.directed ? " → " : " ↔ "}</span>
          <NodeLink n={edge.to} book={book} />
        </p>
        {edge.via && <p className="drawer__via">Through {edge.via.name}</p>}

        <ul className="marks" aria-label="How this string is drawn">
          <li>
            <LineSample style={style} />
            {edge.basis === "derived" ? <Explain term="statistical">Derived by a statistical rule</Explain> : "Filed record names both ends"}
          </li>
          {edge.weak && <li>Thin or incomplete evidence</li>}
          <li>{FAMILY_LABEL[edge.family]}</li>
        </ul>

        <dl className="facts">
          <div>
            <dt><Explain term="range">Amount</Explain></dt>
            <dd className="mono">{amountText(totals) ?? <span className="nd">{NOT_DISCLOSED}</span>}</dd>
          </div>
          <div>
            <dt>Records</dt>
            <dd className="mono">{count(edge.count)}</dd>
          </div>
          <div>
            <dt>First</dt>
            <dd className="mono">{date(edge.first)}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd className="mono">{date(edge.last)}</dd>
          </div>
        </dl>
        {!loading && (
          <div className="cite-save-row">
            <TieCite key={edge.id} edge={edge} names={{ from: nodeName(edge.from, book), to: nodeName(edge.to, book) }} sources={sources} range={range} ledgerOnly={shown === 0} />
            <TieSave key={`save-${edge.id}`} edge={edge} book={book} names={{ from: nodeName(edge.from, book), to: nodeName(edge.to, book) }} sources={sources} range={range} ledgerOnly={shown === 0} />
          </div>
        )}
        {inRange && filtered && (
          <p className="drawer__range mono">
            {filtered[0]}–{filtered[1]} only: {amountText(inRange) ?? NOT_DISCLOSED}, {plural(inRange.n, "record")}
          </p>
        )}

        {edge.by_year.length > 0 && (
          <>
            <h3>By year</h3>
            <YearBars e={edge} range={filtered} />
          </>
        )}

        {edge.stat && (
          <div className="stat">
            <h3>Why this derived string is drawn</h3>
            <p className="stat__plain">{plainStat(edge.stat)}</p>
            <p className="stat__meta">
              <span className="mono">{edge.stat.lift}×</span> the baseline
              {typeof edge.stat.p === "number" ? <>, p = <span className="mono">{edge.stat.p.toPrecision(2)}</span></> : null}. Method: {edge.stat.method}
            </p>
          </div>
        )}

        {edge.note && <p className="drawer__note">{edge.note}</p>}

        {!loading && <CoverageNote facts={edgeFacts(edge, shown === 0)} label="Coverage for this tie" testId="tie-coverage" />}

        <h3>What the record says</h3>
        <p className="drawer__rule">{TYPE_RULE[edge.type]}</p>
        {weak && (
          <p className="drawer__weak" data-testid="weak-why"><span className="tag tag--weak">{weak}</span> {WEAK_WHY[weak]}</p>
        )}
        <p className="notshown" data-testid="not-shown"><span className="notshown__k">What this does not show:</span> {notShown(edge.type)}</p>

        <h3>
          Records <span className="h-count mono">{shown < edge.evidence_total ? `${shown} of ${count(edge.evidence_total)}` : count(shown)}</span>
        </h3>
        {loading && <p className="drawer__loading" role="status">Fetching the records from the member&rsquo;s case file…</p>}
        {!loading && shown === 0 && <LedgerOnly edge={edge} />}
        <ol className="evidence">
          {edge.evidence.map((ev, i) => {
            const href = safeHttpUrl(ev.url);
            return (
            <li key={`${ev.record ?? "r"}-${i}`}>
              <p className="evidence__label">{ev.label}</p>
              <p className="evidence__meta mono">
                <span>{date(ev.date)}</span>
                <span>{sources[ev.source] ?? ev.source}</span>
                {ev.record && <span className="evidence__rec">{ev.record}</span>}
              </p>
              {href ? (
                <a className="evidence__link" href={href} target="_blank" rel="noopener noreferrer">
                  Open the official record <ExternalIcon />
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <p className="evidence__nolink">No public link for this record. Search the source by its record id.</p>
              )}
            </li>
            );
          })}
        </ol>
        {shown < edge.evidence_total && (
          <p className="drawer__more">
            The {count(edge.evidence_total - shown)} other records are in the same source filings; the largest and most recent are listed.
          </p>
        )}
        <p className="disclaimer">{SITE.disclaimer}</p>
        <p className="drawer__correct">
          <CorrectionLink
            what={`${typeLabel(edge)}, ${nodeName(edge.from, book)} and ${nodeName(edge.to, book)}`}
            details={[
              `Tie: ${edge.type} (${typeLabel(edge)}), edge ${edge.id}`,
              `From: ${nodeName(edge.from, book)} (${edge.from.kind} ${edge.from.id})`,
              `To: ${nodeName(edge.to, book)} (${edge.to.kind} ${edge.to.id})`,
              `Records: ${edge.evidence.map((ev) => ev.record).filter(Boolean).slice(0, 25).join(", ") || "none listed"}${edge.evidence_total > 25 ? ` (first 25 of ${edge.evidence_total})` : ""}`,
            ]}
          >
            {CORRECTIONS.recordLink}
          </CorrectionLink>
        </p>
      </div>
    </aside>
  );
}
