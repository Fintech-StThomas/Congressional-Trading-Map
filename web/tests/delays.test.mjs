// Unit tests for the disclosure-timing rules (src/lib/domain/delays.ts). They mirror the boundary cases of the
// pipeline (pipeline/assemble/delays.py, pipeline/tests) so web and pipeline cannot drift. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  bandIndex, decodeDelayMembers, delayGroupFromTrades, delayRowFromTrades, delaysCsv, filterViewRows, nearestRank,
  overCount, overShare, readDelays, share, sortViewRows, viewRows,
} from "../src/lib/domain/delays.ts";
import { decodeTradeFile } from "../src/lib/data/decode.ts";
import { days, percent } from "../src/lib/format.ts";

const T = (lag, extra = {}) => ({ date: lag === null ? null : "2020-03-01", lag_days: lag, amended: false, ...extra });

test("band edges: 30/31, 45/46, 90/91, 365/366", () => {
  const idx = (n) => bandIndex(n);
  assert.deepEqual([0, 30, 31, 45, 46, 90, 91, 365, 366, 4000].map(idx), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const g = delayGroupFromTrades([0, 30, 31, 45, 46, 90, 91, 365, 366].map((n) => T(n)));
  assert.deepEqual(g.bands, { "0-30": 2, "31-45": 2, "46-90": 2, "91-365": 2, "over-365": 1 });
  assert.equal(g.count, 9);
  assert.equal(g.dated, 9);
  assert.equal(overCount(g.bands), 5);
});

test("negative and undated are counted apart, never banded, never zero", () => {
  const g = delayGroupFromTrades([T(-3), T(-1), T(null), T(10), T(50, { amended: true })]);
  assert.equal(g.count, 5);
  assert.equal(g.negative, 2);
  assert.equal(g.undated, 1);
  assert.equal(g.dated, 4, "dated = count - undated, so negative lags are dated");
  assert.equal(g.bands["0-30"], 1);
  assert.equal(g.bands["46-90"], 1);
  assert.equal(g.amended, 1);
  const banded = Object.values(g.bands).reduce((a, b) => a + b, 0);
  assert.equal(banded + g.negative + g.undated, g.count);
  assert.equal(g.median, 10, "negative lags are in no statistic: nearest-rank of [10, 50]");
  assert.equal(g.max, 50);
});

test("a trade with a date but no availability date is undated, not 0 days", () => {
  const g = delayGroupFromTrades([{ date: "2020-03-01", lag_days: null, amended: false }]);
  assert.equal(g.undated, 1);
  assert.equal(g.bands["0-30"], 0);
  assert.equal(g.median, null);
});

test("empty group: zero counts and null statistics", () => {
  const g = delayGroupFromTrades([]);
  assert.deepEqual(g, { count: 0, dated: 0, bands: { "0-30": 0, "31-45": 0, "46-90": 0, "91-365": 0, "over-365": 0 }, negative: 0, undated: 0, date_corrected: 0, amended_unmatched: 0, amended: 0, median: null, p90: null, max: null });
  const onlyBad = delayGroupFromTrades([T(-5), T(null)]);
  assert.equal(onlyBad.median, null);
  assert.equal(onlyBad.p90, null);
  assert.equal(onlyBad.max, null);
});

test("nearest-rank percentile: position ceil(p*n/100), no interpolation", () => {
  assert.equal(nearestRank([], 50), null);
  assert.equal(nearestRank([7], 50), 7);
  assert.equal(nearestRank([1, 2], 50), 1, "lower middle value for even n");
  assert.equal(nearestRank([1, 2, 3, 4], 50), 2);
  assert.equal(nearestRank([1, 2, 3, 4, 5], 50), 3);
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(nearestRank(ten, 90), 9);
  assert.equal(nearestRank(ten.concat(11), 90), 10, "ceil(9.9) = 10");
  assert.equal(nearestRank(ten, 100), 10);
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(nearestRank(hundred, 90), 90);
  assert.equal(nearestRank(hundred, 50), 50);
  // The lags are sorted by the group, whatever order the trades come in.
  const g = delayGroupFromTrades([40, 5, 100, 20, 60].map((n) => T(n)));
  assert.equal(g.median, 40);
  assert.equal(g.p90, 100);
  assert.equal(g.max, 100);
});

test("shares are null, not 0, without a denominator", () => {
  assert.equal(share(0, 0), null);
  assert.equal(overShare(0, 0), null);
  assert.equal(overShare(0, 4), 0);
  assert.equal(overShare(1, 4), 0.25);
  assert.equal(percent(null), "n/a");
  assert.equal(percent(0), "0%");
  assert.equal(percent(0.25), "25%");
  assert.equal(percent(0.045), "4.5%");
  assert.equal(days(null), "n/a");
  assert.equal(days(1), "1 day");
  assert.equal(days(1234), "1,234 days");
});

test("the member row carries years and equals the group", () => {
  const trades = [T(10, { date: "2015-02-01" }), T(60, { date: "2019-09-09" }), T(null, { date: null })];
  const r = delayRowFromTrades("A1", trades);
  assert.equal(r.first_year, 2015);
  assert.equal(r.last_year, 2019);
  assert.equal(r.count, 3);
  assert.equal(r.undated, 1);
  assert.equal(delayRowFromTrades("B", [T(null)]).first_year, null);
});

test("decode: columnar members table, and a table without the contract's columns is empty", () => {
  const table = {
    cols: ["id", "count", "dated", "b0_30", "b31_45", "b46_90", "b91_365", "b366_plus", "negative", "undated", "amended", "median", "p90", "max", "first_year", "last_year"],
    rows: [["A1", 3, 2, 1, 0, 1, 0, 0, 0, 1, 1, 10, 60, 60, 2015, 2019], ["B2", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null, null, null, null]],
  };
  const rows = decodeDelayMembers(table);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].b46_90, 1);
  assert.equal(rows[1].median, null, "missing stays null");
  assert.deepEqual(decodeDelayMembers({ cols: ["id"], rows: [["x"]] }), []);
  assert.deepEqual(decodeDelayMembers(null), []);
});

