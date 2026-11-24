// Which releases the /changes pickers render as options: the newest RELEASE_PICKER_CAP plus any currently selected
// release, so a list of thousands never becomes thousands of <option> elements; older ones are entered by id.
// Pure; tests/citation-page.test.mjs loads it.
import { RELEASE_PICKER_CAP } from "../copy-permalink.ts";
import { RELEASE_ID } from "../data/release.ts";
import type { ReleaseIndexEntry } from "./compare.ts";

/** The newest `cap` entries (the list is newest first) plus each selected release that is listed, in list order. */
export function pickerEntries(entries: readonly ReleaseIndexEntry[], selected: readonly (string | null)[], cap = RELEASE_PICKER_CAP): ReleaseIndexEntry[] {
  const keep = new Set(selected.filter((s): s is string => s !== null));
  return entries.filter((e, i) => i < cap || keep.has(e.release_id));
}

/** A pasted release id: "ok" with the lowercase id when it is 64 hex digits and listed, else why not. Whitespace around it is ignored. */
export function findListedRelease(entries: readonly ReleaseIndexEntry[], text: string): { status: "ok"; id: string } | { status: "notId" | "notListed" } {
  const id = text.trim().toLowerCase();
  if (!RELEASE_ID.test(id)) return { status: "notId" };
  return entries.some((e) => e.release_id === id) ? { status: "ok", id } : { status: "notListed" };
}
