// Every link the site builds: its own routes, the data files, official record pages,
// and the guard for links that come from the data. Pure; tests/urls.test.mjs loads it directly.

/** Where the browser fetches data files from: /data (real build) or /sample-data (fixtures), set by next.config.ts. */
export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data";

export function dataUrl(rel: string): string {
  return `${DATA_BASE}/${rel}`;
}

export function memberHref(id: string): string {
  return `/m/${id}`;
}

export function recordsHref(id: string): string {
  return `/m/${id}/records`;
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
