// Every link the site builds: its own routes, the data files, official record pages,
// and the guard for links that come from the data. Pure; tests/urls.test.mjs loads it directly.

import { CORRECTIONS, SITE, STATUS } from "./copy.ts";
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

/** The data status page. */
export function statusHref(): string {
  return "/status";
}

/** GitHub's API address for the newest run of the daily-update workflow on main (server-side fetch on /status only). */
export function dailyRunApiUrl(): string {
  const slug = CORRECTIONS.repo.replace(/^https:\/\/github\.com\//, "");
  return `https://api.github.com/repos/${slug}/actions/workflows/${STATUS.workflow}/runs?branch=main&per_page=1`;
}

export function memberHref(id: string): string {
  return `/m/${id}`;
}

/** The site-wide disclosure-timing page. */
export function delaysHref(): string {
  return "/delays";
}

/** A member's RSS feed of new filings: "/feed/m/K000389.xml". */
export function memberFeedHref(id: string): string {
  return `/feed/m/${id}.xml`;
}

/** An organisation's RSS feed: "/feed/o/co%3A320193.xml" (the id is percent-encoded, as /o/ links are). */
export function orgFeedHref(id: string): string {
  return `/feed/o/${encodeURIComponent(id)}.xml`;
}

/** The trades-made-public-this-week page. */
export function newHref(): string {
  return "/new";
}

/** The page that lists what the reader follows (kept in their browser). */
export function watchHref(): string {
  return "/watch";
}

/** How to embed a member's card on another site. */
export function embedHelpHref(): string {
  return "/embed";
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

/** The release comparison for one member: "/changes?m=K000389&from=<release>&to=<release>" (the releases are optional). */
export function changesHref(member: string, from?: string | null, to?: string | null): string {
  const q = new URLSearchParams({ m: member });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return `/changes?${q.toString()}`;
}

export function orgHref(id: string): string {
  return `/o/${encodeURIComponent(id)}`;
}

/** The saved-boards page, with a share fragment (`#b=…`, see lib/domain/saved-share.ts) when it opens a shared board. */
export function savedHref(fragment = ""): string {
  return `/saved${fragment}`;
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

/** The absolute address of a site path (for citations that leave the site): siteUrl("/m/K000389") on the live site. */
export function siteUrl(path: string): string {
  return `${SITE.url}${path}`;
}

/** The connection finder: "/connect?a=<node>&b=<node>&h=2&d=1&hub=1". Only the options that differ from the defaults are written. */
export function connectHref(p: { a?: string | null; b?: string | null; hops?: number; derived?: boolean; hubs?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (p.a) q.set("a", p.a);
  if (p.b) q.set("b", p.b);
  if (p.hops && p.hops !== 2) q.set("h", String(p.hops));
  if (p.derived) q.set("d", "1");
  if (p.hubs) q.set("hub", "1");
  const s = q.toString();
  return s ? `/connect?${s}` : "/connect";
}
