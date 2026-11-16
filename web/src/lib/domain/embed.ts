// The member embed card: which ties it shows and the complete HTML document (inline CSS, no scripts, no site chrome).
// The attribution footer (source link, data release, build date, disclaimer) is part of the template, not an option, so
// no query parameter can remove it. Pure; tests/embed.test.mjs loads it directly. Every data string is escaped.
import type { Edge, MemberFile, MemberSummary } from "../types.ts";
import { EMBED, SITE } from "../copy.ts";
import { amountText, count, date, NOT_DISCLOSED, PARTY_NAMES, rankAmount, releaseShort, seat } from "../format.ts";
import { isReleaseId } from "../data/release.ts";
import { memberHref, releaseMemberHref, siteUrl } from "../urls.ts";
import { isAgainst } from "./pick.ts";
import { typeLabel } from "./edges.ts";
import { escapeXml, oneLine } from "./escape.ts";

export type EmbedTheme = "light" | "dark";
export const EMBED_TIES = 3;

/** `?theme=` value to a theme: anything but "dark" is light. */
export function embedTheme(raw: string | null | undefined): EmbedTheme {
  return raw === "dark" ? "dark" : "light";
}

export type EmbedTie = { label: string; other: string; amount: string };

/** The largest filed ties, by disclosed amount (exact, else high, else low), then record count. Opposing spending and context ties are not shown. */
export function topTies(file: Pick<MemberFile, "edges" | "nodes">, memberId: string, n = EMBED_TIES): EmbedTie[] {
  const rank = (e: Edge) => rankAmount(e.amount) ?? -1;
  return file.edges
    .filter((e) => e.basis === "filed" && e.family !== "context" && !isAgainst(e))
    .sort((a, b) => rank(b) - rank(a) || b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((e) => {
      const end = e.from.id === memberId ? e.to : e.from;
      return { label: typeLabel(e), other: oneLine(file.nodes?.[end.id]?.name) || end.id, amount: amountText(e.amount) ?? NOT_DISCLOSED };
    });
}

export type EmbedInput = {
  member: Pick<MemberSummary, "id" | "name" | "party" | "state" | "chamber" | "district" | "counts">;
  ties: EmbedTie[];
  release: string | null;
  built: string | null;
  theme: EmbedTheme;
};

/** The case file this card cites: the permalink when a release is known, else the latest page. */
export function embedCaseFileUrl(id: string, release: string | null): string {
  return siteUrl(release && isReleaseId(release) ? releaseMemberHref(release, id) : memberHref(id));
}

const PALETTE: Record<EmbedTheme, string> = {
  light: "--bg:#f6f1e7;--fg:#1f1b17;--fg2:#4a443d;--rule:#cfc6b6;--link:#7a1e14;--tie:#b8321f;",
  dark: "--bg:#1d1916;--fg:#efe9df;--fg2:#c7bfb3;--rule:#4a443d;--link:#f0a79c;--tie:#e0553f;",
};

const STYLE = `*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{padding:14px 16px;border:1px solid var(--rule);min-height:100vh;display:flex;flex-direction:column;gap:10px}
.seat{margin:0;color:var(--fg2);font-size:13px}.party{display:inline-block;min-width:1.4em;padding:0 .3em;border:1px solid var(--fg2);border-radius:3px;text-align:center;font-weight:700}
h1{margin:2px 0 0;font-size:22px;line-height:1.2}h2{margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg2)}
.counts{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0}.counts div{display:flex;flex-direction:column}.counts dt{font-size:12px;color:var(--fg2)}.counts dd{margin:0;font-size:20px;font-weight:700}
ol{list-style:none;margin:0;padding:0}li{padding:4px 0 4px 10px;border-left:4px solid var(--tie);margin-bottom:6px}li span{display:block}.lab{font-weight:600}.amt{color:var(--fg2);font-size:13px}
footer{margin-top:auto;border-top:1px solid var(--rule);padding-top:8px;font-size:12px;color:var(--fg2)}footer p{margin:0 0 4px}a{color:var(--link);overflow-wrap:anywhere}a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}`;

/** The complete document for one card. Pure function of its input; every data string is escaped. */
export function buildEmbedHtml(i: EmbedInput): string {
  const m = i.member;
  const name = oneLine(m.name);
  const url = embedCaseFileUrl(m.id, i.release);
  const release = i.release && isReleaseId(i.release) ? releaseShort(i.release) : EMBED.latestBuild;
  const built = i.built ? date(i.built) : NOT_DISCLOSED;
  const n = (v: number | undefined) => (typeof v === "number" ? count(v) : NOT_DISCLOSED);
  const ties = i.ties.length
    ? `<ol>${i.ties.map((t) => `<li><span class="lab">${escapeXml(t.label)}: ${escapeXml(t.other)}</span><span class="amt">${escapeXml(t.amount)}</span></li>`).join("")}</ol>`
    : `<p>${escapeXml(EMBED.noTies)}</p>`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeXml(EMBED.frameTitle(name))}</title>`,
    `<style>:root{color-scheme:${i.theme};${PALETTE[i.theme]}}${STYLE}</style></head><body>`,
    `<main><article class="card" aria-labelledby="t">`,
    `<header><p class="seat">${escapeXml(seat(m))} · ${escapeXml(PARTY_NAMES[m.party] ?? "Independent")} <span class="party" aria-hidden="true">${escapeXml(m.party)}</span></p><h1 id="t">${escapeXml(name)}</h1></header>`,
    `<dl class="counts"><div><dt>${escapeXml(EMBED.counts.trades)}</dt><dd>${n(m.counts?.trades)}</dd></div><div><dt>${escapeXml(EMBED.counts.orgs)}</dt><dd>${n(m.counts?.orgs)}</dd></div><div><dt>${escapeXml(EMBED.counts.cases)}</dt><dd>${n(m.counts?.cases)}</dd></div></dl>`,
    `<section aria-labelledby="h"><h2 id="h">${escapeXml(EMBED.topTies)}</h2>${ties}</section>`,
    `<footer><p>${escapeXml(EMBED.source)} — <a href="${escapeXml(url)}" target="_blank" rel="noopener">${escapeXml(url.replace(/^https?:\/\//, ""))}</a> · ${escapeXml(EMBED.sourceLine(release, built))}</p><p>${escapeXml(EMBED.footerShort || SITE.disclaimer)}</p></footer>`,
    "</article></main></body></html>",
    "",
  ].join("");
}

/** The address of a member's card on this site: latest data, or fixed to a release; `?theme=dark` for the dark card. */
export function embedPath(p: { id: string; release?: string | null; theme?: EmbedTheme }): string {
  const path = p.release && isReleaseId(p.release) ? `/embed/r/${p.release}/m/${p.id}` : `/embed/m/${p.id}`;
  return path + (p.theme === "dark" ? "?theme=dark" : "");
}

/** The copyable `<iframe>` for one member: title, full width, a height that fits the card, no border. */
export function embedSnippet(p: { id: string; name: string; release?: string | null; theme?: EmbedTheme }): string {
  return `<iframe src="${escapeXml(SITE.url + embedPath(p))}" title="${escapeXml(EMBED.frameTitle(oneLine(p.name)))}" width="100%" height="${EMBED.height}" style="border:0;max-width:460px" loading="lazy"></iframe>`;
}
