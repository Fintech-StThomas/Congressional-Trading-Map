// Unit tests for later filings of a trade (src/lib/domain/amendments.ts, the records columns and the wording): files with
// and without `amendments` both read, a Deleted mark is said plainly and the trade stays, links come from `filings`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amendmentsFor, amendmentView, laterFilingUrls, laterFilingsText, readAmendments } from "../src/lib/domain/amendments.ts";
import { tradeRows, TRADE_COLS_ALL, documentRows, caveats } from "../src/lib/domain/records.ts";
import { decodeTradeFile } from "../src/lib/data/decode.ts";
import { AMEND } from "../src/lib/copy-amend.ts";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/domain/assume.ts";

const COLS = ["id", "version", "amended", "date", "available", "lag_days", "late", "owner", "action", "partial", "ticker", "ticker_source", "asset", "asset_class", "low", "high", "org", "doc"];
const row = (id, o = {}) => COLS.map((c) => ({ id, version: 1, amended: false, date: "2020-03-01", available: "2020-03-11", lag_days: 10, late: false, owner: "self", action: "buy", partial: null, ticker: "ACME", ticker_source: "printed", asset: "Acme", asset_class: "stock", low: 1001, high: 15000, org: null, doc: "D1", ...o })[c]);
const NEW = {
  cols: COLS,
  rows: [row("t1", { amended: true }), row("t2", { amended: true }), row("t3", { amended: true, version: 2, lag_days: null, late: null }), row("t4")],
  filings: { D1: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20010001.pdf", D2: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20010002.pdf", D3: "javascript:alert(1)" },
  amendments: {
    t1: [{ id: "t1-r", doc: "D2", status: "Amended", available: "2020-06-01" }],
    t2: [{ id: "t2-r", doc: "D2", status: "Deleted", available: "2020-06-01" }, { id: "t2-r2", doc: "D2", status: "Deleted", available: "2020-06-01" }],
    t3: [{ id: "t3", doc: "D3", status: "Version", available: "2020-05-01" }],
    bad: [{ id: "x", doc: 4, status: "Odd" }],
    notalist: 5,
  },
};
const OLD = { cols: COLS, rows: NEW.rows, filings: NEW.filings };

test("readAmendments: a file without the field (an archived release) reads as none; malformed entries are dropped", () => {
  assert.deepEqual(readAmendments(OLD), {});
  assert.deepEqual(readAmendments(null), {});
  assert.deepEqual(readAmendments({ amendments: [] }), {});
  const m = readAmendments(NEW);
  assert.deepEqual(Object.keys(m).sort(), ["t1", "t2", "t3"]);
  assert.equal(m.t1[0].status, "Amended");
});

test("the table decoders accept files with and without amendments", () => {
  assert.equal(decodeTradeFile(NEW).length, 4);
  assert.equal(decodeTradeFile(OLD).length, 4);
});

test("amendmentView: later filings linked from filings, a Deleted mark said, date corrected when both dates and no lag", () => {
  const rows = decodeTradeFile(NEW);
  const map = readAmendments(NEW);
  const t1 = amendmentView(rows[0], map, NEW.filings);
  assert.deepEqual(t1.later.map((l) => [l.doc, l.status, l.url]), [["D2", "Amended", NEW.filings.D2]]);
  assert.equal(t1.deleted, false);
  const t2 = amendmentView(rows[1], map, NEW.filings);
  assert.equal(t2.deleted, true);
  assert.equal(t2.later.length, 1, "the same later filing is listed once");
  const t3 = amendmentView(rows[2], map, NEW.filings);
  assert.equal(t3.dateCorrected, true);
  assert.equal(t3.later[0].url, null, "a link that is not http(s) is never made a link");
  const t4 = amendmentView(rows[3], map, NEW.filings);
  assert.deepEqual([t4.later.length, t4.deleted, t4.dateCorrected, t4.amended], [0, false, false, false]);
  // an old file: an amended row says amended and has no later filing to link
  const old = amendmentView(rows[0], readAmendments(OLD), OLD.filings);
  assert.equal(old.later.length, 0);
});

test("wording: plain, no wrongdoing claim, and the deleted trade is said to stay", () => {
  assert.equal(AMEND.deleted, "a later filing marks this transaction deleted");
  assert.equal(AMEND.dateCorrected, "date corrected by a later filing");
  assert.match(AMEND.deletedNote, /stays listed and marked; it is not in any count/);
  assert.equal(AMEND.laterFiling("Amended", "2020-06-01"), "later filing 1 Jun 2020");
  assert.equal(AMEND.laterFiling("Version", null), "later version");
  for (const v of [AMEND.deleted, AMEND.dateCorrected, AMEND.deletedNote, AMEND.dateCorrectedTitle]) assert.doesNotMatch(v, /late\b|corrupt|insider/i);
});

test("the full file's trade table has the later-filings columns; old files leave them empty", () => {
  const keys = TRADE_COLS_ALL.map((c) => c.key);
  assert.ok(keys.includes("later") && keys.includes("later_urls"));
  const at = (k) => keys.indexOf(k);
  const t = tradeRows(NEW);
  assert.equal(t.length, 4);
  assert.equal(t[0][at("later")], "Amended 2020-06-01 (filing D2)");
  assert.equal(t[0][at("later_urls")], NEW.filings.D2);
  assert.equal(t[2][at("later_urls")], null, "an unsafe address is left out");
  assert.equal(t[3][at("later")], null);
  assert.equal(tradeRows(OLD)[0][at("later")], null);
  assert.equal(tradeRows(OLD)[0].length, TRADE_COLS_ALL.length);
  assert.equal(laterFilingsText([]), null);
  assert.equal(laterFilingUrls(undefined, NEW.filings), null);
});

