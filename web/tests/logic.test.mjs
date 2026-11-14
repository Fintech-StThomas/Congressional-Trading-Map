// Unit tests for the fixes from the code review (web/REVIEW.md): formatting of ranges, link safety,
// CSV injection, year-window sums, organisation tie totals, ledger direction and Case wording.
// Loaded with Node's built-in type stripping; no server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountText, money, rankAmount, yearRange, yearSpan, date, plural } from "../src/lib/format.ts";
import { recordUrlFor, safeHttpUrl, boardHref, orgHref } from "../src/lib/urls.ts";
import { csvCell, toCSV, sortRows } from "../src/lib/domain/records.ts";
import { directionWord, edgeDir, filteredAmount, tiePhrase } from "../src/lib/domain/edges.ts";
import { decodeLedger, FAMILY_OF, ledgerTieCount, orgTieTotal } from "../src/lib/data/decode.ts";
import { caseHoldingWords, caseRuleText, noCasesText } from "../src/lib/copy.ts";

test("an open-ended range reads 'or more', never as a single figure", () => {
  assert.equal(amountText({ low: 1000001, high: null, exact: null }), "$1,000,001 or more");
  assert.equal(amountText({ low: 15001, high: 50000, exact: null }), "$15,001–$50,000");
  assert.equal(amountText({ low: null, high: null, exact: null }), null);
  assert.equal(money(null), "not disclosed");
  assert.equal(rankAmount({ low: 1, high: 5, exact: null }), 5);
});

test("dates and years are read from the string, without a time-zone shift", () => {
  assert.equal(date("2021-03-01"), "1 Mar 2021");
  assert.equal(date("2021-01-01T00:00:00-05:00"), "1 Jan 2021");
  assert.equal(yearSpan("2014-10-06", "2016-11-01"), "2014–2016");
  assert.equal(yearRange([2020, 2020]), "2020");
  assert.equal(plural(1, "trade"), "1 trade");
  assert.equal(plural(1204, "trade"), "1,204 trades");
});

test("only http(s) URLs from the data become links", () => {
  assert.equal(safeHttpUrl("https://www.fec.gov/x"), "https://www.fec.gov/x");
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("data:text/html,<script>"), null);
  assert.equal(safeHttpUrl(" JAVASCRIPT:alert(1)"), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(recordUrlFor("pac:C00123456:oppose"), "https://www.fec.gov/data/committee/C00123456/");
  assert.equal(recordUrlFor("co:320193"), "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=320193");
  assert.equal(recordUrlFor("tk:XYZ"), null);
  assert.equal(orgHref("co:1"), "/o/co%3A1");
  assert.equal(boardHref({ m: "K000389", s: "CA" }), "/?s=CA&m=K000389");
});

test("CSV cells that a spreadsheet would run as formulas are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell(-500), "-500", "numbers stay numbers");
  assert.equal(csvCell("ACME, Inc."), '"ACME, Inc."');
  assert.equal(toCSV([{ key: "a", label: "A", kind: "text" }], [["=1"]]), "A\r\n'=1\r\n");
});

test("numbers sort as numbers, nulls last", () => {
  const rows = [[10], [null], [9], [100]];
  assert.deepEqual(sortRows(rows, 0, false).map((r) => r[0]), [9, 10, 100, null]);
  assert.deepEqual(sortRows(rows, 0, true).map((r) => r[0]), [100, 10, 9, null]);
});

const byYear = (rows) => ({ amount: { low: null, high: null, exact: null }, count: 0, by_year: rows });

test("a year window sums lows, and high/exact become unknown when any year lacks them", () => {
  const e = byYear([
    { y: 2014, n: 1, low: 1001, high: 15000, exact: null },
    { y: 2015, n: 2, low: 1000001, high: null, exact: null },
    { y: 2016, n: 1, low: 15001, high: 50000, exact: null },
  ]);
  assert.deepEqual(filteredAmount(e, [2014, 2015]), { low: 1001002, high: null, exact: null, n: 3 });
  assert.deepEqual(filteredAmount(e, [2016, 2016]), { low: 15001, high: 50000, exact: null, n: 1 });
  assert.deepEqual(filteredAmount(e, [2001, 2002]), { low: null, high: null, exact: null, n: 0 });
  const fec = byYear([{ y: 2010, n: 2, low: 500, high: 500, exact: 500 }, { y: 2011, n: 1, low: 250, high: 250, exact: 250 }]);
  assert.deepEqual(filteredAmount(fec, [2010, 2011]), { low: 750, high: 750, exact: 750, n: 3 });
});

test("an organisation's total ties = listed ties + ledger-only ties", () => {
  const file = {
    org: { id: "co:1" },
    ties: { cols: ["type", "member"], rows: [["pac_money", "A"], ["traded", "B"]] },
    ledger_totals: { pac_money: { edges: 5, records: 9, low: 1, high: 1, exact: 1 }, outside_spending: { edges: 2, records: 2, low: 1, high: 1, exact: 1 } },
  };
  assert.equal(orgTieTotal(file), 9);
  assert.equal(ledgerTieCount({ sits_with: { edges: 40 }, pac_money: { edges: 3 } }, ["sits_with"]), 3);
});

test("ledger rows keep their direction; tie families follow the contract", () => {
  const rows = decodeLedger({
    ledger: { cols: ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"], rows: [["funds", "member", "M1", null, 10, 10, 10, 1, "2002-01-01", "2002-01-01", null, "in"]] },
  });
  assert.equal(rows[0].dir, "in");
  assert.equal(directionWord(rows[0].dir), " from");
  assert.equal(directionWord("out"), " to");
  assert.equal(edgeDir({ directed: true, from: { id: "X" }, to: { id: "SELF" } }, "SELF"), "in");
  assert.equal(FAMILY_OF.position, "people");
  assert.equal(FAMILY_OF.oversees, "context");
});

test("outside spending with no recorded side is not called support", () => {
  const e = {
    type: "outside_spending", from: { kind: "org", id: "pac:C1" }, to: { kind: "member", id: "M1" }, note: null, via: null,
    amount: { low: 100, high: 100, exact: 100 }, count: 1, by_year: [],
  };
  assert.match(tiePhrase(e, "M1", "Org"), /in the race of/);
  assert.match(tiePhrase({ ...e, note: "support" }, "M1", "Org"), /independently to support/);
  assert.match(tiePhrase({ ...e, note: "oppose" }, "M1", "Org"), /opposing/);
});

test("a case is described by its own types (a holding need not be a trade)", () => {
  assert.equal(caseHoldingWords({ types: ["owns", "pac_money"], trades: 0 }), "held the stock (annual report)");
  assert.equal(caseHoldingWords({ types: ["traded", "pac_money"], trades: 1 }), "traded the stock (1 trade)");
  assert.match(caseHoldingWords({ types: ["owns", "traded", "pac_money"], trades: 12 }), /traded the stock \(12 trades\) and held it/);
  assert.match(caseRuleText(2), /at least two kinds/);
  assert.match(noCasesText(2), /two or more/);
});
