// Unit tests for /new (src/lib/domain/newweek.ts): the 7-day window from the build date, which trades fall in it,
// ordering, the chamber and action filters, and that nothing depends on the clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsIn, addDays, filterRows, inWindow, weekRows, weekWindow, WEEK_DAYS } from "../src/lib/domain/newweek.ts";

const member = (o = {}) => ({ id: "M000001", name: "Jane Doe", party: "D", state: "CA", chamber: "sen", district: null, ...o });
const trade = (o = {}) => ({
  id: "T1", version: 1, amended: false, date: "2026-11-01", available: "2026-11-10", lag_days: 9, late: false, owner: "spouse", action: "buy",
  partial: null, ticker: "ACME", ticker_source: "printed", asset: "Acme Corp", asset_class: "stock", low: 15001, high: 50000, org: "co:1", doc: "D1",
  url: "https://clerk.house.gov/d1.pdf", ...o,
});

test("window: 7 calendar days ending on the build date, both ends included", () => {
  assert.equal(WEEK_DAYS, 7);
  assert.deepEqual(weekWindow("2026-11-13T04:00:00Z"), { from: "2026-11-07", to: "2026-11-13" });
  assert.deepEqual(weekWindow("2026-03-02"), { from: "2026-02-24", to: "2026-03-02" });
  assert.deepEqual(weekWindow("2027-01-03T00:00:00Z"), { from: "2026-12-28", to: "2027-01-03" });
});

test("window: unknown or malformed build dates give no window, never today's date", () => {
  assert.equal(weekWindow(null), null);
  assert.equal(weekWindow(""), null);
  assert.equal(weekWindow("yesterday"), null);
  assert.equal(weekWindow("2026-02-30"), null);
  assert.equal(addDays("2026-02-30", 1), null);
});

test("inWindow: edges are inside, the day before is out, no date is out", () => {
  const w = weekWindow("2026-11-13");
  assert.equal(inWindow("2026-11-07", w), true);
  assert.equal(inWindow("2026-11-13T23:00:00Z", w), true);
  assert.equal(inWindow("2026-11-06", w), false);
  assert.equal(inWindow("2026-11-14", w), false);
  assert.equal(inWindow(null, w), false);
});

test("rows: only the window, newest first, then member, with formatted fields", () => {
  const w = weekWindow("2026-11-13");
  const items = [
    { member: member({ id: "M000002", name: "Zed Zane" }), trade: trade({ id: "A", available: "2026-11-12" }) },
    { member: member({ id: "M000001", name: "Amy Ames" }), trade: trade({ id: "B", available: "2026-11-12" }) },
    { member: member(), trade: trade({ id: "C", available: "2026-11-13" }) },
    { member: member(), trade: trade({ id: "OLD", available: "2026-11-06" }) },
    { member: member(), trade: trade({ id: "NONE", available: null }) },
    { member: member(), trade: trade({ id: "C", available: "2026-11-13" }) },
  ];
  const rows = weekRows(items, w);
  assert.deepEqual(rows.map((r) => r.id), ["C", "B", "A"]);
  const c = rows[0];
  assert.equal(c.availableText, "13 Nov 2026");
  assert.equal(c.amountText, "$15,001–$50,000");
  assert.equal(c.ownerText, "Spouse");
  assert.equal(c.lagText, "9 days");
  assert.equal(c.org.href, "/o/co%3A1");
  assert.equal(c.filing, "https://clerk.house.gov/d1.pdf");
  assert.equal(c.member.seatText, "Sen. · CA");
});

test("rows: missing amount, lag, link and unsafe filing links are never zero or linked", () => {
  const w = weekWindow("2026-11-13");
  const [r] = weekRows([{ member: member(), trade: trade({ low: null, high: null, lag_days: null, date: null, org: "bad id", url: "javascript:alert(1)", late: true }) }], w);
  assert.equal(r.amountText, "not disclosed");
  assert.equal(r.lagText, "not disclosed");
  assert.equal(r.dateText, "not disclosed");
  assert.equal(r.org, null);
  assert.equal(r.filing, null);
  assert.equal(r.over, true);
});

test("filters: chamber and action, both client-side rules", () => {
  const w = weekWindow("2026-11-13");
  const rows = weekRows([
    { member: member({ id: "M000001", chamber: "sen" }), trade: trade({ id: "1", action: "buy" }) },
    { member: member({ id: "M000002", chamber: "rep" }), trade: trade({ id: "2", action: "sell", partial: true }) },
    { member: member({ id: "M000003", chamber: "rep" }), trade: trade({ id: "3", action: "buy" }) },
  ], w);
  assert.equal(filterRows(rows, { chamber: "all", action: "all" }).length, 3);
  assert.deepEqual(filterRows(rows, { chamber: "rep", action: "all" }).map((r) => r.id).sort(), ["2", "3"]);
  assert.deepEqual(filterRows(rows, { chamber: "sen", action: "buy" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterRows(rows, { chamber: "all", action: "sell" }).map((r) => r.actionText), ["Sell (partial)"]);
  assert.deepEqual(actionsIn(rows), ["buy", "sell"]);
});
