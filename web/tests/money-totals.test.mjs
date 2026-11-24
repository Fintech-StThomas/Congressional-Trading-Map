// Unit tests for lib/domain/money-totals.ts, money-years.ts and holdings-missing.ts: all-in money totals reconcile with
// the wall.json rule (pipeline/assemble/wall.py), for and against never mix, missing is never zero.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moneyTotals, wallFigures, partAmountText, sideOf } from "../src/lib/domain/money-totals.ts";
import { moneyYearSeries, coverWord } from "../src/lib/domain/money-years.ts";
import { residenceCell, nwBar } from "../src/lib/domain/holdings-missing.ts";
import { decodeLedger } from "../src/lib/data/decode.ts";

const M = "M000001";
const ex = (n) => ({ exact: n, low: n, high: n });
const edge = (type, amount, o = {}) => ({ type, family: "money", to: { kind: "member", id: M }, note: null, via: null, amount, count: 1, by_year: [], ...o });
const row = (type, amt, o = {}) => ({ type, other: "co:x", otherKind: "org", via: null, ...amt, count: 1, first: "2020-01-01", last: "2020-12-31", note: null, dir: "in", ...o });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const usd = (n) => `$${n}`;

// A member shaped like the live example: the largest ties are full edges, the rest are ledger rows.
const edges = [
  edge("pac_money", ex(500000), { count: 10 }),
  edge("outside_spending", ex(2000000), { note: "oppose", via: { id: "pac:C1:oppose", name: "A" }, count: 4 }),
  edge("outside_spending", ex(40000), { note: "support", via: { id: "pac:C2:support", name: "B" }, count: 2 }),
  edge("pac_money", ex(9999), { to: { kind: "org", id: "co:y" }, count: 99 }), // paid by the member: not received
];
const ledger = [
  row("pac_money", ex(1000), { count: 3 }),
  row("pac_money", ex(250), { count: 1 }),
  row("outside_spending", ex(300), { note: "oppose", via: { id: "pac:C3:oppose", name: "C" }, count: 2 }),
  row("outside_spending", ex(700), { via: { id: "pac:C4:support", name: "D" }, count: 5 }),
  row("sits_with", { exact: null, low: null, high: null }, { dir: "both" }),
];
const totals = {
  pac_money: { edges: 2, records: 4, low: 1250, high: 1250, exact: 1250 },
  outside_spending: { edges: 2, records: 7, low: 1000, high: 1000, exact: 1000 },
  sits_with: { edges: 1, records: 1, low: null, high: null, exact: null },
};
// What wall.json carries for this member: edge_size summed over every received tie, full or ledger.
const wall = { pac: 500000 + 1000 + 250, support: 40000 + 700, oppose: 2000000 + 300 };

test("totals equal the wall.json figures", () => {
  assert.deepEqual(wallFigures(moneyTotals({ member: M, edges, ledger, totals })), wall);
});

test("each kind is full plus ledger, with record counts", () => {
  const k = moneyTotals({ member: M, edges, ledger, totals });
  const pac = k.find((x) => x.type === "pac_money").sides[0];
  assert.equal(pac.all.ties, 3);
  assert.equal(pac.all.records, 14);
  assert.equal(pac.ledger.ties, 2);
  assert.equal(pac.ledger.size, 1250);
  assert.equal(pac.full.size, 500000);
});

test("outside spending splits for and against; against is never added to support", () => {
  const o = moneyTotals({ member: M, edges, ledger, totals }).find((x) => x.type === "outside_spending");
  const by = Object.fromEntries(o.sides.map((s) => [s.side, s]));
  assert.equal(by.for.all.size, 40700);
  assert.equal(by.against.all.size, 2000300);
  assert.equal(by.for.all.records, 7);
  assert.equal(by.against.all.records, 6);
  assert.equal(o.sides.length, 2);
});

test("ledger rows cut for a former member leave an unsplit remainder, not a guess", () => {
  const cut = { ...totals, outside_spending: { edges: 5, records: 20, low: 5000, high: 5000, exact: 5000 } };
  const o = moneyTotals({ member: M, edges, ledger, totals: cut }).find((x) => x.type === "outside_spending");
  assert.equal(o.unsplit.ties, 3);
  assert.equal(o.unsplit.records, 13);
  assert.equal(o.unsplit.size, 4000);
  assert.equal(o.incomplete, true, "dollars on the split lines are flagged as listed ties only");
  assert.equal(moneyTotals({ member: M, edges, ledger, totals }).find((x) => x.type === "outside_spending").incomplete, false);
});

test("a kind with no ties is absent; no amount is never $0", () => {
  assert.equal(moneyTotals({ member: M, edges: [], ledger: [], totals: {} }).length, 0);
  const none = { exact: null, low: null, high: null };
  const p = moneyTotals({ member: M, edges: [], ledger: [row("paid_travel", none)], totals: { paid_travel: { edges: 1, records: 1, ...none } } })[0].sides[0].all;
  assert.equal(partAmountText(p, usd, "no amount"), "no amount");
});

