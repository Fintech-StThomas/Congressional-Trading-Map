"use client";
// The shared view state (years, tie families, assumptions, selected tie and organisation, date basis) as the page's
// URL sees it. The URL is the single source: every component that calls the hook reads the same query string, and a
// change is written with history.replaceState (no history entry per keystroke) or, for a changed selected tie,
// pushState. Parsing and writing rules live in lib/domain/viewstate.ts; this file only wires them to the browser.
import { useMemo, useSyncExternalStore } from "react";
import { parseView, withView, type ViewState } from "@/lib/domain/viewstate";

/** Fired after the URL's view parameters change in place (replaceState and pushState do not fire popstate). */
export const VIEW_EVENT = "pt:viewchange";

function subscribe(onChange: () => void): () => void {
  for (const ev of ["popstate", VIEW_EVENT, "pt:locationchange"]) window.addEventListener(ev, onChange);
  return () => {
    for (const ev of ["popstate", VIEW_EVENT, "pt:locationchange"]) window.removeEventListener(ev, onChange);
  };
}
const snapshot = () => window.location.search;
const serverSnapshot = () => "";

/** The current view state from the URL (the default during server render and hydration). */
export function useView(): ViewState {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => parseView(search), [search]);
}

/** The view state as it is in the URL right now (for event handlers). */
export function currentView(): ViewState {
  return parseView(window.location.search);
}

/**
 * Change some of the view state in the URL, keeping every other parameter. `push` adds a history entry (used when
 * the selected tie changes); otherwise the entry is replaced. Keys left undefined in `patch` are untouched.
 */
export function updateView(patch: Partial<ViewState>, opts: { push?: boolean } = {}): void {
  const cur = currentView();
  const next: ViewState = { ...cur };
  for (const k of Object.keys(patch) as (keyof ViewState)[]) if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  const url = withView(window.location.pathname + window.location.search + window.location.hash, next, false);
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  if (opts.push) window.history.pushState(null, "", url);
  else window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(VIEW_EVENT));
}
