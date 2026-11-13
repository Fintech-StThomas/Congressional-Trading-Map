// Unit tests for the assumption switches (src/lib/assume.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAssumptions, decodeAssumptions, DEFAULT_ASSUMPTIONS, encodeAssumptions, isDefault, ownOnly, readout, tradeCounts } from "../src/lib/assume.ts";

const T = (owner, org, extra = {}) => ({ owner, org, asset_class: "stock", low: 15001, late: false, ...extra });
const trades = [
  T("self", "co:1"), T("spouse", "co:1"), T("spouse", "co:2"), T("unspecified", "co:3"),
  T("joint", "co:4", { low: 1001 }), T("dependent", "co:5", { asset_class: "fund" }), T("self", "co:6", { late: true }),
];
const edge = (id, org) => ({ id, type: "traded", from: { kind: "member", id: "M" }, to: { kind: "org", id: org } });
const edges = ["co:1", "co:2", "co:3", "co:4", "co:5", "co:6"].map((o, i) => edge(`e${i + 1}`, o));
edges.push({ id: "p1", type: "pac_money", from: { kind: "org", id: "co:2" }, to: { kind: "member", id: "M" } });

test("defaults count every trade and exclude nothing", () => {
  const e = applyAssumptions(trades, edges, ["co:1", "co:2"], DEFAULT_ASSUMPTIONS);
  assert.equal(e.kept, 7);
  assert.equal(e.excluded.size, 0);
  assert.equal(e.cases.size, 2);
  assert.ok(isDefault(DEFAULT_ASSUMPTIONS));
});

test("own trades only: spouse, dependent and unstated drop; joint stays", () => {
  const a = ownOnly(DEFAULT_ASSUMPTIONS, true);
  const e = applyAssumptions(trades, edges, ["co:1", "co:2"], a);
  assert.equal(e.kept, 3);
  assert.deepEqual([...e.excluded].sort(), ["e2", "e3", "e5"]);
  assert.deepEqual([...e.cases], ["co:1"], "co:2's case loses its tag; co:1 keeps the member's own trade");
  assert.ok(!e.excluded.has("p1"), "money strings are never excluded");
  assert.equal(readout(e, a), "3 of 7 trades count; 1 of 2 cases remain under these assumptions. Money strings are unaffected.");
});

test("funds, small and late filters", () => {
  assert.equal(tradeCounts(T("self", "x", { asset_class: "unknown" }), { ...DEFAULT_ASSUMPTIONS, noFunds: true }), false);
  assert.equal(tradeCounts(T("self", "x", { low: 1001 }), { ...DEFAULT_ASSUMPTIONS, noSmall: true }), false);
  assert.equal(tradeCounts(T("self", "x", { low: null }), { ...DEFAULT_ASSUMPTIONS, noSmall: true }), true, "unknown range is not assumed small");
  const late = applyAssumptions(trades, edges, [], { ...DEFAULT_ASSUMPTIONS, lateOnly: true });
  assert.equal(late.kept, 1);
  assert.equal(late.excluded.size, 5);
});

test("URL round trip", () => {
  for (const a of [DEFAULT_ASSUMPTIONS, ownOnly(DEFAULT_ASSUMPTIONS, true), { ...DEFAULT_ASSUMPTIONS, unstated: false, noSmall: true, lateOnly: true }]) {
    assert.deepEqual(decodeAssumptions(encodeAssumptions(a)), a);
  }
  assert.equal(encodeAssumptions(DEFAULT_ASSUMPTIONS), "");
  assert.equal(encodeAssumptions(ownOnly(DEFAULT_ASSUMPTIONS, true)), "own");
});