test("source documents include the later filings; the amended count says each trade is listed once", () => {
  const file = { member: { id: "M", fec_ids: [], terms: [], current: true }, edges: [], coverage: [], ledger: null };
  const docs = documentRows(file, NEW, (x) => x);
  assert.ok(docs.some((d) => d[0] === NEW.filings.D2 && /later filing/.test(d[1])));
  assert.ok(caveats(file, NEW).some((c) => /flagged amended; each is listed once/.test(c)));
});

test("amendmentsFor: only the asked trades, with their filings", () => {
  const a = amendmentsFor(NEW, ["t1", "t4"]);
  assert.deepEqual(Object.keys(a.map), ["t1"]);
  assert.deepEqual(Object.keys(a.filings), ["D2"]);
  assert.deepEqual(amendmentsFor(OLD, ["t1"]), { map: {}, filings: {}, marked: false });
});

test("Deleted is decided by not_counted only: a counted trade with a Deleted printing is a later filing", () => {
  const withMap = { ...NEW, not_counted: { t9: "deleted_by_later_filing" } };
  assert.equal(amendmentsFor(withMap, ["t2"]).marked, true, "the file says which rows are not counted");
  assert.equal(amendmentsFor(NEW, ["t2"]).marked, false, "an older file has no such map");
  assert.match(AMEND.deletedOnePrinting, /deleted one printing; the trade is still reported in another/);
  assert.match(AMEND.notCounted, /listed, not counted/);
  assert.match(AMEND.unmatched, /original report was not identified, so days to public are not given/);
});

test("Reprinted: a counted trade reads 'deleted in filing X · reported again in filing Y'; no raw status string; house:<doc>:<row> is not a link", () => {
  const file = { ...NEW, not_counted: {}, amendments: { t1: [
    { id: "house:D2:4", doc: "D2", status: "Deleted", available: "2020-06-01" },
    { id: "house:D4:1", doc: "D4", status: "Reprinted", available: "2020-07-01" },
  ] }, filings: { ...NEW.filings, D4: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20010004.pdf" } };
  assert.equal(readAmendments(file).t1.length, 2);
  const v = amendmentView(decodeTradeFile(file)[0], readAmendments(file), file.filings);
  assert.deepEqual(v.later.map((l) => AMEND.laterFiling(l.status, l.available, l.doc)), ["deleted in filing D2", "reported again in filing D4"]);
  assert.deepEqual(v.later.map((l) => l.url !== null), [true, true], "both are linked through filings[doc]");
  assert.equal(v.deleted, true, "a Deleted printing is reported, but only not_counted marks the trade not counted");
  const csv = laterFilingsText(readAmendments(file).t1);
  assert.match(csv, /Deleted 2020-06-01 \(filing D2\); Reported again 2020-07-01 \(filing D4\)/);
  assert.doesNotMatch(csv, /Reprinted/);
});

test("full file: trades a later filing marks Deleted are listed but outside the year-window counts", async () => {
  const { viewTable } = await import("../src/lib/domain/recordsview.ts");
  const keys = TRADE_COLS_ALL.map((c) => c.key);
  const r = (o) => keys.map((k) => (k in o ? o[k] : null));
  const rows = [r({ id: "a", date: "2020-05-01", available: "2020-05-09" }), r({ id: "b", date: "2021-05-01", available: "2021-05-09" }), r({ id: "c", date: "2020-06-01", available: "2020-06-09", not_counted: "deleted_by_later_filing" }), r({ id: "d", date: "2021-06-01", available: "2021-06-09", not_counted: "deleted_by_later_filing" })];
  const t = viewTable("trades", TRADE_COLS_ALL, rows, { years: [2020, 2020], basis: "event", assume: DEFAULT_ASSUMPTIONS });
  assert.deepEqual(t.rows.map((x) => x[0]), ["a", "c"], "in-window counted row plus the in-window listed-only row");
  assert.equal(t.total, 2, "total counts the counted rows only");
  const all = viewTable("trades", TRADE_COLS_ALL, rows, { years: null, basis: "event", assume: DEFAULT_ASSUMPTIONS });
  assert.equal(all.rows.length, 4);
  assert.equal(all.total, 2);
});

test("full file: reasons are plain words, not-counted rows stay listed in the undated bucket, caveat tallies count counted rows", async () => {
  const { viewTable } = await import("../src/lib/domain/recordsview.ts");
  const keys = TRADE_COLS_ALL.map((c) => c.key);
  const wire = { cols: COLS, rows: [row("t1", { owner: "unspecified" }), row("t2", { owner: "unspecified", date: null })], filings: {}, not_counted: { t2: "deleted_by_later_filing" }, lag_withheld: { t1: "amended_unmatched" } };
  const rows = tradeRows(wire);
  assert.equal(rows[1][keys.indexOf("not_counted")], "Deleted by a later filing");
  assert.equal(rows[0][keys.indexOf("lag_withheld")], "Amended, original not identified");
  const t = viewTable("trades", TRADE_COLS_ALL, rows, { years: [2020, 2020], basis: "event", assume: DEFAULT_ASSUMPTIONS });
  assert.equal(t.undated.length, 1, "the undated listed-only row is kept, marked");
  assert.equal(t.total, 1);
  const file = { member: { id: "M", fec_ids: [], terms: [], current: true }, edges: [], coverage: [], ledger: null };
  assert.ok(caveats(file, wire).some((c) => /^1 trades have no owner stated/.test(c)), "the deleted row is not tallied");
});
