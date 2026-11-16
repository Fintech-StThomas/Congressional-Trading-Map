// Unit tests for the member embed card (src/lib/domain/embed.ts) and the embed security headers
// (src/lib/security-headers.ts): top ties, escaping, mandatory attribution, theme, snippet, and the CSP rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildEmbedHtml, embedCaseFileUrl, embedPath, embedSnippet, embedTheme, topTies } from "../src/lib/domain/embed.ts";
import { contentSecurityPolicy, embedContentSecurityPolicy, embedHeaders, securityHeaders, EMBED_SOURCE, NOT_EMBED_SOURCE } from "../src/lib/security-headers.ts";
import { EMBED, SITE } from "../src/lib/copy.ts";

const REL = "cd".repeat(32);
const member = { id: "M000001", name: "Jane Q. Doe", party: "D", state: "CA", chamber: "sen", district: null, counts: { trades: 12, orgs: 7, members: 2, cases: 1 } };
const edge = (id, o = {}) => ({
  id, type: "pac_money", family: "money", basis: "filed", from: { kind: "org", id: "pac:C00000001" }, to: { kind: "member", id: "M000001" }, directed: true, via: null,
  amount: { low: null, high: null, exact: 1000 }, count: 1, note: null, ...o,
});
const file = {
  nodes: { "pac:C00000001": { name: "Big PAC", kind: "pac", ticker: null }, "co:2": { name: "Acme <Corp>", kind: "company", ticker: "ACME" }, "co:3": { name: "Small Co", kind: "company", ticker: null } },
  edges: [
    edge("e1"),
    edge("e2", { type: "traded", family: "holding", from: { kind: "member", id: "M000001" }, to: { kind: "org", id: "co:2" }, amount: { low: 15001, high: 50000, exact: null } }),
    edge("e3", { type: "owns", family: "holding", from: { kind: "member", id: "M000001" }, to: { kind: "org", id: "co:3" }, amount: { low: null, high: null, exact: null }, count: 4 }),
    edge("e4", { type: "oversees", family: "context", from: { kind: "member", id: "M000001" }, to: { kind: "org", id: "co:3" } }),
    edge("e5", { type: "outside_spending", via: { id: "pac:C9:oppose", name: "x" }, note: "oppose", amount: { low: null, high: null, exact: 999999 } }),
    edge("e6", { basis: "derived", type: "shared_donors", family: "money", amount: { low: null, high: null, exact: 5000000 } }),
  ],
};

test("top ties: largest disclosed amount first, ranges as displayed, opposing spending, context and statistical ties left out", () => {
  const t = topTies(file, "M000001");
  assert.deepEqual(t.map((x) => x.other), ["Acme <Corp>", "Big PAC", "Small Co"]);
  assert.equal(t[0].amount, "$15,001–$50,000");
  assert.equal(t[1].amount, "$1,000");
  assert.equal(t[2].amount, "not disclosed"); // missing is never zero
  assert.equal(t.length, 3);
  assert.equal(topTies({ edges: [], nodes: {} }, "M000001").length, 0);
});

test("the card: name, seat, party letter, counts, ties with labels, escaped data, built date", () => {
  const html = buildEmbedHtml({ member, ties: topTies(file, "M000001"), release: null, built: "2026-11-13T04:00:00Z", theme: "light" });
  assert.match(html, /^<!doctype html>/);
  for (const s of ["Jane Q. Doe", "Senator, California", "Democrat", ">12<", ">7<", ">1<", "Stock trades: Acme &lt;Corp&gt;", "$15,001–$50,000", "13 Nov 2026"]) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /<Corp>/);
  assert.doesNotMatch(html, /<script|javascript:|onerror|dangerouslySet/i);
});

test("attribution is part of the template: source link to the case file, release, build date, disclaimer, for every theme and with no ties", () => {
  for (const theme of ["light", "dark"])
    for (const ties of [topTies(file, "M000001"), []]) {
      const html = buildEmbedHtml({ member, ties, release: REL, built: "2026-11-13T04:00:00Z", theme });
      assert.match(html, /Source: Paper Trail — <a href="https:\/\/[^"]+\/r\/cdcd[a-f0-9]{60}\/m\/M000001"/);
      assert.ok(html.includes("data release cdcdcdcdcdcd · built 13 Nov 2026"));
      assert.ok(html.includes(SITE.disclaimer));
    }
  assert.ok(buildEmbedHtml({ member, ties: [], release: null, built: null, theme: "dark" }).includes("data release latest build · built not disclosed"));
  assert.equal(embedCaseFileUrl("M000001", null), `${SITE.url}/m/M000001`);
  assert.ok(buildEmbedHtml({ member, ties: [], release: null, built: null, theme: "light" }).includes(EMBED.noTies));
});

