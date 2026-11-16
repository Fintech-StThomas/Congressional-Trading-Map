// Unit tests for the shared view state (src/lib/domain/viewstate.ts) and the date bases (datebasis.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assumeText, DEFAULT_VIEW, isFiltered, parseView, parseYears, serializeView, viewLine, viewNotes, withView } from "../src/lib/domain/viewstate.ts";
import { countByBasis, countWire, splitByYears, yearOf } from "../src/lib/domain/datebasis.ts";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/domain/assume.ts";
import { YEAR_MAX, YEAR_MIN } from "../src/lib/years.ts";

const EDGE = "4b99031f0f24";

test("an empty query is the default view and serialises to nothing", () => {
  assert.deepEqual(parseView(""), DEFAULT_VIEW);
  assert.equal(serializeView(DEFAULT_VIEW), "");
  assert.equal(isFiltered(DEFAULT_VIEW), false);
});

test("every param round-trips, in one stable order", () => {
  const q = `d=public&o=co:320193&e=${EDGE}&as=own,nofunds&f=holding,money&y=2016-2020`;
  const v = parseView(q);
  assert.deepEqual(v.years, [2016, 2020]);
  assert.deepEqual(v.families, ["money", "holding"]);
  assert.equal(v.edge, EDGE);
  assert.equal(v.org, "co:320193");
  assert.equal(v.basis, "public");
  assert.equal(v.assume.noFunds, true);
  assert.equal(v.assume.family, false);
  const out = serializeView(v);
  assert.equal(out, `y=2016-2020&f=money,holding&as=own,nofunds&e=${EDGE}&o=co:320193&d=public`);
  assert.deepEqual(parseView(out), v);
  assert.equal(serializeView(parseView(out)), out);
  assert.deepEqual(parseView(new URLSearchParams(q)), v);
  assert.deepEqual(parseView(`?${q}`), v);
});

test("an empty family list is written as f=none and read back as empty, not as the default", () => {
  const v = parseView("f=none");
  assert.deepEqual(v.families, []);
  assert.equal(serializeView(v), "f=none");
  assert.equal(viewLine(v), "Showing all years, all household trades counted, no tie families shown, by transaction date");
  assert.equal(parseView("f=bogus").families, null);
});

test("years are clamped to the data's span; invalid or outside values are absent", () => {
  assert.deepEqual(parseYears("1990-2016"), [YEAR_MIN, 2016]);
  assert.deepEqual(parseYears(`2016-${YEAR_MAX + 40}`), [2016, YEAR_MAX]);
  assert.equal(parseYears(`${YEAR_MIN}-${YEAR_MAX}`), null, "the whole span is no filter");
  assert.equal(parseYears("1990-3000"), null);
  assert.equal(parseYears("2020-2016"), null, "reversed");
  assert.equal(parseYears("1980-1990"), null, "wholly before the data");
  assert.equal(parseYears(`${YEAR_MAX + 5}-${YEAR_MAX + 9}`), null, "wholly after the data");
  for (const bad of ["abc", "2016", "2016-", "-2016", "2016-20", "2016-2018-2020", "２０１６-２０１８", "", null, undefined]) assert.equal(parseYears(bad), null, String(bad));
  assert.deepEqual(parseYears("2016-2016"), [2016, 2016]);
});

test("invalid params are dropped, never thrown", () => {
  const v = parseView("y=oops&f=bogus,,x&as=&e=not-an-edge&o=<script>&d=sideways&unknown=1");
  assert.deepEqual(v, DEFAULT_VIEW);
  assert.equal(parseView("e=" + "a".repeat(200)).edge, null);
  assert.equal(parseView("e=4B99031F0F24").edge, null, "edge ids are lowercase hex");
  assert.equal(parseView("o=co:0").org, null);
  assert.equal(parseView("f=money,money,bogus,holding").families.join(), "money,holding");
  assert.equal(serializeView({ ...DEFAULT_VIEW, edge: "nope", org: "nope" }), "", "invalid ids are not written");
});

test("assumptions use assume.ts's own encoding", () => {
  assert.equal(serializeView({ ...DEFAULT_VIEW, assume: { ...DEFAULT_ASSUMPTIONS, family: false, unstated: false } }), "as=own");
  assert.equal(parseView("as=late,small").assume.lateOnly, true);
  assert.equal(parseView("as=late,small").assume.noSmall, true);
  assert.equal(parseView("as=garbage").assume.self, true, "unknown tokens change nothing");
});

