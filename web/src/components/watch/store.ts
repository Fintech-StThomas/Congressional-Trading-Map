// The browser-side store for the watchlist: loads once from localStorage (through the pure adapter in
// lib/domain/watch-storage.ts), keeps the list in memory, writes every change back and tells React through
// useSyncExternalStore. When storage is blocked or a write fails it keeps working in memory and says so (`memory`).
// Uses the same storage probe as saved boards. Nothing here sends anything anywhere.
import { useEffect, useSyncExternalStore } from "react";
import { emptyWatchlist, type Watchlist } from "@/lib/domain/watchlist";
import { loadWatch, saveWatch, WATCH_KEY, type WatchStatus } from "@/lib/domain/watch-storage";
import { storage } from "@/components/saved/store";

export type WatchSnapshot = { ready: boolean; list: Watchlist; status: WatchStatus; memory: boolean };

const SERVER: WatchSnapshot = { ready: false, list: emptyWatchlist(), status: "empty", memory: false };
let snap: WatchSnapshot = SERVER;
const listeners = new Set<() => void>();

function emit(next: WatchSnapshot) {
  snap = next;
  listeners.forEach((l) => l());
}

function load() {
  const l = loadWatch(storage());
  emit({ ready: true, list: l.list, status: l.status, memory: l.status === "unavailable" });
}

/** Replaces the list and stores it. A failed write keeps the list in memory and sets the notice. */
export function setWatchlist(list: Watchlist) {
  if (!snap.ready) load();
  const r = saveWatch(storage(), list);
  emit({ ...snap, ready: true, list, status: snap.status === "corrupt" ? "ok" : snap.status, memory: snap.memory || !r.ok });
}

/** The list as it is now (loading it first when nothing has read it yet). */
export function currentWatchlist(): Watchlist {
  if (!snap.ready) load();
  return snap.list;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The followed list. Server render and first client render are the same empty, not-ready snapshot. */
export function useWatchlist(): WatchSnapshot {
  const s = useSyncExternalStore(subscribe, () => snap, () => SERVER);
  useEffect(() => {
    if (!snap.ready) load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCH_KEY || e.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return s;
}
