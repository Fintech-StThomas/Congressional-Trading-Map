import type { Meta, MetaSource } from "./types";

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
  for (const s of metaSources(meta)) out[s.id] = typeof s.name === "string" && s.name ? s.name : s.id;
  return out;
}