test("withView appends the state to each route and keeps the other params", () => {
  const state = parseView(`y=2014-2018&as=own&e=${EDGE}&d=public`);
  const q = `y=2014-2018&as=own&e=${EDGE}&d=public`;
  assert.equal(withView("/m/X000001", state), `/m/X000001?${q}`);
  assert.equal(withView("/m/X000001/records", state), `/m/X000001/records?${q}`);
  assert.equal(withView("/?s=CA&m=X000001", state), `/?s=CA&m=X000001&${q}`);
  assert.equal(withView("/", DEFAULT_VIEW), "/");
  assert.equal(withView("/m/X000001#cases", state), `/m/X000001?${q}#cases`);
  assert.equal(withView("/?m=X000001&focus=co:1", state), `/?m=X000001&focus=co:1&${q}`);
});

test("withView replaces stale view params and serialises the same everywhere", () => {
  const state = parseView("y=2016-2020");
  const a = withView("/m/X000001?y=2001-2002&as=late&e=" + EDGE, state);
  assert.equal(a, "/m/X000001?y=2016-2020");
  const tails = ["/", "/m/X000001", "/m/X000001/records", "/?s=CA&m=X000001"].map((h) => withView(h, state).replace(/^[^?]*\??(?:.*?&)?(?=y=)/, ""));
  assert.ok(tails.every((t) => t === "y=2016-2020"), tails.join("|"));
});

test("an organisation centre in the href survives unless the state selects one", () => {
  assert.equal(withView("/?o=tk:AAPL", { ...DEFAULT_VIEW, years: [2016, 2020] }), "/?o=tk:AAPL&y=2016-2020");
  assert.equal(withView("/?o=tk:AAPL", { ...DEFAULT_VIEW, org: "co:320193" }), "/?o=co:320193");
  assert.equal(withView("/?o=tk:AAPL&m=X000001", DEFAULT_VIEW, false), "/?m=X000001");
});

test("the printed line says what the numbers are limited to", () => {
  const own = { ...DEFAULT_ASSUMPTIONS, family: false, unstated: false };
  assert.equal(viewLine({ ...DEFAULT_VIEW, years: [2014, 2018], assume: own }), "Showing 2014–2018, household trades counted as the member’s own, by transaction date");
  assert.equal(viewLine(DEFAULT_VIEW), "Showing all years, all household trades counted, by transaction date");
  assert.equal(viewLine({ ...DEFAULT_VIEW, years: [2016, 2016], basis: "public", families: ["money", "holding"] }), "Showing 2016, all household trades counted, ties limited to Money, Holdings, by date made public");
  assert.match(assumeText({ ...DEFAULT_ASSUMPTIONS, noFunds: true, lateOnly: true }), /funds, bonds and unlabelled assets left out; only trades public over 45 days/);
  assert.match(assumeText({ ...own, noSmall: true }), /only the member’s own and jointly owned trades; trades under \$15,000 left out/);
  assert.equal(viewNotes(DEFAULT_VIEW).length, 0);
  assert.match(viewNotes({ ...DEFAULT_VIEW, basis: "public" })[0], /Money ties and holdings are shown by record year/);
});

test("date bases are never mixed; rows without the chosen date are counted apart", () => {
  const rows = [
    { date: "2016-03-01", available: "2016-04-01" },
    { date: "2016-12-30", available: "2017-01-20" },
    { date: null, available: "2018-02-02" },
    { date: "2019-05-05", available: null },
  ];
  const ev = countByBasis(rows, "event");
  assert.deepEqual(ev, { byYear: { 2016: 2, 2019: 1 }, undated: 1, total: 4 });
  const pub = countByBasis(rows, "public");
  assert.deepEqual(pub, { byYear: { 2016: 1, 2017: 1, 2018: 1 }, undated: 1, total: 4 });
  assert.equal(ev.undated + Object.values(ev.byYear).reduce((a, b) => a + b, 0), ev.total);
  const wire = countWire({ cols: ["id", "date", "available"], rows: rows.map((r, i) => [i, r.date, r.available]) });
  assert.deepEqual(wire, { event: ev, public: pub });
  assert.equal(countWire(null), null);
  assert.equal(yearOf("2016-03-01"), 2016);
  assert.equal(yearOf(null), null);
  assert.equal(yearOf("garbage"), null);
});