test("readDelays: absent or malformed is null", () => {
  assert.equal(readDelays(null), null);
  assert.equal(readDelays({}), null);
  assert.equal(readDelays({ totals: { count: 1, dated: 1, bands: {} } }), null);
});

test("sort puts missing values last either way; filters; csv keeps caveat and blanks", () => {
  const who = (id) => ({ A: { name: "Ann", party: "D", state: "CA", chamber: "sen", current: true }, B: { name: "Bob", party: "R", state: "TX", chamber: "rep", current: false } })[id];
  const rows = viewRows(
    decodeDelayMembers({
      cols: ["id", "count", "dated", "b0_30", "b31_45", "b46_90", "b91_365", "b366_plus", "negative", "undated", "amended", "median", "p90", "max", "first_year", "last_year"],
      rows: [["A", 4, 4, 1, 1, 1, 1, 0, 0, 0, 0, 40, 80, 100, 2014, 2020], ["B", 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, null, null, null, null, null], ["C", 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 5, 9, 9, 2016, 2016]],
    }),
    who,
  );
  assert.equal(rows[1].overShare, null, "no dated trades: no share");
  assert.equal(rows[0].over, 2);
  assert.equal(rows[2].name, "C", "a member missing from the index keeps its id");
  assert.deepEqual(sortViewRows(rows, "median", true).map((r) => r.id), ["A", "C", "B"]);
  assert.deepEqual(sortViewRows(rows, "median", false).map((r) => r.id), ["C", "A", "B"]);
  assert.deepEqual(sortViewRows(rows, "count", true).map((r) => r.id), ["A", "C", "B"]);
  assert.deepEqual(filterViewRows(rows, { chamber: "sen", currentOnly: false, query: "" }).map((r) => r.id), ["A"]);
  assert.deepEqual(filterViewRows(rows, { chamber: "all", currentOnly: true, query: "an" }).map((r) => r.id), ["A"]);
  const csv = delaysCsv(rows, "note, with comma");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("member_id,member,"));
  assert.ok(lines[2].includes(",,,,"), "missing values are empty cells");
  assert.ok(lines[1].endsWith('"note, with comma"'));
});

// The fixture file is derived by an independent implementation (scripts/fixture-delays.mjs): the two must agree
// on every member row and on the totals, re-derived from the fixture trade files.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "data");
test("fixtures/data/delays.json equals the rules applied to the fixture trade files", { skip: !existsSync(join(fixtures, "delays.json")) }, () => {
  const file = JSON.parse(readFileSync(join(fixtures, "delays.json"), "utf8"));
  const rows = decodeDelayMembers(file.members);
  assert.ok(rows.length > 0);
  const all = [];
  for (const r of rows) {
    const trades = decodeTradeFile(JSON.parse(readFileSync(join(fixtures, "trades", `${r.id}.json`), "utf8")));
    assert.deepEqual(delayRowFromTrades(r.id, trades), r, r.id);
    all.push(...trades);
  }
  assert.deepEqual(delayGroupFromTrades(all), file.totals);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  assert.equal(sum("count"), file.totals.count);
  assert.equal(file.by_chamber.rep.count + file.by_chamber.sen.count, file.totals.count);
  assert.equal(Object.values(file.by_year).reduce((n, g) => n + g.count, 0), file.totals.count);
  for (const [y, g] of Object.entries(file.by_year)) {
    const inYear = all.filter((t) => (t.date ? t.date.slice(0, 4) : "none") === y);
    assert.deepEqual(delayGroupFromTrades(inYear), g, y);
  }
  assert.ok(readDelays(file));
  // Over 45 days equals the trade files' own `late` flag.
  assert.equal(overCount(file.totals.bands), all.filter((t) => t.late === true).length);
});

