// /cases pagination and filters (lib/domain/casepages.ts), the correction issue link (lib/urls.ts)
// and the DATA_BASE_URL rule (lib/data/remote.ts). No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allCasePaths, CASES_PER_PAGE, casesHref, casesSlug, comboOf, pageOf, pageWindow, parseCasesPath } from "../src/lib/domain/casepages.ts";
import { correctionIssueUrl, correctionsLogUrl } from "../src/lib/urls.ts";
import { remoteDataBase, remoteFileUrl, remoteRewrite } from "../src/lib/data/remote.ts";
import { sampleFallbackError } from "../src/lib/data/source.ts";

const members = new Map([
  ["A", { chamber: "rep", party: "D" }],
  ["B", { chamber: "sen", party: "R" }],
]);
const cases = Array.from({ length: 120 }, (_, i) => ({
  id: `c${i}`, member: i % 3 === 0 ? "B" : "A", org: `o${i}`,
  types: i % 4 === 0 ? ["owns", "pac_money"] : i % 2 ? ["traded", "pac_money"] : ["traded", "owns", "pac_money"],
}));

test("tie combinations are the sorted types sets", () => {
  assert.equal(comboOf(["traded", "pac_money"]), "trade-pac");
  assert.equal(comboOf(["pac_money", "owns", "traded"]), "holding-trade-pac");
  assert.equal(comboOf(["owns", "pac_money"]), "holding-pac");
  assert.equal(comboOf(["owns"]), null);
});

test("paths round-trip in one canonical order; anything else is not a cases path", () => {
  for (const q of [{ page: 1 }, { page: 3 }, { ties: "trade-pac", page: 1 }, { ties: "holding-pac", chamber: "senate", party: "r", page: 2 }, { party: "i", page: 1 }]) {
    const href = casesHref(q);
    assert.deepEqual(parseCasesPath(casesSlug(q)), q, href);
  }
  assert.equal(casesHref({ page: 1 }), "/cases");
  assert.equal(casesHref({ page: 3 }), "/cases/page/3");
  assert.equal(casesHref({ party: "r", ties: "trade-pac", page: 2 }), "/cases/ties/trade-pac/party/r/page/2");
  for (const bad of [["page"], ["page", "1"], ["page", "0"], ["page", "x"], ["party", "r", "ties", "trade-pac"], ["ties", "nope"], ["foo", "bar"], ["page", "2", "page", "3"]])
    assert.equal(parseCasesPath(bad), null, bad.join("/"));
});

test("a page holds 50 cases, keeps the global rank, and counts within the filter", () => {
  const p1 = pageOf(cases, members, { page: 1 });
  assert.equal(p1.rows.length, CASES_PER_PAGE);
  assert.equal(p1.pages, 3);
  assert.deepEqual([p1.first, p1.last, p1.total], [1, 50, 120]);
  const p3 = pageOf(cases, members, { page: 3 });
  assert.deepEqual([p3.first, p3.last, p3.rows[0].rank], [101, 120, 101]);
  const sen = pageOf(cases, members, { chamber: "senate", page: 1 });
  assert.equal(sen.total, 40);
  assert.ok(sen.rows.every(({ c }) => c.member === "B"));
  assert.deepEqual(sen.rows.slice(0, 2).map((r) => r.rank), [1, 4], "rank in the full ranking");
  assert.equal(pageOf(cases, members, { party: "i", page: 1 }).total, 0);
});

test("static paths cover every non-empty filter and page, and nothing else", () => {
  const paths = allCasePaths(cases, members);
  assert.equal(paths.filter((q) => !q.ties && !q.chamber && !q.party).length, 3);
  assert.ok(!paths.some((q) => q.party === "i"), "no empty filters");
  for (const q of paths) assert.ok(pageOf(cases, members, q).rows.length > 0, casesHref(q));
});

test("page window: first, last and two either side", () => {
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(6, 50), [1, null, 4, 5, 6, 7, 8, null, 50]);
});

test("correction link: a new public issue with the page, the build, the record and the label", () => {
  const u = new URL(correctionIssueUrl({ page: "https://x.test/m/A1?as=own", built: "2026-11-14T06:00:00Z", what: "PAC money, A and B", details: ["Tie: pac_money, edge e1", "Records: r1, r2"] }));
  assert.equal(u.origin + u.pathname, "https://github.com/Fintech-StThomas/Congressional-Trading-Map/issues/new");
  assert.equal(u.searchParams.get("labels"), "correction");
  assert.equal(u.searchParams.get("title"), "Correction: PAC money, A and B");
  const body = u.searchParams.get("body");
  for (const s of ["Page: https://x.test/m/A1?as=own", "Data build: 2026-11-14T06:00:00Z", "Tie: pac_money, edge e1", "Records: r1, r2", "What is wrong", "What the filing says", "Link to the filing"])
    assert.ok(body.includes(s), s);
  assert.match(correctionsLogUrl(), /\/issues\?q=label%3Acorrection$/);
});

test("DATA_BASE_URL: unset is local mode; set is normalised; malformed fails loudly", () => {
  assert.equal(remoteDataBase(undefined), null);
  assert.equal(remoteDataBase("  "), null);
  assert.equal(remoteDataBase("https://pub-x.r2.dev/data/"), "https://pub-x.r2.dev/data");
  assert.throws(() => remoteDataBase("pub-x.r2.dev/data"));
  assert.throws(() => remoteDataBase("ftp://x/data"));
  assert.equal(remoteFileUrl("https://h/data", "members/A1.json"), "https://h/data/members/A1.json");
  assert.deepEqual(remoteRewrite("https://h/data"), { source: "/data/:path*", destination: "https://h/data/:path*" });
});

test("hosted builds never fall back to the sample data unless PT_DATA=fixtures", () => {
  assert.equal(sampleFallbackError({}, false), null); // local: fixtures fallback
  assert.match(sampleFallbackError({ VERCEL: "1" }, false), /refusing to build the SAMPLE site on Vercel/);
  assert.match(sampleFallbackError({ CI: "true" }, false), /on CI/);
  assert.equal(sampleFallbackError({ VERCEL: "1", PT_DATA: "fixtures" }, false), null);
  assert.equal(sampleFallbackError({ VERCEL: "1", DATA_BASE_URL: "https://x/data" }, false), null);
  assert.equal(sampleFallbackError({ CI: "true" }, true), null); // a real local build
});
