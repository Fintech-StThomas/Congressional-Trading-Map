// Unit tests for organisation feeds (src/lib/domain/orgfeed.ts): dating rules for money ties (exact, year only, none),
// which ties are listed (PAC money; outside spending only when it supports; never against), and the hard bound on files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, isFullDay, listableMoney, moneyItem, moneyItemDate, needsOf, orgTradeItems, planOrgFeed, ORG_FEED_FILES, rowSideKnown } from "../src/lib/domain/orgfeed.ts";
import { buildFeedFromItems } from "../src/lib/domain/feed.ts";

const tie = (o = {}) => ({
  id: "e1", type: "pac_money", amount: { low: null, high: null, exact: 5000 }, count: 3, first: "2020-01-02", last: "2024-05-06",
  _tie: { member: "M000001", org: "pac:C00000001", edge: null }, note: null, ...o,
});
const tt = (o = {}) => {
  const { member = "M000001", edge = null, ...rest } = o;
  return tie({ ...rest, _tie: { member, org: "pac:C00000001", edge } });
};
const c = { sourceName: "Trades", release: null, built: "2026-11-13T04:00:00Z" };
const member = { id: "M000001", name: "Jane Doe", party: "D", state: "CA" };

test("dating: a complete day wins; the latest of the row and the evidence", () => {
  assert.deepEqual(moneyItemDate("2024-05-06"), { date: "2024-05-06", yearOnly: false });
  assert.deepEqual(moneyItemDate("2024-05-06", ["2024-07-01", null, "2023-01-01"]), { date: "2024-07-01", yearOnly: false });
  assert.deepEqual(moneyItemDate("2024-05-06T10:00:00Z"), { date: "2024-05-06", yearOnly: false });
});

test("dating: only a year is known gives 31 December and says year only; nothing known gives no item", () => {
  assert.deepEqual(moneyItemDate("2024"), { date: "2024-12-31", yearOnly: true });
  assert.deepEqual(moneyItemDate("2023", ["2024"]), { date: "2024-12-31", yearOnly: true });
  // A year still in progress is dated on the data build date, never in the future.
  assert.deepEqual(moneyItemDate("2026", [], "2026-11-13T07:41:00Z"), { date: "2026-11-13", yearOnly: true });
  assert.deepEqual(moneyItemDate("2025", [], "2026-11-13T07:41:00Z"), { date: "2025-12-31", yearOnly: true });
  assert.equal(moneyItemDate(null), null);
  assert.equal(moneyItemDate("soon", [null]), null);
  assert.equal(isFullDay("2024-02-30"), false);
  assert.equal(isFullDay("2024-02-29"), true);
});

test("item: a year-only tie is worded as year only; an exact one gives the day; amounts are as disclosed", () => {
  const year = moneyItem({ id: "pac:C00000001", name: "Acme PAC" }, tt({ last: "2024" }), member, [], c);
  assert.equal(year.pubDate, "2024-12-31");
  assert.match(year.description, /year only \(2024\)/);
  assert.match(year.title, /^Acme PAC: PAC contributions to Jane Doe \(D-CA\), \$5,000$/);
  const day = moneyItem({ id: "pac:C00000001", name: "Acme PAC" }, tt(), member, [], c);
  assert.equal(day.pubDate, "2024-05-06");
  assert.match(day.description, /Latest record in this tie: 6 May 2024/);
  assert.doesNotMatch(day.description, /year only/);
  assert.equal(moneyItem({ id: "x", name: "X" }, tt({ last: null }), member, [], c), null);
  const none = moneyItem({ id: "x", name: "X" }, tt({ amount: { low: null, high: null, exact: null } }), member, [], c);
  assert.match(none.title, /not disclosed/);
});

test("item text is escaped in the XML", () => {
  const it = moneyItem({ id: "x", name: "A & <B>" }, tt(), member, [], c);
  const xml = buildFeedFromItems({ title: "T", link: "l", self: "s", description: "d" }, [it], c);
  assert.match(xml, /A &amp; &lt;B&gt;: PAC contributions/);
  assert.doesNotMatch(xml, /<B>/);
});