// ---- date corrected (packet P2): both dates present, no lag because a later filing corrected the transaction date.
test("a null lag with both dates present is date corrected, not undated; no band, no statistic", () => {
  const corrected = { date: "2020-03-01", available: "2020-03-20", lag_days: null, amended: true };
  const g = delayGroupFromTrades([T(10, { available: "2020-03-11" }), corrected, T(null), { date: "2020-03-01", available: null, lag_days: null, amended: false }]);
  assert.equal(g.count, 4);
  assert.equal(g.date_corrected, 1);
  assert.equal(g.undated, 2, "no transaction date, and no availability date: still undated");
  assert.equal(g.dated, 1, "dated = count - undated - date_corrected");
  assert.equal(g.bands["0-30"], 1);
  assert.equal(g.amended, 1);
  assert.equal(g.median, 10, "the corrected trade adds no days to any statistic");
  const banded = Object.values(g.bands).reduce((a, b) => a + b, 0);
  assert.equal(banded + g.negative + g.undated + g.date_corrected, g.count);
  assert.equal(delayRowFromTrades("A", [corrected]).date_corrected, 1);
});

test("a decoded trade row (date, available, lag null) lands in date_corrected through the same rules", () => {
  const rows = decodeTradeFile({
    cols: ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "doc"],
    rows: [["a", 2, true, "2020-03-01", "2020-03-20", null, null, "self", "buy", "D1"], ["b", 1, false, null, "2020-03-20", null, null, "self", "buy", "D1"]],
    filings: { D1: "https://example.org/d1.pdf" },
  });
  const g = delayGroupFromTrades(rows);
  assert.equal(g.date_corrected, 1);
  assert.equal(g.undated, 1);
});

const OLD_COLS = ["id", "count", "dated", "b0_30", "b31_45", "b46_90", "b91_365", "b366_plus", "negative", "undated", "amended", "median", "p90", "max", "first_year", "last_year"];
test("decode: a delays.json built before date_corrected still reads (null, never 0); a new one reads the last column", () => {
  const old = decodeDelayMembers({ cols: OLD_COLS, rows: [["A", 3, 2, 1, 0, 1, 0, 0, 0, 1, 1, 10, 60, 60, 2015, 2019]] });
  assert.equal(old.length, 1);
  assert.equal(old[0].date_corrected, null);
  assert.equal(old[0].undated, 1);
  const cur = decodeDelayMembers({ cols: [...OLD_COLS, "date_corrected"], rows: [["A", 3, 1, 1, 0, 0, 0, 0, 0, 1, 1, 10, 10, 10, 2015, 2019, 1]] });
  assert.equal(cur[0].date_corrected, 1);
  assert.equal(cur[0].dated, 1);
  const who = () => ({ name: "Ann", party: "D", state: "CA", chamber: "sen", current: true });
  assert.equal(viewRows(old, who)[0].dateCorrected, null);
  assert.equal(viewRows(cur, who)[0].dateCorrected, 1);
  const csv = delaysCsv(viewRows(old.concat(cur), who), "n").trim().split("\r\n");
  const head = csv[0].split(",");
  const at = head.indexOf("date_corrected");
  assert.ok(at > 0);
  assert.equal(csv[1].split(",")[at], "", "an old file's missing count is an empty cell");
  assert.equal(csv[2].split(",")[at], "1");
  // sorting keeps the missing value last either way
  const v = viewRows(cur.concat(old), who);
  assert.equal(sortViewRows(v, "dateCorrected", true)[1].dateCorrected, null);
  assert.equal(sortViewRows(v, "dateCorrected", false)[1].dateCorrected, null);
});

test("readDelays accepts a whole file without date_corrected (archived release) and one with it", () => {
  const g = { count: 2, dated: 2, bands: { "0-30": 2, "31-45": 0, "46-90": 0, "91-365": 0, "over-365": 0 }, negative: 0, undated: 0, amended: 0, median: 5, p90: 9, max: 9 };
  const file = (extra) => ({ definition: { measured: "m", threshold_days: 45, bands: [], percentile: "p", caveats: ["a"] }, totals: { ...g, ...extra }, by_chamber: { rep: { ...g, ...extra }, sen: { ...g, ...extra } }, by_year: {}, members: { cols: OLD_COLS, rows: [] } });
  assert.ok(readDelays(file({})));
  assert.equal(readDelays(file({})).totals.date_corrected, undefined, "left absent: the page leaves the row out rather than showing 0");
  assert.equal(readDelays(file({ date_corrected: 3 })).totals.date_corrected, 3);
});

