// Unit tests for review flags and SEC 8-K context (src/lib/domain/flags.ts, secevents.ts, flagsfeed.ts): 8-K item
// labels, the 30-day selections, the coverage wording (never "no filings" unless coverage is complete over the
// window), the PAC cycle, baselines (shown only when published) and the feed items. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baselineText, cycleOf, dayDiff, decodeFlagRows, madePublicWithin, maskRules, metRules, pacInCycle, readFlags, ruleMask, selectRows, statementOf,
} from "../src/lib/domain/flags.ts";
import { addDays, eventsNear, itemLabel, newsSearchUrl, searchName, secFilingUrl, secState, secStateText } from "../src/lib/domain/secevents.ts";
import { flagItem, recentFlagRows } from "../src/lib/domain/flagsfeed.ts";
import { AROUND, FALLBACK_STATEMENT, RULE_IDS } from "../src/lib/copy-flags.ts";

const COLS = ["member", "id", "date", "available", "ticker", "org", "action", "low", "high", "rules"];
const FILE = {
  method_version: "flags-1", build_date: "2026-11-25", statement: "A flag is a prompt for reporting, not a finding.",
  rules: [{ id: "late", label: "Made public after 45 days", definition: "d", thresholds: {}, counts: { met: 10, evaluated: 100, not_evaluated: 5 }, note: null }],
  selection: {}, cols: COLS,
  rows: [
    ["A000001", "t1", "2026-01-02", "2026-08-07", "LLY", "co:59478", "buy", 1001, 15000, ["late", "pile_on"]],
    ["A000002", "t2", "2026-10-20", "2026-11-25", "AAPL", "co:320193", "sell", 250001, 500000, ["large_amount", "bogus"]],
    ["A000003", "t3", "2026-10-01", "2026-10-26", null, null, "buy", null, null, ["late"]],
    ["A000004", "t4", null, null, null, null, "buy", null, null, ["late", "large_amount"]],
  ],
};

test("8-K item labels: the codes in the brief, and unknown codes say so", () => {
  assert.equal(itemLabel("1.01"), "Entered a material agreement");
  assert.equal(itemLabel("2.02"), "Results of operations");
  assert.equal(itemLabel("5.02"), "Officer or director change");
  assert.equal(itemLabel("9.01"), "Financial statements and exhibits");
  assert.equal(itemLabel("9.99"), "Item 9.99");
});

test("readFlags: null for older builds and malformed files; the statement falls back only when missing", () => {
  assert.equal(readFlags(null), null);
  assert.equal(readFlags({ rows: [] }), null);
  assert.equal(readFlags(FILE).statement, FILE.statement);
  assert.equal(readFlags({ ...FILE, statement: "" }).statement, FALLBACK_STATEMENT);
  assert.equal(statementOf(undefined), FALLBACK_STATEMENT);
});

test("rows decode by column name and drop unknown rule ids", () => {
  const rows = decodeFlagRows(FILE);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].rules, ["large_amount"]);
  assert.equal(rows[2].ticker, null);
  assert.deepEqual(maskRules(ruleMask(["pile_on", "late"])), ["late", "pile_on"]);
  // A rule an older release published (flags-1's before_company_news) is ignored, never a crash.
  const old = decodeFlagRows({ cols: COLS, rows: [["A000005", "t5", null, null, null, null, "buy", null, null, ["late", "before_company_news"]]] });
  assert.deepEqual(old[0].rules, ["late"]);
  assert.equal(ruleMask(["before_company_news"]), 0);
  assert.deepEqual(metRules({ before_company_news: { accession: "a", date: "2025-01-01", items: ["1.01"] }, late: { lag_days: 50 } }), ["late"]);
});

