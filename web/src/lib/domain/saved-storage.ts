// The storage adapter for saved boards: one localStorage key, every read and write guarded, unreadable data kept
// aside under a backup key and reported (never silently dropped), and a clear "unavailable" result so the page can
// carry on in memory with a visible notice. The storage object is passed in (an interface), so tests use a fake.
import { emptyState, validateSaved, SAVED_SCHEMA, type SavedState } from "./saved.ts";

export const STORAGE_KEY = "pt.saved.v1";
export const BACKUP_KEY_PREFIX = "pt.saved.v1.unreadable.";

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadStatus =
  | { kind: "empty" }
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "corrupt"; backupKey: string | null; errors: string[] };

export type Loaded = { state: SavedState; status: LoadStatus };

/** Reads the saved state. Data that does not validate is copied to `pt.saved.v1.unreadable.<time>` first, then
 *  the result is an empty state with a `corrupt` status; the original key is left alone until the next save. */
export function loadSaved(kv: KV | null, now: string): Loaded {
  if (!kv) return { state: emptyState(), status: { kind: "unavailable" } };
  let raw: string | null;
  try {
    raw = kv.getItem(STORAGE_KEY);
  } catch {
    return { state: emptyState(), status: { kind: "unavailable" } };
  }
  if (raw === null) return { state: emptyState(), status: { kind: "empty" } };
  const v = validateSaved(raw);
  if (v.ok) return { state: v.state, status: { kind: "ok" } };
  let backupKey: string | null = BACKUP_KEY_PREFIX + now.replace(/[^0-9]/g, "");
  try {
    kv.setItem(backupKey, raw);
    if (kv.getItem(backupKey) !== raw) backupKey = null;
  } catch {
    backupKey = null;
  }
  return { state: emptyState(), status: { kind: "corrupt", backupKey, errors: v.errors } };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Writes the whole state under the one key. A full or blocked store reports failure; it never throws. */
export function saveSaved(kv: KV | null, state: SavedState): SaveResult {
  if (!kv) return { ok: false, error: "storage unavailable" };
  try {
    kv.setItem(STORAGE_KEY, JSON.stringify({ schema: SAVED_SCHEMA, boards: state.boards }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

/** The kept-aside text of unreadable data, for a download; null when it cannot be read. */
export function readBackup(kv: KV | null, key: string): string | null {
  if (!kv || !key.startsWith(BACKUP_KEY_PREFIX)) return null;
  try {
    return kv.getItem(key);
  } catch {
    return null;
  }
}
