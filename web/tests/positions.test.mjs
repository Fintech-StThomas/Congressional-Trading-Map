// Financial profile semantics: gaps never become sales, unknown bounds stay unknown, and CSV retains citations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandText, decodePositions, gridYears, yearState, transitionRows, tenureText, shareText, statusText } from '../src/lib/domain/positions.ts';
import { toCSV } from '../src/lib/domain/records.ts';
import { TRANSITION_COLS } from '../src/lib/domain/positions.ts';

const table = (cols, rows) => ({cols, rows});
const file = {
  member: 'X000001', source: 'hf_holdings', years: [2019, 2021], coverage: [2019, 2020, 2021].map(year => ({year, status: year === 2020 ? 'no_annual_report_in_dataset' : 'used'})),
  docs: {a: 'https://example.org/2019.pdf', b: 'https://example.org/2021.pdf'}, filings: {},
  assets: table(['key', 'name', 'kind', 'status'], [['co:1', 'Example', 'stock', [['throughout', 2019, 2021]]]]),
  snapshots: table(['a', 'year', 'low', 'high', 'unvalued', 'doc'], [[0, 2019, 1001, 15000, 0, 'a'], [0, 2021, 1001, 15000, 0, 'b']]),
  trades: table([], []),
  transitions: table(['a', 'from', 'to', 'gap', 'class', 'buys', 'sells', 'exchanges', 'sold_last_listed_year', 'owner_change'], [[0, 2019, 2021, 1, 'unchanged', 0, 0, 0, 0, false]])
};
test('timeline keeps intervening missing reports explicit and cites both snapshots in CSV', () => {
  const assets = decodePositions(file);
  assert.deepEqual(gridYears(file), [2019, 2020, 2021]);
  assert.equal(yearState(file, 2020), 'no_report');
  assert.equal(yearState(file, 2021), 'report');
  assert.match(statusText(assets[0].status), /held throughout 2019–2021/);
  const rows = transitionRows(file, assets);
  const csv = toCSV(TRANSITION_COLS, rows);
  assert.match(csv, /2019\.pdf https:\/\/example.org\/2021\.pdf/);
  assert.equal(rows[0][5], 1);
  assert.match(csv, /Same band, no trade/);
});
test('unknown bounds and unvalued lines cannot become zero-valued holdings', () => {
  assert.equal(bandText(null, null), 'no value given');
  assert.match(bandText(1001, null, 1), /at least.*line has no value/);
  assert.equal(shareText(null, null), 'not computable');
});
test('first/latest full ranges describe every allowed change, without a growth rate', () => {
  const base = {first_year: 2013, latest_year: 2025, years_between: 12, first: {low: 10, high: 100, label: 'range'}, latest: {low: 20, high: 150, label: 'range'}, known: true, comparable: true, change: {low: -80, high: 140}};
  assert.match(tenureText(base).change, /between.*80.*140.*12 years/);
  assert.match(tenureText({...base, known: false}).change, /cannot be stated/);
});
