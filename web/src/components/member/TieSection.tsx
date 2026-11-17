"use client";
// "Ties" on the member page: family filters, the ties table, spending against kept apart, and the evidence drawer.
// The year window, the family filter and the selected tie come from the shared view state in the URL, so they
// follow the reader between the board, this page and the full file.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge } from "@/lib/types";
import type { NameBook } from "@/lib/domain/names";
import { FAMILIES, FAMILY_LABEL, inYears, otherEnd, sortEdges, type Family } from "@/lib/domain/edges";
import { TieTable } from "@/components/shared/TieTable";
import { isAgainst } from "@/lib/domain/pick";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { getJSON } from "@/lib/data/fetch";
import { updateView, useView } from "@/components/shared/useViewState";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { FOLD_UI } from "@/lib/copy-ui";

/** Ties shown before "Show all". */
const FOLD = 12;

type Props = {
  edges: Edge[];
  selfId: string;
  book: NameBook;
  sources: Record<string, string>;
  caseEdges?: string[];
  /** Total ties, when `edges` is a capped subset. */
  total?: number;
  /** Where to load the full list when capped. */
  fullUrl?: string;
};

/** Ties grouped by family, with family filters and the evidence drawer. */
export function TieSection({ edges: initial, selfId, book: initialBook, sources, caseEdges, total, fullUrl }: Props) {
  const [edges, setEdges] = useState(initial);
  const [book] = useState(initialBook);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const view = useView();
  const families = useMemo(() => new Set<Family>(view.families ?? FAMILIES), [view.families]);
  const range = useMemo<[number, number]>(() => view.years ?? [YEAR_MIN, YEAR_MAX], [view.years]);
  // The selected tie is the URL's `e`; clicking Evidence writes it (a new history entry), closing clears it.
  const open = useMemo(() => (view.edge ? edges.find((e) => e.id === view.edge) ?? null : null), [view.edge, edges]);
  const trigger = useRef<HTMLElement | null>(null);
  const clicked = useRef<string | null>(null);
  const select = useCallback((e: Edge, t: HTMLElement) => {
    trigger.current = t;
    clicked.current = e.id;
    const o = otherEnd(e, selfId);
    updateView({ edge: e.id, org: o.kind === "org" ? o.id : null }, { push: true });
  }, [selfId]);
  const cases = useMemo(() => new Set(caseEdges ?? []), [caseEdges]);
  const present = useMemo(() => FAMILIES.filter((f) => edges.some((e) => e.family === f)), [edges]);
  // Spending against the member is not a tie: listed in its own section below.
  const shown = useMemo(() => sortEdges(edges.filter((e) => families.has(e.family) && !isAgainst(e) && inYears(e, range))), [edges, families, range]);
  const against = useMemo(() => sortEdges(edges.filter((e) => isAgainst(e) && inYears(e, range))), [edges, range]);

  const close = useCallback((restoreFocus = true) => {
    updateView({ edge: null, org: null }, { push: true });
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  // Arriving with `e` in the URL: bring that row into view (not when the reader just clicked it), and load the
  // whole list when the tie is not among the largest ones first listed.
  useEffect(() => {
    if (!view.edge) return;
    if (open) {
      if (clicked.current === view.edge) return;
      document.querySelector(`[data-edge="${view.edge}"]`)?.scrollIntoView({ block: "center" });
    } else if (fullUrl && !loading && !failed && total != null && total > edges.length) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.edge, open]);

  async function loadAll() {
    if (!fullUrl) return;
    setLoading(true);
    setFailed(false);
    try {
      const body = await getJSON<{ edges?: Edge[] }>(fullUrl);
      if (Array.isArray(body.edges)) setEdges(body.edges);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // A selected tie (the URL's `e`) is always reachable, so a selection opens the whole list.
  const folded = shown.length > FOLD && !all && !view.edge;
  return (
    <div className="tiesection">
      {present.length > 1 && (
        <div className="chips" role="group" aria-label="Show families">
          {present.map((f) => {
            const on = families.has(f);
            const n = edges.filter((e) => e.family === f).length;
            return (
              <button
                key={f}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(families);
                  if (next.has(f)) next.delete(f);
                  else next.add(f);
                  // All families on is the page's own default, so it is not written to the URL.
                  updateView({ families: next.size === FAMILIES.length ? null : FAMILIES.filter((x) => next.has(x)) });
                }}
              >
                {FAMILY_LABEL[f]} <span className="mono">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      <TieTable
        edges={shown}
        selfId={selfId}
        book={book}
        onOpen={select}
        range={view.years ?? undefined}
        activeId={open?.id}
        caseEdges={cases}
        caption="Ties and their records"
        groupBy="family"
        emptyText="No ties in the selected families."
        foldAfter={FOLD}
        folded={folded}
      />
      {shown.length > FOLD && (
        <p className="more more--fold no-print">
          <button type="button" className="btn btn--small" aria-expanded={!folded} onClick={() => setAll((a) => !a)} data-testid="ties-fold">
            {folded ? FOLD_UI.showAll(shown.length, "listed ties") : FOLD_UI.showFewer(FOLD, "ties")}
          </button>
        </p>
      )}
      {against.length > 0 && (
        <div className="tablezone" data-testid="ties-against">
          <h3>Spent against this member</h3>
          <p className="section__note">Independent spending by groups opposing this member. Not a relationship with the member.</p>
          <TieTable edges={against} selfId={selfId} book={book} range={view.years ?? undefined} onOpen={select} activeId={open?.id} caption="Spent against this member" />
        </div>
      )}
      {total != null && total > edges.length && fullUrl && (
        <p className="more">
          Showing the {edges.length} largest of {total} ties.{" "}
          <button type="button" className="btn btn--small" onClick={loadAll} disabled={loading}>
            {loading ? "Loading…" : `Show all ${total}`}
          </button>
          {failed && <span role="alert"> The full list failed to load; try again.</span>}
        </p>
      )}
      <EvidenceDrawer edge={open} book={book} sources={sources} range={view.years ?? undefined} onClose={close} />
    </div>
  );
}
