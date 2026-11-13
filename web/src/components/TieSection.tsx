"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Edge } from "@/lib/types";
import type { NameBook } from "@/lib/client";
import { FAMILIES, FAMILY_LABEL, sortEdges, type Family } from "@/lib/edges";
import { TieTable } from "./TieTable";
import { EvidenceDrawer } from "./EvidenceDrawer";

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
  const [families, setFamilies] = useState<Set<Family>>(() => new Set(FAMILIES));
  const [open, setOpen] = useState<Edge | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const cases = useMemo(() => new Set(caseEdges ?? []), [caseEdges]);
  const present = useMemo(() => FAMILIES.filter((f) => edges.some((e) => e.family === f)), [edges]);
  const shown = useMemo(() => sortEdges(edges.filter((e) => families.has(e.family))), [edges, families]);

  const close = useCallback(() => {
    setOpen(null);
    trigger.current?.focus();
  }, []);

  async function loadAll() {
    if (!fullUrl) return;
    setLoading(true);
    try {
      const r = await fetch(fullUrl);
      const body = (await r.json()) as { edges: Edge[] };
      setEdges(body.edges);
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
      {total != null && total > edges.length && fullUrl && (
        <p className="more">
          Showing the {edges.length} largest of {total} ties.{" "}
          <button type="button" className="btn btn--small" onClick={loadAll} disabled={loading}>
            {loading ? "Loading…" : `Show all ${total}`}
          </button>
        </p>
      )}
      <EvidenceDrawer edge={open} book={book} sources={sources} onClose={close} />
    </div>
  );
}
