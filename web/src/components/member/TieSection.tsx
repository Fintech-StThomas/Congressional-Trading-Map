"use client";
// "Ties" on the member page: family filters, the ties table, spending against kept apart, and the evidence drawer.
import { useCallback, useMemo, useRef, useState } from "react";
import type { Edge } from "@/lib/types";
import type { NameBook } from "@/lib/domain/names";
import { FAMILIES, FAMILY_LABEL, sortEdges, type Family } from "@/lib/domain/edges";
import { TieTable } from "@/components/shared/TieTable";
import { isAgainst } from "@/lib/domain/pick";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { getJSON } from "@/lib/data/fetch";

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
  const [families, setFamilies] = useState<Set<Family>>(() => new Set(FAMILIES));
  const [open, setOpen] = useState<Edge | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const cases = useMemo(() => new Set(caseEdges ?? []), [caseEdges]);
  const present = useMemo(() => FAMILIES.filter((f) => edges.some((e) => e.family === f)), [edges]);
  // Spending against the member is not a tie: listed in its own section below.
  const shown = useMemo(() => sortEdges(edges.filter((e) => families.has(e.family) && !isAgainst(e))), [edges, families]);
  const against = useMemo(() => sortEdges(edges.filter(isAgainst)), [edges]);

  const close = useCallback(() => {
    setOpen(null);
    trigger.current?.focus();
  }, []);

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
                onClick={() =>
                  setFamilies((prev) => {
                    const next = new Set(prev);
                    if (next.has(f)) next.delete(f);
                    else next.add(f);
                    return next;
                  })
                }
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
        onOpen={(e, t) => {
          trigger.current = t;
          setOpen(e);
        }}
        activeId={open?.id}
        caseEdges={cases}
        caption="Ties and their records"
        groupBy="family"
        emptyText="No ties in the selected families."
      />
      {against.length > 0 && (
        <div className="tablezone" data-testid="ties-against">
          <h3>Spent against this member</h3>
          <p className="section__note">Independent spending by groups opposing this member. Not a relationship with the member.</p>
          <TieTable edges={against} selfId={selfId} book={book} onOpen={(e, t) => { trigger.current = t; setOpen(e); }} activeId={open?.id} caption="Spent against this member" />
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
      <EvidenceDrawer edge={open} book={book} sources={sources} onClose={close} />
    </div>
  );
}