test("the 30-day window: build_date - 30 < available <= build_date; undated rows are never in it", () => {
  assert.equal(madePublicWithin("2026-11-25", "2026-11-25"), true);
  assert.equal(madePublicWithin("2026-10-27", "2026-11-25"), true, "29 days back");
  assert.equal(madePublicWithin("2026-10-26", "2026-11-25"), false, "30 days back is outside");
  assert.equal(madePublicWithin("2026-11-26", "2026-11-25"), false, "after the build");
  assert.equal(madePublicWithin(null, "2026-11-25"), false);
  const rows = decodeFlagRows(FILE);
  assert.deepEqual(selectRows(rows, "recent", FILE.build_date).map((r) => r.id), ["t2"]);
  assert.deepEqual(selectRows(rows, "multi", FILE.build_date).map((r) => r.id), ["t1", "t4"]);
  assert.deepEqual(selectRows(rows, "multi", FILE.build_date, "pile_on").map((r) => r.id), ["t1"]);
  assert.equal(dayDiff("2024-02-28", "2024-03-01"), 2, "leap year");
});

test("8-Ks within 30 days either side, inclusive, in date order with offsets", () => {
  const ev = (date, accession) => ({ date, accepted: null, form: "8-K", items: ["8.01"], accession, url: "https://www.sec.gov/x" });
  const near = eventsNear([ev("2026-02-01", "c"), ev("2025-12-03", "a"), ev("2025-12-02", "z"), ev("2026-01-02", "b"), ev("2026-02-02", "y")], "2026-01-02");
  assert.deepEqual(near.map((e) => [e.accession, e.offset]), [["a", -30], ["b", 0], ["c", 30]]);
  assert.deepEqual(eventsNear(undefined, "2026-01-02"), []);
  assert.deepEqual(eventsNear([ev("2026-01-02", "b")], null), []);
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
});

test("coverage wording: 'not available' without coverage, 'no 8-K' only when complete over the whole window", () => {
  const cov = { from: "2011-12-02", to: "2026-11-17", complete: true };
  assert.equal(secStateText(secState("co:1", undefined, "2026-01-02"), true), AROUND.secUnavailable);
  assert.equal(secStateText(secState("tk:ABC", cov, "2026-01-02"), true), AROUND.secNoCompany);
  assert.equal(secStateText(secState(null, cov, "2026-01-02"), true), AROUND.secNoCompany);
  assert.equal(secStateText(secState("co:1", cov, null), true), AROUND.secNoDate);
  assert.equal(secStateText(secState("co:1", cov, "2026-01-02"), true), AROUND.secNone);
  assert.equal(secStateText(secState("co:1", cov, "2026-01-02"), false), null);
  // The window runs past the span read (a recent trade), or before it: never "no filings".
  const late = secState("co:1", cov, "2026-11-01");
  assert.equal(late.kind, "outside");
  assert.notEqual(secStateText(late, true), AROUND.secNone);
  assert.equal(secState("co:1", cov, "2011-12-20").kind, "outside");
  const partial = secState("co:1", { ...cov, complete: false }, "2026-01-02");
  assert.equal(partial.kind, "partial");
  assert.equal(secStateText(partial, true), AROUND.secMaybe);
  assert.match(secStateText(partial, false), /may be incomplete/);
});

test("SEC filing folder and news search links", () => {
  assert.equal(secFilingUrl("co:59478", "0000059478-13-000002"), "https://www.sec.gov/Archives/edgar/data/59478/000005947813000002/");
  assert.equal(secFilingUrl("tk:LLY", "0000059478-13-000002"), null);
  assert.equal(secFilingUrl("co:59478", "bad"), null);
  assert.equal(searchName("APPLE INC."), "APPLE");
  assert.equal(searchName("LILLY ELI & CO"), "LILLY ELI");
  const u = new URL(newsSearchUrl("Microsoft Corp", "2026-03-01"));
  assert.equal(u.searchParams.get("q"), "Microsoft");
  assert.equal(u.searchParams.get("tbs"), "cdr:1,cd_min:2/15/2026,cd_max:3/15/2026");
  assert.equal(newsSearchUrl("", "2026-03-01"), null);
});

