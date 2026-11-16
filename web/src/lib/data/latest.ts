// Has newer data been published since this page loaded? The rules for the "Newer data available" note and for the
// permalink note's "which release is the latest": a 30-minute poll budget, the pointer read, and the build-time
// comparison. Pure apart from the injected fetch, so node --test loads it. Browser-side only in practice.
import { metaBuilt } from "./meta.ts";
import { parsePointer, RELEASE_POINTER_PATH } from "./release.ts";

/** At most one check per this many milliseconds, and only while the tab is visible. */
export const POLL_INTERVAL_MS = 30 * 60 * 1000;
/** A page stops checking after this many checks (about six hours of open, visible time). */
export const MAX_CHECKS = 12;

export type PollState = { now: number; lastCheck: number; checks: number; visible: boolean };

/** "check" now, "wait" (not due, or the tab is hidden), or "stop" (the budget is spent). */
export function decidePoll(s: PollState): "check" | "wait" | "stop" {
  if (s.checks >= MAX_CHECKS) return "stop";
  if (!s.visible) return "wait";
  return s.now - s.lastCheck >= POLL_INTERVAL_MS ? "check" : "wait";
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The latest release id from the same-origin pointer (pinned mode). Throws when it cannot be read or is malformed. */
export async function loadLatestRelease(fetchFn: Fetch): Promise<string> {
  const res = await fetchFn(RELEASE_POINTER_PATH);
  if (!res.ok) throw new Error(`${res.status} ${RELEASE_POINTER_PATH}`);
  return parsePointer(await res.json()).release_id;
}

/**
 * True when what the server publishes now differs from what this page loaded. Pinned (`baseline.release` set): the
 * pointer's release id. Otherwise meta.json's build time at `metaUrl`. An unknown baseline or an unreadable build time
 * is never reported as "newer". Throws on a failed request (the caller counts the check and moves on).
 */
export async function newerDataPublished(baseline: { release: string | null; built: string | null }, metaUrl: string, fetchFn: Fetch): Promise<boolean> {
  if (baseline.release) return (await loadLatestRelease(fetchFn)) !== baseline.release;
  if (!baseline.built) return false;
  const res = await fetchFn(metaUrl);
  if (!res.ok) throw new Error(`${res.status} ${metaUrl}`);
  const built = metaBuilt((await res.json()) as Parameters<typeof metaBuilt>[0]);
  return built !== null && built !== baseline.built;
}
