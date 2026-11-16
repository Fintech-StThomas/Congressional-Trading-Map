// The research export: one JSON file ("paper-trail-export/1") holding exactly the published rows a researcher picked, the
// data file, release address and SHA-256 of every source file, the citation packet, attribution and the use notice.
// The rows are never rewritten here: `records` carries each file's parsed JSON as published, so the bundle can be
// checked against the files it names. Pure (the clock and the fetched bytes are passed in); tests/export.test.mjs loads it.
import { CITE, EXPORT, SITE, USE_NOTICE } from "../copy.ts";
import { date, releaseShort } from "../format.ts";
import { METHOD_VERSION } from "../method.ts";
import { isReleaseId } from "../data/release.ts";
import { isMemberId } from "../data/ids.ts";
import { DATA_BASE, siteUrl } from "../urls.ts";
import { buildViewCitation, type Citation, type SourceRef } from "./citation.ts";

export const EXPORT_SCHEMA = "paper-trail-export/1";
export const EXPORT_KINDS = ["ties", "trades", "holdings"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** The data file each kind comes from. */
export function kindPath(kind: ExportKind, memberId: string): string {
  return kind === "ties" ? `members/${memberId}.json` : `${kind}/${memberId}.json`;
}

/** Kinds from a request, in canonical order, without duplicates or unknown names. */
export function normalizeKinds(raw: readonly string[]): ExportKind[] {
  return EXPORT_KINDS.filter((k) => raw.includes(k));
}

/** A file as fetched: its parsed JSON (null when the file is not published), the SHA-256 of the bytes and their length. */
export type FetchedFile = { kind: ExportKind; json: unknown | null; sha256: string | null; bytes: number | null };

export type ExportFile = {
  kind: ExportKind;
  /** The data path inside a data tree (also inside a release). */
  path: string;
  /** Where the file is served: the permanent address when a release is known, else the latest data's (which moves with each build). */
  url: string;
  /** /releases/<id>/<path>: fixed bytes. Null when the data is not served from an archived release. */
  permanent_url: string | null;
  published: boolean;
  sha256: string | null;
  bytes: number | null;
};

export type ExportBundle = {
  schema: typeof EXPORT_SCHEMA;
  method_version: string;
  release: string | null;
  data_build: string | null;
  exported_at: string;
  site: { name: string; url: string };
  query: { member: { id: string; name: string }; kinds: ExportKind[]; filters: Record<string, never> };
  files: ExportFile[];
  records: Partial<Record<ExportKind, unknown>>;
  not_published: ExportKind[];
  attribution: string;
  hash_note: string;
  rows_note: string;
  permanence_note: string | null;
  notice: string;
  disclaimer: string;
  citation: Citation;
};

export type ExportInput = {
  member: { id: string; name: string };
  kinds: readonly string[];
  files: FetchedFile[];
  release: string | null;
  built: string | null;
  sources?: SourceRef[];
  /** ISO timestamp of the export; passed in so the builder stays pure. */
  exportedAt: string;
};

/** Build the bundle. Throws on an unusable member id or when no known kind is selected. */
export function buildExport(i: ExportInput): ExportBundle {
  if (!isMemberId(i.member.id)) throw new Error("not a member id");
  const kinds = normalizeKinds(i.kinds);
  if (!kinds.length) throw new Error("no record kind selected");
  const release = isReleaseId(i.release) ? i.release : null;
  const byKind = new Map(i.files.map((f) => [f.kind, f]));
  const files: ExportFile[] = kinds.map((kind) => {
    const f = byKind.get(kind);
    const path = kindPath(kind, i.member.id);
    const permanent = release ? siteUrl(`/releases/${release}/${path}`) : null;
    return {
      kind,
      path,
      url: permanent ?? siteUrl(`${DATA_BASE}/${path}`),
      permanent_url: permanent,
      published: f?.json != null,
      sha256: f?.sha256 ?? null,
      bytes: f?.bytes ?? null,
    };
  });
  const records: Partial<Record<ExportKind, unknown>> = {};
  for (const kind of kinds) {
    const json = byKind.get(kind)?.json ?? null;
    // Ties are the file's edges, ledger and ledger totals, exactly as published; the other kinds are the whole file.
    records[kind] = kind === "ties" && json && typeof json === "object" ? pickTies(json as Record<string, unknown>) : json;
  }
  const counts: Record<string, number | null> = {};
  for (const kind of kinds) counts[kind] = rowCount(kind, records[kind]);
  const citation = buildViewCitation({
    kind: "records",
    member: i.member,
    env: { release, built: i.built, retrieved: i.exportedAt, sources: i.sources },
    limitations: [],
    counts,
  });
  const rel = release ? CITE.releaseText(releaseShort(release)) : CITE.noReleaseText;
  return {
    schema: EXPORT_SCHEMA,
    method_version: METHOD_VERSION,
    release,
    data_build: i.built,
    exported_at: i.exportedAt,
    site: { name: SITE.name, url: SITE.url },
    query: { member: i.member, kinds, filters: {} },
    files,
    records,
    not_published: files.filter((f) => !f.published).map((f) => f.kind),
    attribution: CITE.attribution(rel, date(i.built), date(i.exportedAt)),
    hash_note: EXPORT.hashNote,
    rows_note: EXPORT.rowsUnmodified,
    permanence_note: release ? null : EXPORT.noRelease,
    notice: USE_NOTICE,
    disclaimer: SITE.disclaimer,
    citation,
  };
}

function pickTies(file: Record<string, unknown>): Record<string, unknown> {
  return { edges: file.edges ?? null, ledger: file.ledger ?? null, ledger_totals: file.ledger_totals ?? null };
}

/** Rows in a kind's records: edges, trade rows, or null when not countable (holdings are a nested document). Missing stays null, never 0. */
function rowCount(kind: ExportKind, rec: unknown): number | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  if (kind === "ties") return Array.isArray(r.edges) ? r.edges.length : null;
  if (kind === "trades") return Array.isArray(r.rows) ? r.rows.length : null;
  return null;
}

/** The SHA-256 of some bytes as 64 lowercase hex digits (Web Crypto, in the browser and in Node). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bundle as the file's text (stable key order, trailing newline). */
export function exportJson(b: ExportBundle): string {
  return JSON.stringify(b, null, 2) + "\n";
}

export function exportFilename(b: ExportBundle): string {
  return `paper-trail-export-${b.query.member.id}-${b.exported_at.slice(0, 10)}.json`;
}
