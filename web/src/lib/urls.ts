// Every link the site builds: its own routes, the data files, official record pages,
// and the guard for links that come from the data. Pure; tests/urls.test.mjs loads it directly.

import { CORRECTIONS } from "./copy.ts";
import { clientRelease } from "./data/pin.ts";

/** Where the browser fetches data files from: /data (real build) or /sample-data (fixtures), set by next.config.ts. */
export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data";

/** A data file of one release, as the browser fetches it (pinned mode; next.config.ts proxies it to the bucket). */
export function releaseDataUrl(release: string, rel: string): string {
  return `/releases/${release}/${rel}`;
}

/** A generated JSON endpoint of one release: releaseRouteUrl(id, "board-data/CA") -> /r/<id>/board-data/CA. */
export function releaseRouteUrl(release: string, path: string): string {
  return `/r/${release}/${path}`;
}

/** A data file as the browser fetches it: from the release the page is pinned to (lib/data/pin.ts), else /data. */
export function dataUrl(rel: string): string {
  const release = clientRelease();
  return release ? releaseDataUrl(release, rel) : `${DATA_BASE}/${rel}`;
}

/** A generated JSON endpoint (/board-data/<state>, /board-member/<id>, /search-index) for the pinned release, else the latest one. */
export function routeDataUrl(path: string): string {
  const release = clientRelease();
  return release ? releaseRouteUrl(release, path) : `/${path}`;
}

/**
 * A new public GitHub issue for a correction, prefilled with the page, the data build and any record
 * details (edge type, both ends, record ids). `page` should be the full address the reader was on.
 */
export function correctionIssueUrl(p: { page: string; built: string | null; what?: string; details?: string[] }): string {
  const q = new URLSearchParams();
  q.set("title", CORRECTIONS.title(p.what ?? p.page));
  q.set("body", CORRECTIONS.body({ page: p.page, built: p.built, details: p.details }));
  q.set("labels", CORRECTIONS.label);
  return `${CORRECTIONS.repo}/issues/new?${q.toString()}`;
}

/** Every issue labelled correction: the public corrections log. */
export function correctionsLogUrl(): string {
  return `${CORRECTIONS.repo}/issues?q=${encodeURIComponent(`label:${CORRECTIONS.label}`)}`;
}

export function memberHref(id: string): string {
  return `/m/${id}`;
}

export function recordsHref(id: string): string {
  return `/m/${id}/records`;
}

/** The permalink of a member's case file in one data release (never replaced by the latest data). */
export function releaseMemberHref(release: string, id: string): string {
  return `/r/${release}/m/${id}`;
}

/** The permalink of a member's full file in one data release. */
export function releaseRecordsHref(release: string, id: string): string {
  return `/r/${release}/m/${id}/records`;
}

export function orgHref(id: string): string {
  return `/o/${encodeURIComponent(id)}`;
}

/** The board at a state, member, organisation and optional focused card: "/?s=CA&m=K000389". */
export function boardHref(params: { m?: string; s?: string; o?: string; focus?: string }): string {
  const q = new URLSearchParams();
  if (params.s) q.set("s", params.s);
  if (params.m) q.set("m", params.m);
  if (params.o) q.set("o", params.o);
  if (params.focus) q.set("focus", params.focus);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

/**
 * A link to the official record that can be built from an id alone: an FEC committee page
 * for `pac:C########` (a trailing `:support`/`:oppose` is ignored), SEC filings for `co:<CIK>`.
 */
export function recordUrlFor(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /^pac:(C\d{8})/.exec(id);
  if (m) return `https://www.fec.gov/data/committee/${m[1]}/`;
  const c = /^co:(\d+)$/.exec(id);
  if (c) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c[1]}`;
  return null;
}

/**
 * A URL from the data (evidence, filings, source pages) as an href, or null when it is not
 * plain http(s). Filings are public text and could hold anything; only web links become links.
 */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}
