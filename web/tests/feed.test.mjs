// Unit tests for the RSS feeds (src/lib/domain/feed.ts): item wording, dates, ordering, escaping of untrusted filing text,
// attribution with and without a release, the channel, and which members the site feed reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attribution, buildFeed, channelDescription, itemDescription, itemTitle, pickFeedMembers, recentTrades, rfc822, tradeSourceName, FEED_TTL_MINUTES, MEMBER_ITEMS, SITE_ITEMS } from "../src/lib/domain/feed.ts";
import { escapeXml, stripControl, oneLine } from "../src/lib/domain/escape.ts";
import { FEED, SITE } from "../src/lib/copy.ts";

const REL = "ab".repeat(32);
const member = { id: "M000001", name: "Jane Q. Doe", party: "D", state: "CA" };
const trade = (o = {}) => ({
  id: "EVT-1", version: 1, amended: false, date: "2026-10-11", available: "2026-10-16", lag_days: 5, late: false, owner: "spouse", action: "buy",
  partial: null, ticker: "ACME", ticker_source: "printed", asset: "Acme Corp common stock", asset_class: "stock", low: 15001, high: 50000, org: "co:1", doc: "D1",
  url: "https://clerk.house.gov/d1.pdf", ...o,
});
const ctx = (o = {}) => ({ sourceName: "House periodic transaction reports", release: null, built: "2026-11-13T04:00:00Z", ...o });
const chan = { title: "T", link: "https://x.test/", self: "https://x.test/feed/trades.xml", description: "D" };

test("escaping: every XML special character, control characters stripped, non-strings are empty", () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(stripControl("a\u0000b\u0007c\u001Fd\u007Fe\u0085f￾g\ud800h"), "abcdefgh");
  assert.equal(stripControl("keep\ttabs\nand\rlines"), "keep\ttabs\nand\rlines");
  assert.equal(oneLine("  a \n\t b  "), "a b");
  assert.equal(escapeXml(null), "");
  assert.equal(escapeXml(42), "");
});

test("title: member, party-state, action, asset and the amount range as displayed", () => {
  assert.equal(itemTitle(member, trade()), "Jane Q. Doe (D-CA), owner spouse: buy Acme Corp common stock, $15,001–$50,000");
  assert.match(itemTitle(member, trade({ action: "sell", partial: true })), /: sell \(partial\) Acme/);
  assert.match(itemTitle(member, trade({ asset: "", ticker: "ACME" })), /: buy ACME,/);
  assert.match(itemTitle(member, trade({ asset: "", ticker: null })), new RegExp(FEED.noAsset));
});

test("amounts are ranges: open-ended reads 'or more', missing reads 'not disclosed', never zero or a midpoint", () => {
  assert.match(itemTitle(member, trade({ low: 1000001, high: null })), /\$1,000,001 or more$/);
  const none = itemTitle(member, trade({ low: null, high: null }));
  assert.match(none, /not disclosed$/);
  assert.doesNotMatch(none, /\$0/);
  assert.doesNotMatch(itemTitle(member, trade()), /32,500|32500/);
});

test("description: dates as filed, date made public, owner as filed, filing link, attribution", () => {
  const d = itemDescription(trade(), ctx());
  assert.match(d, /Transaction date as filed: 11 Oct 2026\./);
  assert.match(d, /Made public: 16 Oct 2026\./);
  assert.match(d, /Owner as filed: spouse\./);
  assert.match(d, /Filing: https:\/\/clerk\.house\.gov\/d1\.pdf/);
  assert.match(d, /Source: House periodic transaction reports; Paper Trail data release latest build built 13 Nov 2026\./);
  assert.match(itemDescription(trade({ owner: "unspecified" }), ctx()), /Owner as filed: not stated in the filing\./);
});

test("filing links: only http(s) survive", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x/y", null, "https://x/ y"]) {
    const d = itemDescription(trade({ url: bad }), ctx());
    assert.match(d, /Filing: no public link/);
    assert.doesNotMatch(d, /javascript:|data:text/);
  }
});

test("attribution names the short release id, or 'latest build'", () => {
  assert.match(attribution(ctx({ release: REL })), /data release abababababab built 13 Nov 2026$/);
  assert.match(attribution(ctx()), /data release latest build built/);
  assert.match(attribution(ctx({ built: null })), /build date not recorded$/);
  assert.match(attribution(ctx({ release: "not-a-release" })), /latest build/);
});