test("PAC money in the trade's two-year cycle (year + year % 2)", () => {
  assert.equal(cycleOf("2025-03-01"), 2026);
  assert.equal(cycleOf("2026-12-31"), 2026);
  assert.equal(cycleOf(null), null);
  const e = {
    id: "e1", via: { id: "pac:C1", name: "ACME PAC" },
    by_year: [{ y: 2024, n: 1, low: 500, high: 500, exact: 500 }, { y: 2025, n: 2, low: 1000, high: 1000, exact: 1000 }, { y: 2026, n: 1, low: 250, high: 250, exact: 250 }],
    evidence: [{ date: "2024-05-01", label: "old", url: null }, { date: "2026-02-01", label: "new", url: "https://docquery.fec.gov/x" }],
  };
  const m = pacInCycle(e, 2026);
  assert.equal(m.exact, 1250);
  assert.equal(m.n, 3);
  assert.deepEqual(m.evidence.map((x) => x.label), ["new"]);
  assert.equal(pacInCycle(e, 2030), null, "no records in the cycle is null, not a zero");
});

test("baseline: shown only when published", () => {
  const r = FILE.rules[0];
  assert.equal(baselineText(r), null);
  assert.equal(baselineText({ ...r, baseline: { kind: "chance", expected_met: null, expected_share: 0.02, method: "m" } }), "10% met; about 2.0% would by chance");
  assert.equal(baselineText({ ...r, baseline: { kind: "chance", expected_met: 5, expected_share: null, method: "m" } }), "10% met; about 5.0% would by chance");
  assert.match(baselineText({ ...r, baseline: { kind: "descriptive", expected_met: null, expected_share: 0.1, method: "m" } }), /expected from the description/);
});

test("met rules in the fixed order", () => {
  assert.deepEqual(metRules({ pile_on: {}, late: { lag_days: 50 } }), ["late", "pile_on"]);
  assert.deepEqual(metRules(undefined), []);
  assert.deepEqual([...RULE_IDS], ["late", "large_amount", "pile_on", "money_both_ways", "sector_overseen"]);
});

test("feed items: recent rows only, newest first, neutral wording with the statement", () => {
  const rows = recentFlagRows(decodeFlagRows(FILE), FILE.build_date);
  assert.deepEqual(rows.map((r) => r.id), ["t2"]);
  const it = flagItem(rows[0], { member: () => ({ name: "Pat Doe", party: "D", state: "CA" }), org: () => "APPLE INC" }, FILE.rules, FILE.statement, { sourceName: "src", release: null, built: "2026-11-25" });
  assert.equal(it.title, "Pat Doe (D-CA): sell APPLE INC (AAPL), $250,001–$500,000");
  assert.match(it.link, /\/m\/A000002\?t=t2#trades$/);
  assert.match(it.description, /Rules met: Large disclosed amount\./);
  assert.match(it.description, /prompt for reporting, not a finding/);
  assert.doesNotMatch(it.description + it.title, /suspicious|corrupt|insider|red flag/i);
  // With the flags-3 owner column the title names the owner exactly as the trades feed does.
  const withOwner = { ...FILE, cols: [...COLS, "owner"], rows: FILE.rows.map((r, i) => [...r, ["spouse", "spouse", "self", "unspecified"][i]]) };
  const own = recentFlagRows(decodeFlagRows(withOwner), FILE.build_date)[0];
  const it2 = flagItem(own, { member: () => ({ name: "Pat Doe", party: "D", state: "CA" }), org: () => "APPLE INC" }, FILE.rules, FILE.statement, { sourceName: "src", release: null, built: "2026-11-25" });
  assert.equal(it2.title, "Pat Doe (D-CA), owner spouse: sell APPLE INC (AAPL), $250,001–$500,000");
  assert.equal(decodeFlagRows(withOwner)[3].owner, "unspecified");
});
