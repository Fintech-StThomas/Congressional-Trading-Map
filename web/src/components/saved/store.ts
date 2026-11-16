// The browser-side store for saved boards: loads once from localStorage (through the pure adapter), keeps the state
// in memory, writes every change back, and tells React through useSyncExternalStore. When storage is unavailable or
// a write fails it keeps working in memory and says so (`memory`). Nothing here sends anything anywhere.
import { useEffect, useSyncExternalStore } from "react";
import { emptyState, type Op, type SavedState } from "@/lib/domain/saved";
import { loadSaved, saveSaved, STORAGE_KEY, type KV, type LoadStatus } from "@/lib/domain/saved-storage";

export type Snapshot = { ready: boolean; state: SavedState; status: LoadStatus; memory: boolean; writeFailed: boolean };

const SERVER: Snapshot = { ready: false, state: emptyState(), status: { kind: "empty" }, memory: false, writeFailed: false };
let snap: Snapshot = SERVER;
let kv: KV | null | undefined;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snap = next;
  listeners.forEach((l) => l());
}

/** localStorage when it works (a probe write succeeds), else null: some private modes throw on access or on write. */
export function storage(): KV | null {
  if (kv !== undefined) return kv;
  try {
    const s = window.localStorage;
    s.setItem("pt.saved.probe", "1");
    s.removeItem("pt.saved.probe");
    kv = s;
  } catch {
    kv = null;
  }
  return kv;
}

export const nowIso = () => new Date().toISOString();

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  } catch {
    /* fall through */
  }
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function load() {
  const l = loadSaved(storage(), nowIso());
  emit({ ready: true, state: l.state, status: l.status, memory: l.status.kind === "unavailable", writeFailed: false });
}

/** Applies an operation to the current state and stores the result. Returns the operation's outcome. */
export function apply(f: (s: SavedState) => Op): Op {
  if (!snap.ready) load();
  const op = f(snap.state);
  if (op.ok && op.state !== snap.state) commit(op.state);
  return op;
}

/** Replaces the state (import, save a copy) and stores it. */
export function commit(state: SavedState) {
  const r = saveSaved(storage(), state);
  emit({ ...snap, ready: true, state, memory: snap.memory || !r.ok, writeFailed: !r.ok && storage() !== null });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The saved boards. Server render and first client render are the same empty, not-ready snapshot. */
export function useSaved(): Snapshot {
  const s = useSyncExternalStore(subscribe, () => snap, () => SERVER);
  useEffect(() => {
    if (!snap.ready) load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return s;
}