test("which ties: PAC money and trades; outside spending only where the side is support; against never", () => {
  const ties = [tt({ type: "traded" }), tt({ type: "pac_money" }), tt({ type: "outside_spending" }), tt({ type: "employee_money" }), tt({ type: "oversees" })];
  assert.deepEqual(candidates(ties).map((x) => x.tie.type).sort(), ["outside_spending", "pac_money", "traded"]);
  assert.equal(listableMoney(tt({ type: "pac_money" }), undefined), true);
  assert.equal(listableMoney(tt({ type: "outside_spending" }), undefined), false);
  assert.equal(listableMoney(tt({ type: "outside_spending" }), { note: "oppose", via: null }), false);
  assert.equal(listableMoney(tt({ type: "outside_spending" }), { note: null, via: { id: "pac:C1:oppose", name: "x" } }), false);
  assert.equal(listableMoney(tt({ type: "outside_spending" }), { note: "support", via: null }), true);
  assert.equal(listableMoney(tt({ type: "outside_spending", note: "support" }), undefined), true);
  assert.equal(listableMoney(tt({ type: "outside_spending", note: "oppose" }), { note: "support", via: null }), false);
});

test("needs: a trade file for a trade; a member file only for the side or a date that is missing", () => {
  const cand = (t) => candidates([t])[0];
  assert.deepEqual(needsOf(cand(tt({ type: "traded" })), rowSideKnown), [{ kind: "trades", id: "M000001" }]);
  assert.deepEqual(needsOf(cand(tt()), rowSideKnown), []);
  assert.deepEqual(needsOf(cand(tt({ last: "2024", edge: "abc" })), rowSideKnown), [{ kind: "member", id: "M000001" }]);
  assert.deepEqual(needsOf(cand(tt({ type: "outside_spending", edge: "abc" })), rowSideKnown), [{ kind: "member", id: "M000001" }]);
  assert.deepEqual(needsOf(cand(tt({ type: "outside_spending", edge: null })), rowSideKnown), []);
  assert.deepEqual(needsOf(cand(tt({ type: "outside_spending", edge: "abc", note: "support" })), rowSideKnown), []);
});

test("plan: at most 25 files, most recent ties first, files already read are free", () => {
  const many = Array.from({ length: 40 }, (_, i) => tt({ type: "traded", member: `M${String(i).padStart(6, "0")}`, last: `2024-01-${String((i % 28) + 1).padStart(2, "0")}` }));
  const plan = planOrgFeed(candidates(many), ORG_FEED_FILES);
  assert.equal(plan.reads.length, 25);
  assert.equal(plan.chosen.length, 25);
  assert.ok(plan.chosen[0].tie.last >= plan.chosen[24].tie.last);
  const have = new Set(["trades:M000000"]);
  assert.equal(planOrgFeed(candidates([many[0]]), 0, have).chosen.length, 1);
  assert.equal(planOrgFeed(candidates([many[0]]), 0).chosen.length, 0);
  // PAC ties with a complete day need no file, so a zero budget keeps them
  assert.equal(planOrgFeed(candidates([tt()]), 0).chosen.length, 1);
});

test("org trade items: only trades in this organisation with a made-public date", () => {
  const trade = (id, org, available) => ({ id, version: 1, amended: false, date: "2026-11-01", available, lag_days: 3, late: false, owner: "self", action: "buy", partial: null, ticker: null, ticker_source: null, asset: "A", asset_class: "stock", low: 1001, high: 15000, org, doc: "d", url: null });
  const byMember = new Map([["M000001", [{ member, trade: trade("a", "co:1", "2026-11-05") }, { member, trade: trade("b", "co:2", "2026-11-06") }, { member, trade: trade("c", "co:1", null) }]]]);
  const items = orgTradeItems("co:1", byMember, c);
  assert.deepEqual(items.map((i) => i.guid), ["a"]);
});
