"use client";
// The board's share of the shared view state (lib/domain/viewstate.ts): the year window and tie families it filters
// by, and the selected tie `e`. The URL is the source, so a change made on the case file or the full file arrives
// here, and a change made here is written back for them. Writing never adds a history entry except for a changed tie.
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Edge } from "@/lib/types";
import { FAMILIES, otherEnd, type Family } from "@/lib/domain/edges";
import { isEdgeId } from "@/lib/data/ids";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { currentView, updateView, useView } from "@/components/shared/useViewState";

/** What the board shows before the reader chooses: context ties are common, so they start off. */
export const BOARD_FAMILIES: Family[] = ["money", "holding", "people"];

export function useBoardFilters() {
  const view = useView();
  const families = useMemo(() => new Set<Family>(view.families ?? BOARD_FAMILIES), [view.families]);
  const range = useMemo<[number, number]>(() => view.years ?? [YEAR_MIN, YEAR_MAX], [view.years]);
  const setRange = useCallback((r: [number, number]) => updateView({ years: r[0] <= YEAR_MIN && r[1] >= YEAR_MAX ? null : r }), []);
  const toggleFamily = useCallback((f: Family) => {
    const next = new Set<Family>(currentView().families ?? BOARD_FAMILIES);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    const list = FAMILIES.filter((x) => next.has(x));
    const isDefault = list.length === BOARD_FAMILIES.length && list.every((x, i) => x === BOARD_FAMILIES[i]);
    updateView({ families: isDefault ? null : list });
  }, []);
  return { view, families, range, setRange, toggleFamily };
}

/** Write the selected tie (and, on a member board, its organisation) to the URL as a new history entry. */
export function writeSelectedEdge(e: Edge | null, selfId: string, memberBoard: boolean): void {
  if (!e) return updateView({ edge: null, ...(memberBoard ? { org: null } : {}) }, { push: true });
  if (!isEdgeId(e.id)) return; // org-board ties without a published id cannot be linked
  const o = otherEnd(e, selfId);
  updateView({ edge: e.id, ...(memberBoard ? { org: o.kind === "org" ? o.id : null } : {}) }, { push: true });
}

/**
 * Keep the drawer in step with the URL's `e`: open that string once the board's strings are loaded, close it when
 * the URL loses it (back button). `missing` is true when the URL names a tie the board does not draw.
 */
export function useSelectedEdge(strings: Edge[], open: Edge | null, show: (e: Edge) => void, hide: () => void, ready: boolean): { missing: boolean } {
  const view = useView();
  const had = useRef<string | null>(null);
  const found = useMemo(() => (view.edge ? strings.find((x) => x.id === view.edge) ?? null : null), [view.edge, strings]);
  useEffect(() => {
    const id = view.edge;
    if (!id) {
      if (had.current && open) hide();
      had.current = null;
      return;
    }
    had.current = id;
    if (open?.id === id) return;
    if (found) show(found);
    else if (open && ready) hide();
  }, [view.edge, found, open, ready, show, hide]);
  return { missing: Boolean(view.edge && ready && !found) };
}
