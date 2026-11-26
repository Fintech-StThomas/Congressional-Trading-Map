// Wording for review flags (/flags, the member trades table, the "Around this trade" panel, /method and the flags feed)
// and for SEC 8-K events. Neutral by rule: a flag says a published rule was met, never anything about intent or
// legality. The statement itself always comes from the data (flags.json or meta.json `statement`); FALLBACK_STATEMENT
// is used only if a file carrying flags lacks it. Import from here, not copy.ts.

export const FALLBACK_STATEMENT = "A flag means a published rule was met and the trade may be worth a reporter's look. A flag is a prompt for reporting, not a finding.";

/** Rule ids are fixed by the contract and never renamed. Labels match flags.json `rules[].label`. */
export const RULE_IDS = ["late", "large_amount", "pile_on", "money_both_ways", "sector_overseen"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const RULE_LABEL: Record<RuleId, string> = {
  late: "Made public after 45 days",
  large_amount: "Large disclosed amount",
  pile_on: "Several members, same stock, within 7 days",
  money_both_ways: "Company PAC gave in the same cycle",
  sector_overseen: "Sector of a committee seat",
};

/** Short forms for badges in dense tables. */
export const RULE_SHORT: Record<RuleId, string> = {
  late: "Over 45 days",
  large_amount: "Large amount",
  pile_on: "Several members",
  money_both_ways: "PAC same cycle",
  sector_overseen: "Committee sector",
};

export const FLAGS = {
  title: "Review flags",
  description: "Trades that meet two or more of five published rules, or any rule and made public in the last 30 days. A flag is a prompt for reporting, not a finding.",
  howTitle: "How to read this",
  how: [
    "Each flag means one fixed rule, published below and on the method page, was met by a filed trade. The rules use only dates, disclosed ranges and exact identifiers in public records.",
    "A flag says nothing about why a trade was made, what the member knew, or whether any rule or law was broken. Most flagged trades will have ordinary explanations, and many trades worth a story meet no rule.",
    "Amounts are the disclosed ranges. Trades belong to the household unless the filing says the member owns the asset.",
  ],
  rulesTitle: "The rules",
  rulesNote: (version: string) => `Method version ${version}. Counts are over every counted trade in this data build; "not evaluated" means the trade lacked what the rule needs, which is never counted as not met.`,
  counts: (met: string, evaluated: string, notEvaluated: string) => `${met} met of ${evaluated} evaluated · ${notEvaluated} not evaluated`,
  baseline: (metShare: string, chance: string) => `${metShare} met; about ${chance} would by chance`,
  baselineDescriptive: (metShare: string, typical: string) => `${metShare} met; about ${typical} expected from the description`,
  methodLink: "How this rule works",
  tableTitle: "Flagged trades",
  viewMulti: "Two or more rules",
  viewRecent: "Made public in the last 30 days",
  viewAria: "Which trades to list",
  ruleFilter: "Rule",
  anyRule: "Any rule",
  shown: (n: string, total: string) => `${n} of ${total} trades`,
  more: (n: number) => `Show ${n} more`,
  rowLink: "Open trade",
  cols: { member: "Member", traded: "Traded", made: "Made public", company: "Company", action: "Action", range: "Disclosed range", rules: "Rules met" },
  truncated: (n: string) => `The file keeps the first ${n} trades by number of rules, then newest public date; more trades met the selection.`,
  none: "No trade in this data build meets this selection.",
  unavailableTitle: "Review flags are not available for this data build",
  unavailableBody: "This build was made before review flags were published. Nothing is shown rather than a count of zero.",
  recentTo: (d: string) => `Window: the 30 days up to ${d}, the data build date.`,
  // member page
  summaryLead: "Review flags met by this household's trades:",
  summaryNone: "No counted trade met any of the five review-flag rules.",
  pageLink: "All review flags",
  badge: (n: number) => (n === 1 ? "1 flag" : `${n} flags`),
  badgeAria: (n: number) => `${n === 1 ? "1 review flag" : `${n} review flags`}. Open what is around this trade`,
  aroundColumn: "Around",
  aroundOpen: "Open what is around this trade",
  // feed
  feedTitle: "Paper Trail: flagged trades made public in the last 30 days",
  feedNote: "Trades that met at least one published review-flag rule and became public in the 30 days up to the data build date.",
  feedRules: (labels: string) => `Rules met: ${labels}.`,
  feedLink: "RSS feed of flagged trades made public in the last 30 days",
} as const;

export const AROUND = {
  title: "Around this trade",
  close: "Close",
  flagsTitle: "Review flags met",
  noFlags: "This trade met none of the review-flag rules that could be checked for it.",
  notCounted: "This trade is not counted: a later filing deleted it, so the review-flag rules were not checked for it.",
  notChecked: (list: string) => `Not checked for this trade: ${list}.`,
  reasons: {
    noLag: "no days to public: a date is missing or the lag is withheld",
    noRange: "no disclosed range",
    noDate: "no transaction date",
    noTicker: "no ticker",
    notBuySell: "not a buy or a sell",
    fundOrBond: "a fund or bond",
    noCompany: "no SEC-registered company",
    noFec: "no FEC candidate id for the member",
    former: "former member: committee rosters are current only",
    beforeRoster: "before 2025-01-03: committee rosters are the current Congress only",
    fund: "a fund",
  },
  late: (days: string) => `Made public ${days} after the transaction date.`,
  large: (range: string) => `Disclosed range ${range}.`,
  pileOn: (observed: string, expected: string) => `${observed} other members traded it the same way within 7 days; about ${expected} expected by chance.`,
  money: "This company's PAC gave money to the member in the trade's two-year cycle.",
  moneyOpen: "Open the PAC money records",
  moneyLedger: "The tie is listed as a totals row in the member's full file; it has no published record id.",
  committee: (name: string) => `The member sits on ${name}, whose jurisdiction covers this company's industry code.`,
  secTitle: "Company 8-K filings within 30 days either side",
  secUnavailable: "SEC filings not available for this company.",
  secNoDate: "The trade has no transaction date, so there is no window to look in.",
  secNoCompany: "No SEC-registered company is identified for this trade.",
  secOutside: (from: string, to: string) => `The SEC filings read for this company run from ${from} to ${to}; this trade's 30-day window falls partly or wholly outside them, so filings may be missing.`,
  secPartial: (from: string) => `Older SEC filings for this company could not all be read; the span read begins ${from}, so this list may be incomplete.`,
  secNone: "No 8-K was filed in the 30 days either side of the trade.",
  secMaybe: "No 8-K is in the data for this window, but the filings read do not cover all of it.",
  secNotCounted: "8-K filings are kept only near counted trades. This trade is not counted, so filings in its window may be missing from this list.",
  secLoading: "Loading the company's filings…",
  secError: "The company's filings could not be loaded.",
  secCols: { date: "Filed", form: "Form", items: "Items", link: "Filing" },
  secDays: (n: number) => (n === 0 ? "same day" : n > 0 ? `${n} d after` : `${-n} d before`),
  pacTitle: (cycle: string) => `PAC money from this company in the ${cycle} cycle`,
  pacNone: (cycle: string) => `No PAC money from this company to this member is in this data for the ${cycle} cycle. Only about a fifth of PAC dollars attach to a named company, so money from its PAC may be recorded under another name.`,
  pacTrimmed: (cycle: string) => `No PAC money from this company to this member for the ${cycle} cycle is among the ties published for this former member, which keep only the largest. Only about a fifth of PAC dollars attach to a named company.`,
  pacFlagged: "The review flag names a PAC money tie from this company in this cycle, but its records are not in the member's published file.",
  pacTotal: (amount: string, n: string) => `${amount} in ${n} in these years.`,
  pacLedger: (amount: string, n: string, first: string, last: string) => `${amount} in ${n}, ${first} to ${last}. A totals row: records are not published one by one.`,
  pacLedgerSpan: "Some of these records may fall outside the cycle; the totals row does not split them by year.",
  pacFec: "Committee on FEC.gov",
  othersTitle: "Other members trading it within 7 days",
  othersNone: "Other members' trades are listed here only when the trade met the “Several members, same stock, within 7 days” rule.",
  newsLink: "Search news coverage",
  newsNote: "Opens a news search for the company name over the trade date ±14 days. Nothing is stored.",
} as const;

/** 8-K item codes in short plain words (Form 8-K general instructions). Unknown codes read "Item <code>". */
export const SEC_ITEM_LABEL: Record<string, string> = {
  "1.01": "Entered a material agreement",
  "1.02": "Ended a material agreement",
  "1.03": "Bankruptcy or receivership",
  "1.04": "Mine safety report",
  "1.05": "Cybersecurity incident",
  "2.01": "Completed an acquisition or sale of assets",
  "2.02": "Results of operations",
  "2.03": "New debt or financial obligation",
  "2.04": "Debt or obligation accelerated",
  "2.05": "Exit or restructuring costs",
  "2.06": "Material impairment",
  "3.01": "Delisting or listing notice",
  "3.02": "Unregistered sale of shares",
  "3.03": "Change to shareholders' rights",
  "4.01": "Change of auditor",
  "4.02": "Past financial statements not to be relied on",
  "5.01": "Change in control",
  "5.02": "Officer or director change",
  "5.03": "Change to articles or bylaws",
  "5.04": "Pause in employee plan trading",
  "5.05": "Change to code of ethics",
  "5.06": "Change in shell company status",
  "5.07": "Shareholder vote results",
  "5.08": "Shareholder director nominations",
  "6.01": "Asset-backed securities report",
  "6.02": "Asset-backed securities report",
  "6.03": "Asset-backed securities report",
  "6.04": "Asset-backed securities report",
  "6.05": "Asset-backed securities report",
  "7.01": "Regulation FD disclosure",
  "8.01": "Other events",
  "9.01": "Financial statements and exhibits",
};

export const METHOD_FLAGS = {
  title: "Review flags",
  intro: (counted: string, flagged: string) => `Every counted trade is checked against five fixed rules on every build. In this build ${flagged} of ${counted} counted trades met at least one rule.`,
  version: (v: string) => `Method version ${v}.`,
  thresholds: "Thresholds",
  listed: "The trades meeting two or more rules, and those meeting any rule made public in the last 30 days, are listed on the review flags page.",
  secTitle: "SEC 8-K events",
  sec: "For companies registered with the SEC, the build reads the company's Form 8-K and 8-K/A filings from the SEC EDGAR submissions API: the filing date, the item codes and a link to each filing. They are shown beside a trade as context, within 30 days either side. They are context only, not a review flag: trades fall before a listed 8-K about as often as chance would give. An 8-K is filed up to four business days after the event it reports, and the event may have been public earlier. Where the filings for a company could not be read, the site says “not available”, never “no filings”.",
  secRetrieved: (d: string) => `Retrieved ${d}.`,
} as const;
