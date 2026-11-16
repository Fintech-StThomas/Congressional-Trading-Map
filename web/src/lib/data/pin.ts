// The release the browser is pinned to. Every page renders <ReleasePin release=…/> (components/shared), which sets it
// during render, so data fetches made after render (and after client-side navigation) use the same release as the
// server-rendered HTML. null: the unpinned URLs (local and legacy remote modes). Module state, per browser tab.
// Pure, so node --test loads it. Never call setClientRelease on the server (ReleasePin guards that).
import { isReleaseId } from "./release.ts";

let current: string | null = null;

export function setClientRelease(id: string | null): void {
  if (id !== null && !isReleaseId(id)) throw new TypeError(`not a release id: ${JSON.stringify(id)}`);
  current = id;
}

export function clientRelease(): string | null {
  return current;
}
