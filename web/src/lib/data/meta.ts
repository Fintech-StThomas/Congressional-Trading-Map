// Reads meta.json (build time, sources, publication budget), whose shape the contract leaves loose.
import type { Meta, MetaSource } from "../types.ts";

/** meta.json's sources as a list, whether the pipeline wrote an array or a map. */
export function metaSources(meta: Meta): MetaSource[] {
  const s = meta.sources;
  if (!s) return [];
  if (Array.isArray(s)) return s.filter((x): x is MetaSource => Boolean(x && typeof x === "object"));
  return Object.entries(s).map(([id, v]) => ({ id, ...(v as object) }) as MetaSource);
}

/** source id -> display name, for evidence lines. */
export function sourceNames(meta: Meta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of metaSources(meta)) out[s.id] = typeof s.name === "string" && s.name ? s.name.split(" (")[0] : s.id;
  return out;
}

/** Build date as an ISO string, from whichever key the pipeline used. */
export function metaBuilt(meta: Meta): string | null {
  const m = meta as Record<string, unknown>;
  const build = m.build as { time?: string } | undefined;
  const v = build?.time ?? meta.built ?? meta.build_time ?? m.generated_at ?? m.built_at;
  return typeof v === "string" ? v : null;
}

/** The Case rule's minimum number of tie types (meta.json publication_budget.case_min_types), 2 when absent. */
export function caseMinTypes(meta: Meta): number {
  const budget = (meta as Record<string, unknown>).publication_budget as { case_min_types?: unknown } | undefined;
  return typeof budget?.case_min_types === "number" ? budget.case_min_types : 2;
}