test("recentTrades: newest made-public first, then id; undated trades are left out; limited", () => {
  const items = [
    { member, trade: trade({ id: "b", available: "2026-10-16" }) },
    { member, trade: trade({ id: "a", available: "2026-10-16" }) },
    { member, trade: trade({ id: "c", available: "2026-11-01" }) },
    { member, trade: trade({ id: "n", available: null }) },
    { member, trade: trade({ id: "o", available: "2026-01-02" }) },
  ];
  assert.deepEqual(recentTrades(items, 10).map((x) => x.trade.id), ["c", "a", "b", "o"]);
  assert.deepEqual(recentTrades(items, 2).map((x) => x.trade.id), ["c", "a"]);
  assert.equal(SITE_ITEMS, 100);
  assert.equal(MEMBER_ITEMS, 50);
});

test("rfc822: dates and timestamps in UTC; unparseable is null", () => {
  assert.equal(rfc822("2026-10-16"), "Fri, 16 Oct 2026 00:00:00 GMT");
  assert.equal(rfc822("2026-11-13T04:05:06Z"), "Fri, 13 Nov 2026 04:05:06 GMT");
  assert.equal(rfc822("soon"), null);
  assert.equal(rfc822(null), null);
});

test("the feed: RSS 2.0, channel fields, pubDate is the made-public date, guid is the trade id, ttl 1440, build date not now", () => {
  const items = recentTrades([{ member, trade: trade() }], 10);
  const xml = buildFeed({ ...chan, description: channelDescription(FEED.siteNote(60), ctx()) }, items, ctx());
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><rss version="2.0"/);
  assert.match(xml, /<lastBuildDate>Fri, 13 Nov 2026 04:00:00 GMT<\/lastBuildDate>/);
  assert.match(xml, new RegExp(`<ttl>${FEED_TTL_MINUTES}</ttl>`));
  assert.equal(FEED_TTL_MINUTES, 1440);
  assert.match(xml, /<guid isPermaLink="false">EVT-1<\/guid>/);
  assert.match(xml, /<pubDate>Fri, 16 Oct 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(xml, new RegExp(`<link>${SITE.url}/m/M000001</link>`));
  assert.ok(xml.includes(escapeXml(SITE.disclaimer)));
  assert.ok(xml.includes("recent trades from members with recent activity in this data build"));
  assert.match(xml, /Source: House periodic transaction reports; Paper Trail data release latest build built 13 Nov 2026/);
});

test("hostile filing text cannot break out of the XML", () => {
  const evil = `</title><script>alert(1)</script>]]>&<!--\u0000\u0007`;
  const t = trade({ asset: evil, id: `id"><x>${evil}`, owner: evil, url: `https://a.test/"><script>` });
  const xml = buildFeed(chan, [{ member: { ...member, name: evil }, trade: t }], ctx());
  assert.doesNotMatch(xml, /<script>|<x>|<!--|\u0000|\u0007/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
  assert.equal((xml.match(/<title>/g) ?? []).length, 2); // channel + item
  assert.ok(xml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("no feed text claims wrongdoing", () => {
  const xml = buildFeed(chan, [{ member, trade: trade() }], ctx()) + channelDescription(FEED.siteNote(60), ctx()) + FEED.memberNote("x");
  assert.doesNotMatch(xml, /corrupt|insider trading|illegal|unlawful|violat|late filing|suspicious/i);
});

test("no lastBuildDate when the build time is unknown (never the render time)", () => {
  const xml = buildFeed(chan, [], ctx({ built: null }));
  assert.doesNotMatch(xml, /lastBuildDate/);
});

test("tradeSourceName: the trade source from meta, in builds and fixtures; a plain fallback", () => {
  assert.equal(tradeSourceName({ sources: [{ id: "x", name: "X" }, { id: "hf_trades", name: "Hugging Face a/b" }] }), "Hugging Face a/b");
  assert.equal(tradeSourceName({ sources: { ptr: { name: "Periodic transaction reports" } } }), "Periodic transaction reports");
  assert.match(tradeSourceName({}), /periodic transaction reports/);
});

test("pickFeedMembers: with wall-years, members with trades in the latest two years, most active first, capped; else by total", () => {
  const mem = (id, trades) => ({ id, counts: { trades, orgs: 0, members: 0, cases: 0 } });
  const members = [mem("A000001", 500), mem("B000001", 40), mem("C000001", 0), mem("D000001", 9), mem("E000001", 30)];
  const wall = { years: [2000, 2026], first: {}, members: new Map([
    ["A000001", { trades: new Map([[2020, 400]]) }],
    ["B000001", { trades: new Map([[2026, 5], [2025, 1]]) }],
    ["D000001", { trades: new Map([[2026, 9]]) }],
    ["E000001", { trades: new Map([[2025, 7]]) }],
  ]) };
  assert.deepEqual(pickFeedMembers(members, wall, 60).map((m) => m.id), ["D000001", "B000001", "E000001"]);
  assert.deepEqual(pickFeedMembers(members, wall, 2).map((m) => m.id), ["D000001", "B000001"]);
  assert.deepEqual(pickFeedMembers(members, null, 60).map((m) => m.id), ["A000001", "B000001", "E000001", "D000001"]);
});
