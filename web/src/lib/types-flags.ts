// Types of the review flags (flags.json, TradeFile.flags, meta.json.flags) and the SEC 8-K fields of organisation files,
// split out of types.ts to keep it under the line cap. Data dictionary: "Review flags" and "SEC 8-K events";
// method: docs/review-flags.md. A flag means only that a published rule was met: a prompt for reporting, not a finding.

/** Per-rule detail of a met rule, by rule id: late | large_amount | pile_on | money_both_ways | sector_overseen. */
export type FlagDetail =
  | { lag_days: number }
  | { low: number }
  | { members: string[]; observed: number; expected: number } // <= 5 member ids, nearest in time first; expected to 3 decimals
  | { edge: string }                                          // a pac_money edge id (or a ledger row, which has no published id)
  | { committee: string };                                    // cmte:<thomas id>

/** evaluated + not_evaluated = counted trades. Not evaluated is never "not met". */
export type FlagCounts = { met: number; evaluated: number; not_evaluated: number };

/** Optional per-rule baseline (added by a later pipeline change): "x% met; about y% would by chance". */
export type FlagBaseline = { kind: "chance" | "descriptive"; expected_met: number | null; expected_share: number | null; method: string };

export type FlagRule = {
  id: string; label: string; definition: string; thresholds: Record<string, unknown>; counts: FlagCounts; note: string | null;
  baseline?: FlagBaseline;
};

export type ReviewFlags = {   // flags.json
  method_version: string;
  build_date: string;         // UTC date of the build: the end of the "last 30 days"
  statement: string;
  rules: FlagRule[];          // fixed order
  selection: { rule: string; min_rules: number; recent_days: number; max_rows: number; order: string; rows_selected: number; rows_published: number; truncated: boolean };
  cols: string[];             // member, id, date, available, ticker, org, action, low, high, rules, owner (owner from flags-3)
  rows: unknown[][];
};

/** meta.json.flags: the summary /method reads; absent in older builds. */
export type MetaFlags = { method_version: string; file: string; rules: { [ruleId: string]: FlagCounts }; trades_counted: number; trades_flagged: number; statement: string };

/** The span of a company's SEC filings that was read: inside it the 8-K list is complete when `complete`. */
export type SecCoverage = { from: string; to: string; complete: boolean };

export type SecEvent = {
  date: string;               // filingDate
  accepted: string | null;    // acceptanceDateTime, UTC
  form: "8-K" | "8-K/A";
  items: string[];            // "2.02"
  accession: string;
  url: string;                // www.sec.gov/Archives
};
