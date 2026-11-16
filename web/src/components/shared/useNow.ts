"use client";
// The browser's clock as a React value that is null on the server and during hydration, then the current time,
// refreshed each minute. Lets a component add a time-dependent part (a relative age, a staleness banner) after
// hydration without a server/client text mismatch.
import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, MINUTE);
  return () => clearInterval(id);
}

// Rounded down to the minute so the snapshot is stable between ticks (useSyncExternalStore compares by value).
const snapshot = (): number => Math.floor(Date.now() / MINUTE) * MINUTE;
const server = (): null => null;

/** Epoch milliseconds, minute resolution; null until the page has hydrated. */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, snapshot, server);
}