test("hostile names cannot break out of the card", () => {
  const evil = `"><script>alert(1)</script>&`;
  const html = buildEmbedHtml({ member: { ...member, name: evil }, ties: [{ label: evil, other: evil, amount: evil }], release: null, built: null, theme: "light" });
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;"));
});

test("theme: only 'dark' selects dark; the palette differs and the footer does not", () => {
  assert.equal(embedTheme("dark"), "dark");
  for (const v of ["light", "Dark", "", null, undefined, "x"]) assert.equal(embedTheme(v), "light");
  const a = buildEmbedHtml({ member, ties: [], release: null, built: null, theme: "light" });
  const b = buildEmbedHtml({ member, ties: [], release: null, built: null, theme: "dark" });
  assert.notEqual(a, b);
  assert.match(b, /color-scheme:dark/);
});

test("the iframe snippet has a title, full width and a height; the address is the latest or the release's", () => {
  const s = embedSnippet({ id: "M000001", name: `Jane "Q" Doe` });
  assert.match(s, /^<iframe src="https:\/\/[^"]+\/embed\/m\/M000001" title="Paper Trail member card: Jane &quot;Q&quot; Doe" width="100%" height="\d+"/);
  assert.equal(embedPath({ id: "M000001", release: REL }), `/embed/r/${REL}/m/M000001`);
  assert.equal(embedPath({ id: "M000001", theme: "dark" }), "/embed/m/M000001?theme=dark");
  assert.equal(embedPath({ id: "M000001", release: "bad" }), "/embed/m/M000001");
});

test("embed CSP: frames allowed from anywhere, but no scripts, connections, images, fonts, forms or base", () => {
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", VERCEL: "1" }, { NODE_ENV: "development" }]) {
    const csp = embedContentSecurityPolicy(env).split("; ");
    for (const d of ["default-src 'none'", "script-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors *", "style-src 'unsafe-inline'"]) assert.ok(csp.includes(d), d);
    assert.ok(!csp.some((x) => /^(script-src|connect-src|img-src|font-src|frame-src)/.test(x) && /'self'|unsafe-eval|https:/.test(x)));
  }
  assert.ok(embedContentSecurityPolicy({ VERCEL: "1" }).includes("upgrade-insecure-requests"));
});

test("embed headers: no X-Frame-Options, the embed CSP, nosniff and the other protections kept", () => {
  const h = Object.fromEntries(embedHeaders({ NODE_ENV: "production" }).map((x) => [x.key, x.value]));
  assert.equal(h["X-Frame-Options"], undefined);
  assert.match(h["Content-Security-Policy"], /frame-ancestors \*/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Cross-Origin-Resource-Policy"], "cross-origin");
  assert.ok(h["Referrer-Policy"] && h["Permissions-Policy"]);
  assert.equal(embedHeaders({}).filter((x) => x.key === "Content-Security-Policy").length, 1);
});

test("the main CSP and headers are unchanged: still no framing for every ordinary page", () => {
  const prod = contentSecurityPolicy({ NODE_ENV: "production", VERCEL: "1" });
  assert.equal(
    prod,
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  );
  const h = Object.fromEntries(securityHeaders({ NODE_ENV: "production" }).map((x) => [x.key, x.value]));
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["Cross-Origin-Resource-Policy"], "same-origin");
});

test("header sources: the embed rule covers /embed/<anything>; the main rule covers everything else, /embed help page included", () => {
  const { pathToRegexp } = createRequire(import.meta.url)("../node_modules/next/dist/compiled/path-to-regexp");
  const main = pathToRegexp(NOT_EMBED_SOURCE);
  const embed = pathToRegexp(EMBED_SOURCE);
  for (const p of ["/embed/m/K000001", "/embed/r/" + REL + "/m/K000001", "/embed/m/K000001/dark"]) assert.ok(embed.test(p) && !main.test(p), p);
  for (const p of ["/", "/embed", "/export", "/m/K000001", "/m/K000001/embed", "/feed/trades.xml", "/live/embed/m/K000001", "/about", "/embedded"]) assert.ok(main.test(p) && !embed.test(p), p);
});
