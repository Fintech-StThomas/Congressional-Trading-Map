// Unit tests for later filings of a trade (src/lib/domain/amendments.ts, the records columns and the wording): files with
// and without `amendments` both read, a Deleted mark is said plainly and the trade stays, links come from `filings`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amendmentsFor, amendmentView, laterFilingUrls, laterFilingsText, readAmendments } from "../src/lib/domain/amendments.ts";
import { tradeRows, TRADE_COLS_ALL, documentRows, caveats } from "../src/lib/domain/records.ts";
import { decodeTradeFile } from "../src/lib/data/decode.ts";
import { AMEND } from "../src/lib/copy-amend.ts";

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
  assert.match(AMEND.deletedNote, /stays in the data/);
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
  assert.deepEqual(amendmentsFor(OLD, ["t1"]), { map: {}, filings: {} });
});
