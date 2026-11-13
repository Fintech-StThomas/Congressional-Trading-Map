"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Edge, NodeRef } from "@/lib/types";
import { typeLabel, TYPE_RULE, FAMILY_LABEL, filteredAmount, plainStat, stringStyle } from "@/lib/edges";
import { amountText, count, date, NOT_DISCLOSED } from "@/lib/format";
import { IS_SAMPLE_CLIENT, memberHref, nodeName, orgHref, type NameBook } from "@/lib/client";
import { recordUrlFor } from "@/lib/decode";
import { SITE, YEAR_MAX, YEAR_MIN } from "@/lib/site";
import { YearBars } from "./YearBars";
import { LineSample } from "./LineSample";

type Props = {
  edge: Edge | null;
  book: NameBook;
  sources: Record<string, string>;
  range?: [number, number];
  onClose: () => void;
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

export function ExternalIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M6 3H3.5A.5.5 0 0 0 3 3.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10M9 3h4v4M13 3 7.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

  if (!edge) return null;
  const filtered = range && (range[0] > YEAR_MIN || range[1] < YEAR_MAX) ? range : undefined;
  const totals = filteredAmount(edge);
  const inRange = filtered ? filteredAmount(edge, filtered) : null;
  const style = stringStyle(edge);
  const shown = edge.evidence.length;

  return (
    <aside ref={ref} className="drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title" data-testid="evidence-drawer">
      <div className="drawer__bar">
        <span className="drawer__kicker">Evidence</span>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close evidence (Escape)">
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
            {edge.basis === "derived" ? "Derived by a statistical rule" : "Filed record names both ends"}
          </li>
          {edge.weak && <li>Thin or incomplete evidence</li>}
          <li>{FAMILY_LABEL[edge.family]}</li>
        </ul>

        <dl className="facts">
          <div>
            <dt>Amount</dt>
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
        {inRange && filtered && (
          <p className="drawer__range mono">
            {filtered[0]}–{filtered[1]} only: {amountText(inRange) ?? NOT_DISCLOSED}, {count(inRange.n)} records
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
              {typeof (edge.stat as { p?: number }).p === "number" ? <>, p = <span className="mono">{(edge.stat as { p?: number }).p!.toPrecision(2)}</span></> : null}. Method: {edge.stat.method}
            </p>
            {edge.type === "traded_together" && <p className="stat__meta">Frequent traders overlap often; this is not evidence of coordination.</p>}
          </div>
        )}

        {edge.note && <p className="drawer__note">{edge.note}</p>}

        <h3>What the record says</h3>
        <p className="drawer__rule">{TYPE_RULE[edge.type]}</p>

        <h3>
          Records <span className="h-count mono">{shown < edge.evidence_total ? `${shown} of ${count(edge.evidence_total)}` : count(shown)}</span>
        </h3>
        {loading && <p className="drawer__loading" role="status">Fetching the records from the member&rsquo;s case file…</p>}
        {!loading && shown === 0 && <LedgerOnly edge={edge} />}
        <ol className="evidence">
          {edge.evidence.map((ev, i) => (
            <li key={`${ev.record ?? "r"}-${i}`}>
              <p className="evidence__label">{ev.label}</p>
              <p className="evidence__meta mono">
                <span>{date(ev.date)}</span>
                <span>{sources[ev.source] ?? ev.source}</span>
                {ev.record && <span className="evidence__rec">{ev.record}</span>}
              </p>
              {ev.url ? (
                <a className="evidence__link" href={ev.url} target="_blank" rel="noopener noreferrer">
                  Open the official record <ExternalIcon />
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                <p className="evidence__nolink">No public link for this record. Search the source by its record id.</p>
              )}
            </li>
          ))}
        </ol>
        {shown < edge.evidence_total && (
          <p className="drawer__more">
            The {count(edge.evidence_total - shown)} other records are in the same source filings; the largest and most recent are listed.
          </p>
        )}
        <p className="disclaimer">{SITE.disclaimer}</p>
      </div>
    </aside>
  );
}