test("non-exact amounts print as a disclosed range, exact as one figure", () => {
  const rows = [row("paid_travel", { exact: null, low: 1000, high: 5000 }), row("paid_travel", { exact: null, low: 500, high: 1000 })];
  const r = moneyTotals({ member: M, edges: [], ledger: rows, totals: { paid_travel: { edges: 2, records: 2, low: 1500, high: 6000, exact: null } } })[0].sides[0].all;
  assert.equal(partAmountText(r, usd, "-"), "$1500–$6000");
  assert.equal(partAmountText(moneyTotals({ member: M, edges, ledger, totals })[0].sides[0].all, usd, "-"), "$501250");
});

test("sideOf reads the note, then the via id", () => {
  assert.equal(sideOf("support"), "for");
  assert.equal(sideOf(null, "pac:C1:oppose"), "against");
  assert.equal(sideOf(null, null), "unstated");
});

test("a fixture member file reconciles with its ledger_totals", () => {
  const f = JSON.parse(readFileSync(new URL("../fixtures/data/members/X000001.json", import.meta.url), "utf8"));
  const id = f.member.id;
  const k = moneyTotals({ member: id, edges: f.edges, ledger: decodeLedger(f), totals: f.ledger_totals });
  const pac = k.find((x) => x.type === "pac_money").sides[0].all;
  const fullPac = f.edges.filter((e) => e.type === "pac_money" && e.to.id === id);
  assert.equal(pac.ties, fullPac.length + f.ledger_totals.pac_money.edges);
  assert.equal(pac.records, sum(fullPac.map((e) => e.count)) + f.ledger_totals.pac_money.records);
  assert.equal(pac.size, sum(fullPac.map((e) => e.amount.exact ?? e.amount.high ?? e.amount.low ?? 0)) + f.ledger_totals.pac_money.exact);
});

test("money by year counts full ties and single-year ledger rows; span ties are counted apart", () => {
  const e = [
    { family: "money", note: null, via: null, by_year: [{ y: 2025, n: 4 }, { y: 2026, n: 1 }] },
    { family: "money", note: "oppose", via: null, by_year: [{ y: 2025, n: 50 }] },
    { family: "holding", note: null, via: null, by_year: [{ y: 2025, n: 70 }] },
  ];
  const l = [row("pac_money", ex(1), { count: 6, first: "2026-02-01", last: "2026-09-01" }), row("pac_money", ex(1), { count: 9, first: "2019-01-01", last: "2026-03-01" })];
  const s = moneyYearSeries(e, l);
  assert.deepEqual(s.records, { 2025: 4, 2026: 7 });
  assert.deepEqual(s.spanTies, { 2019: 1, 2026: 1 });
  assert.equal(s.multiYearRecords, 9);
});

test("the open year is in progress, never complete", () => {
  const w = { full: "complete", partial: "partial", none: "none", "n/a": "na" };
  assert.equal(coverWord("full", 2026, 2026, w, "in progress"), "in progress");
  assert.equal(coverWord("full", 2025, 2026, w, "in progress"), "complete");
  assert.equal(coverWord("none", 2026, 2026, w, "in progress"), "none");
});

test("residence-secured cell: n = 0 is not identified, never $0", () => {
  assert.equal(residenceCell(0, 0, 0), "not identified in the filing");
  assert.equal(residenceCell(undefined, 0, 0), "not identified in the filing");
  assert.match(residenceCell(2, 15001, 50000), /\$15K.\$50K/);
});

test("net-worth bar: a null low is unbounded below, not a bar from $0", () => {
  assert.deepEqual(nwBar({ low: null, high: 80000, high_valued: null, label: "unbounded" }), { kind: "unbounded_below", top: 80000 });
  assert.deepEqual(nwBar({ low: null, high: null, high_valued: null, label: "unbounded" }), { kind: "unbounded_below", top: null });
  assert.deepEqual(nwBar({ low: 100, high: 500, high_valued: null, label: "range" }), { kind: "range", bottom: 100, top: 500 });
});

test("funds ties are split by direction, never mixed", () => {
  const e = [edge("funds", ex(100), { to: { kind: "org", id: "co:z" } }), edge("funds", ex(5))];
  const k = moneyTotals({ member: M, edges: e, ledger: [], totals: {} }).find((x) => x.type === "funds");
  const by = Object.fromEntries(k.sides.map((s) => [s.side, s.all.size]));
  assert.deepEqual(by, { in: 5, out: 100 });
});

test("a cut ledger counts rows the wall leaves out consistently", () => {
  const rows = [row("pac_money", ex(10), { dir: "out" }), row("pac_money", ex(20))];
  const t = { pac_money: { edges: 3, records: 6, low: 100, high: 100, exact: 100 } };
  const k = moneyTotals({ member: M, edges: [], ledger: rows, totals: t })[0];
  assert.equal(k.sides[0].all.ties, 2); // 1 listed row received + 1 unsplit tie
  assert.equal(k.sides[0].all.size, 20 + 70);
});

test("a cut funds ledger is incomplete and keeps its remainder", () => {
  const rows = [row("funds", ex(30), { dir: "in" }), row("funds", ex(70), { dir: "out" })];
  const t = { funds: { edges: 10, records: 20, low: 1000, high: 1000, exact: 1000 } };
  const k = moneyTotals({ member: M, edges: [], ledger: rows, totals: t })[0];
  assert.equal(k.incomplete, true);
  assert.equal(k.unsplit.ties, 8);
  assert.equal(k.unsplit.size, 900);
  assert.equal(k.sides.find((s) => s.side === "in").all.size, 30);
});