test("a year window keeps dated rows in it and reports the undated apart", () => {
  const rows = [
    { date: "2016-03-01", available: "2017-01-01" },
    { date: "2015-12-31", available: "2016-01-05" },
    { date: null, available: "2016-06-06" },
  ];
  const ev = splitByYears(rows, [2016, 2016], "event");
  assert.equal(ev.shown.length, 1);
  assert.equal(ev.undated.length, 1);
  const pub = splitByYears(rows, [2016, 2016], "public");
  assert.equal(pub.shown.length, 2);
  assert.equal(pub.undated.length, 0);
  const all = splitByYears(rows, null, "event");
  assert.equal(all.shown.length, 3, "no window keeps everything");
  assert.equal(all.undated.length, 1);
});

// ---- the full file's tables (src/lib/domain/recordsview.ts)
import { viewTable } from "../src/lib/domain/recordsview.ts";
import { TIE_COLS, TRADE_COLS_ALL } from "../src/lib/domain/records.ts";
import { ASSET_COLS } from "../src/lib/domain/holdings.ts";

const tradeRow = (o) => TRADE_COLS_ALL.map((c) => (c.key in o ? o[c.key] : null));
const W = (extra = {}) => ({ years: null, basis: "event", assume: DEFAULT_ASSUMPTIONS, ...extra });

test("trade rows follow the date basis; undated ones are apart and never in a year", () => {
  const rows = [
    tradeRow({ id: "a", date: "2016-03-01", available: "2017-01-02", owner: "self", asset_class: "stock", low: 1001, late: false }),
    tradeRow({ id: "b", date: null, available: "2016-05-01", owner: "spouse", asset_class: "fund", low: 15001, late: null }),
    tradeRow({ id: "c", date: "2020-01-01", available: null, owner: "unspecified", asset_class: "stock", low: 50001, late: null }),
  ];
  const ev = viewTable("trades", TRADE_COLS_ALL, rows, W({ years: [2016, 2016] }));
  assert.deepEqual(ev.rows.map((r) => r[0]), ["a"]);
  assert.deepEqual(ev.undated.map((r) => r[0]), ["b"]);
  const pub = viewTable("trades", TRADE_COLS_ALL, rows, W({ years: [2016, 2017], basis: "public" }));
  assert.deepEqual(pub.rows.map((r) => r[0]), ["a", "b"]);
  assert.deepEqual(pub.undated.map((r) => r[0]), ["c"]);
  const none = viewTable("trades", TRADE_COLS_ALL, rows, W());
  assert.equal(none.rows, rows, "no window and default assumptions: untouched");
  assert.equal(none.undated.length, 0);
});

test("assumptions drop trades from the trades table and say how many", () => {
  const rows = [
    tradeRow({ id: "a", date: "2016-03-01", owner: "self", asset_class: "stock", low: 20000 }),
    tradeRow({ id: "b", date: "2016-03-02", owner: "spouse", asset_class: "stock", low: 20000 }),
    tradeRow({ id: "c", date: "2016-03-03", owner: "joint", asset_class: "stock", low: 20000 }),
  ];
  const own = { ...DEFAULT_ASSUMPTIONS, family: false, unstated: false };
  const v = viewTable("trades", TRADE_COLS_ALL, rows, W({ assume: own }));
  assert.deepEqual(v.rows.map((r) => r[0]), ["a", "c"]);
  assert.equal(v.excluded, 1);
  assert.equal(v.total, 3);
});

test("ties are placed by the years of their records; holdings by report year", () => {
  const tie = (first, last) => TIE_COLS.map((c) => (c.key === "first" ? first : c.key === "last" ? last : null));
  const rows = [tie("2010-01-01", "2012-01-01"), tie("2014-01-01", "2019-01-01"), tie(null, null), tie("2021-01-01", "2022-01-01")];
  const v = viewTable("ties", TIE_COLS, rows, W({ years: [2016, 2020] }));
  assert.equal(v.rows.length, 1);
  assert.equal(v.undated.length, 1);
  const a = ASSET_COLS.map((c) => (c.key === "year" ? 2015 : null));
  const b = ASSET_COLS.map((c) => (c.key === "year" ? 2022 : null));
  assert.equal(viewTable("assets", ASSET_COLS, [a, b], W({ years: [2014, 2016] })).rows.length, 1);
});
