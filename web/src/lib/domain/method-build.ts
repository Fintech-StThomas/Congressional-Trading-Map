// What /method and /status can say about the current build, from meta.json only: which kinds of tie it contains
// (counts.edges_by_type), which exclusions count rows that are kept, and notes worded in the site's own terms.
// Pure; tests/method-build.test.mjs loads it directly. Nothing here is hard-coded per build.
import { METHOD_AMEND } from "../copy-amend.ts";

export type ExclusionRow = { key: string; reason: string; rows: number };

function labelOf(k: string): string {
  return k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** meta.exclusions as rows: the object form (key: { reason, rows }) or the older list form (reason, count). */
export function exclusionRows(ex: unknown): ExclusionRow[] {
  if (Array.isArray(ex)) {
    return (ex as { reason?: unknown; count?: unknown }[]).map((x, i) => ({
      key: `list-${i}`, reason: typeof x?.reason === "string" ? x.reason : "", rows: typeof x?.count === "number" ? x.count : 0,
    }));
  }
  if (ex && typeof ex === "object") {
    return Object.entries(ex as Record<string, { reason?: unknown; rows?: unknown }>).map(([key, v]) => ({
      key, reason: typeof v?.reason === "string" && v.reason ? v.reason : labelOf(key), rows: typeof v?.rows === "number" ? v.rows : 0,
    }));
  }
  return [];
}

/** Excluded rows (left out of the data) apart from kept rows that are only counted (published, in every total). */
export function splitExclusions(ex: unknown): { excluded: ExclusionRow[]; kept: ExclusionRow[] } {
  const rows = exclusionRows(ex);
  const kept = new Set<string>(METHOD_AMEND.keptKeys);
  return { excluded: rows.filter((r) => !kept.has(r.key)), kept: rows.filter((r) => kept.has(r.key)) };
}

/** The tie kinds with at least one tie in this build, or null when meta.json does not say (then no kind is marked). */
export function typesInBuild(counts: unknown): Set<string> | null {
  const by = (counts as { edges_by_type?: unknown } | null | undefined)?.edges_by_type;
  if (!by || typeof by !== "object" || Array.isArray(by)) return null;
  return new Set(Object.entries(by as Record<string, unknown>).filter(([, n]) => typeof n === "number" && n > 0).map(([k]) => k));
}

/** A coverage note from the data in the site's own words: "late-filed" becomes the observed-days wording. */
export function siteTerms(note: string): string {
  return note
    .replace(/a few late-filed earlier trades still appear/gi, "a few earlier trades that were made public later still appear")
    .replace(/late-filed/gi, "made public after a long delay")
    .replace(/\bfiled late\b/gi, "made public over 45 days after the trade");
}
