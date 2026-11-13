// Unit tests for the wall-by-year logic (src/lib/wallyears.ts). No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decodeWallYears, leaving, rowsForYear, termIn, yearGap, yearScale } from "../src/lib/wallyears.ts";

const first = { trades: { sen: 2012, rep: 2014 }, cases: 2012, money: 1999 };
const raw = {
  years: [2000, 2026], first,
  cols: ["id", "terms", "cases", "trades", "pac", "oppose"],
  rows: [
    // A House member who became a senator in 2011 and switched party in 2019.
    ["A1", [[2003, 2010, "rep", "R", "OH"], [2011, 2018, "sen", "R", "OH"], [2019, 2026, "sen", "I", "OH"]], [2015, 1, 2016, 2], [2014, 5, 2020, 7], [2004, 1000, 2012, 3000], []],
    ["B2", [[2000, 2006, "rep", "D", "CA"]], [], [], [2002, 500], [2004, 250]],
    ["C3", [[2009, 2026, "rep", "D", "TX"]], [], [], [], []],
  ],
};
const base = [
  { id: "A1", name: "A One", last: "One", party: "I", state: "OH", chamber: "sen", district: null, current: true, photo: false, cases: 3, trades: 12, pac: 4000, support: 0, oppose: 0, orgs: 1 },
  { id: "B2", name: "B Two", last: "Two", party: "D", state: "CA", chamber: "rep", district: 5, current: false, photo: false, cases: 0, trades: 0, pac: 500, support: 0, oppose: 250, orgs: 1 },
  { id: "C3", name: "C Three", last: "Three", party: "D", state: "TX", chamber: "rep", district: 7, current: true, photo: false, cases: 0, trades: 0, pac: 0, support: 0, oppose: 0, orgs: 0 },
];
const wy = decodeWallYears(raw);

test("only members serving that year appear, placed by that year's term", () => {
  const y2005 = rowsForYear(base, wy, 2005);
  assert.deepEqual(y2005.map((r) => r.id), ["A1", "B2"]);
  const a = y2005.find((r) => r.id === "A1");
  assert.equal(a.chamber, "rep");
  assert.equal(a.party, "R", "party of the 2005 term, not the latest");
  assert.equal(a.district, null, "district is only known for the current seat");
  const y2020 = rowsForYear(base, wy, 2020);
  assert.deepEqual(y2020.map((r) => r.id), ["A1", "C3"]);
  assert.equal(y2020[0].party, "I");
  assert.equal(y2020[0].chamber, "sen");
  assert.equal(y2020[1].district, 7);
});

test("measures are that year's values, zero when absent", () => {
  const a12 = rowsForYear(base, wy, 2012).find((r) => r.id === "A1");
  assert.deepEqual([a12.cases, a12.trades, a12.pac, a12.oppose], [0, 0, 3000, 0]);
  const a16 = rowsForYear(base, wy, 2016).find((r) => r.id === "A1");
  assert.equal(a16.cases, 2);
  const b4 = rowsForYear(base, wy, 2004).find((r) => r.id === "B2");
  assert.equal(b4.oppose, 250);
});

test("the later-starting term wins in a switch year", () => {
  assert.equal(termIn([[2000, 2010, "rep", "D", "X"], [2010, 2020, "sen", "D", "X"]], 2010)[2], "sen");
  assert.equal(termIn([[2000, 2010, "rep", "D", "X"]], 2011), null);
});

test("one scale across every year", () => {
  assert.equal(yearScale(wy, "pac"), 3000);
  assert.equal(yearScale(wy, "oppose"), 250);
  assert.equal(yearScale(wy, "cases"), 2);
});

test("years before the trade data say so in words", () => {
  assert.equal(yearGap("trades", 2008, "all", first).level, "none");
  assert.match(yearGap("trades", 2008, "all", first).text, /2012/);
  assert.equal(yearGap("cases", 2010, "sen", first).level, "none");
  assert.equal(yearGap("trades", 2013, "rep", first).level, "none");
  assert.equal(yearGap("trades", 2013, "all", first).level, "partial");
  assert.equal(yearGap("trades", 2013, "sen", first), null);
  assert.equal(yearGap("trades", 2024, "all", first), null);
  assert.equal(yearGap("pac", 2000, "all", first), null);
});

test("leaving lists prints that drop out between years", () => {
  assert.deepEqual(leaving(rowsForYear(base, wy, 2006), rowsForYear(base, wy, 2009)).map((r) => r.id), ["B2"]);
});

test("real wall-years.json: per-year trades sum to wall.json totals", () => {
  const dir = new URL("../public/data/", import.meta.url);
  if (!existsSync(new URL("wall-years.json", dir))) return;
  const real = decodeWallYears(JSON.parse(readFileSync(new URL("wall-years.json", dir), "utf8")));
  const wall = JSON.parse(readFileSync(new URL("wall.json", dir), "utf8"));
  const at = Object.fromEntries(wall.cols.map((c, i) => [c, i]));
  for (const r of wall.rows.slice(0, 300)) {
    const m = real.members.get(r[at.id]);
    assert.ok(m, r[at.id]);
    assert.equal([...m.trades.values()].reduce((a, b) => a + b, 0), r[at.trades], r[at.id]);
  }
  const serving2024 = [...real.members.values()].filter((m) => termIn(m.terms, 2024)).length;
  assert.ok(serving2024 >= 535 && serving2024 < 600, `serving 2024: ${serving2024}`);
});