// ---- owner decision 2026-11-25: Deleted rows are counted nowhere; amended rows with no original have their days withheld.
test("a not-counted row is in no group; a withheld lag goes to the bucket the file names, never by guess", () => {
  const w = (lagWithheld, extra = {}) => ({ date: "2020-03-01", available: "2020-03-20", lag_days: null, amended: true, lagWithheld, ...extra });
  const g = delayGroupFromTrades([
    T(10, { available: "2020-03-11" }), w("amended_unmatched"), w("date_corrected"), w(null),
    { date: "2020-03-01", available: "2020-03-05", lag_days: 4, amended: true, notCounted: true },
  ]);
  assert.equal(g.count, 4, "the deleted row is not counted");
  assert.equal(g.amended_unmatched, 1);
  assert.equal(g.date_corrected, 1);
  assert.equal(g.undated, 1, "the file has a lag_withheld map and this row is not in it: undated, not guessed");
  assert.equal(g.dated, 1, "dated = count - undated - date_corrected - amended_unmatched");
  assert.equal(g.amended, 3, "the not-counted row adds nothing to amended either");
  assert.equal(g.bands["0-30"], 1);
  const banded = Object.values(g.bands).reduce((a, b) => a + b, 0);
  assert.equal(banded + g.negative + g.undated + g.date_corrected + g.amended_unmatched, g.count);
  assert.equal(delayRowFromTrades("A", [w("amended_unmatched")]).amended_unmatched, 1);
  // a file without the map (lagWithheld undefined) keeps the earlier rule: both dates and no lag is date corrected
  assert.equal(delayGroupFromTrades([w(undefined)]).date_corrected, 1);
});

test("decode: trade files with and without not_counted and lag_withheld; deleted rows are dropped unless listed", async () => {
  const { decodeTradeFile, countedWire } = await import("../src/lib/data/decode.ts");
  const cols = ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "doc"];
  const rows = [["a", 1, true, "2020-03-01", "2020-03-20", null, null, "self", "buy", "D1"], ["b", 1, true, "2020-03-01", "2020-03-05", 4, false, "self", "buy", "D1"], ["c", 1, false, "2020-03-01", "2020-03-05", 4, false, "self", "buy", "D1"]];
  const file = { cols, rows, filings: {}, lag_withheld: { a: "amended_unmatched" }, not_counted: { b: "deleted_by_later_filing" } };
  assert.deepEqual(decodeTradeFile(file).map((r) => r.id), ["a", "c"]);
  const listed = decodeTradeFile(file, undefined, { listed: true });
  assert.deepEqual(listed.map((r) => [r.id, r.notCounted ?? false, r.lagWithheld]), [["a", false, "amended_unmatched"], ["b", true, null], ["c", false, null]]);
  assert.equal(delayGroupFromTrades(listed).count, 2, "listed rows still count only the counted ones");
  assert.equal(countedWire(file).rows.length, 2);
  const old = { cols, rows, filings: {} };
  assert.equal(decodeTradeFile(old).length, 3, "an old file has no marks: every row counts, as before");
  assert.equal(decodeTradeFile(old)[0].lagWithheld, undefined);
  assert.equal(countedWire(old), old);
});

const NEW_COLS = [...OLD_COLS, "date_corrected", "amended_unmatched"];
test("decode: delays.json with amended_unmatched reads by name; one without it stays null, never 0", () => {
  const cur = decodeDelayMembers({ cols: NEW_COLS, rows: [["A", 5, 2, 1, 0, 1, 0, 0, 0, 1, 2, 10, 60, 60, 2015, 2019, 1, 1]] });
  assert.equal(cur[0].amended_unmatched, 1);
  const mid = decodeDelayMembers({ cols: [...OLD_COLS, "date_corrected"], rows: [["A", 3, 1, 1, 0, 0, 0, 0, 0, 1, 1, 10, 10, 10, 2015, 2019, 1]] });
  assert.equal(mid[0].amended_unmatched, null);
  const who = () => ({ name: "Ann", party: "D", state: "CA", chamber: "sen", current: true });
  assert.equal(viewRows(cur, who)[0].amendedUnmatched, 1);
  assert.equal(viewRows(mid, who)[0].amendedUnmatched, null);
  assert.ok(delaysCsv(viewRows(cur, who), "n").split("\r\n")[0].includes("amended_unmatched"));
});
