// The site's fixed wording, in one place: name and tagline, the disclaimer and legal notices,
// "what this does not show" for each tie type, and how a Case is described.
// Pure (types only); change the voice here, not in components.
import type { Case, EdgeType } from "./types.ts";

export const SITE = {
  name: "Paper Trail",
  tagline: "Talk is cheap. Follow the money.",
  description:
    "A map of every member of Congress and the organisations and colleagues they are tied to by filed public records: stock trades, PAC money, outside spending, member-to-member money and committee seats. Every string shows its records.",
  /** The live site, for plain URLs printed on paper and as the metadata base outside Vercel. */
  url: "https://red-paper-trail.vercel.app",
  disclaimer: "A tie is not a finding. This shows what the filings say, not why.",
} as const;

// ---------------------------------------------------------------- about
// Who builds the site, how it is paid for, and what it keeps about visitors. Shown on /about.
export const ABOUT = {
  team: ["Yuepheng Yang", "Cole Pawlenty", "Jacob Moreno", "Nikhil Jangir"],
  origin: "Paper Trail began as a university class project in financial technology and is built and maintained by four students.",
  funding: "Paper Trail is not funded by anyone. It is free to use, carries no advertising and asks for no donations.",
  openSource:
    "The code for the site and for the data build is open source under the MIT licence. Anyone can read it, run it and check how every figure is produced.",
  independence:
    "The site has no affiliation with any party, campaign, company or member of Congress. Every party is treated by the same rules, which are published on the method page.",
  visitors:
    "The site sets no cookies and has no accounts. It counts page views with a cookie-free tool that does not identify or follow individual visitors.",
  repoUrl: "https://github.com/Fintech-StThomas/Congressional-Trading-Map",
} as const;

// ---------------------------------------------------------------- corrections
// Corrections go through the public issue tracker: every report and its outcome is in the open.

export const CORRECTIONS = {
  /** The public repository whose issues are the corrections log. */
  repo: "https://github.com/Fintech-StThomas/Congressional-Trading-Map",
  /** The label every correction report carries; the filtered issue list is the public log. */
  label: "correction",
  /** Footer, member page, full file. */
  link: "Report a correction",
  /** The evidence drawer. */
  recordLink: "Something wrong with this record?",
  /** Shown next to the link where there is room. */
  note: "Opens a public issue on GitHub, prefilled with this page. A free GitHub account is needed.",
  /** Issue title: "Correction: <what>". */
  title: (what: string) => `Correction: ${what}`,
  /** The prefilled body: what the site knows, then three prompts for the reader. */
  body: (lines: { page: string; built: string | null; details?: string[] }) =>
    [
      `Page: ${lines.page}`,
      `Data build: ${lines.built ?? "unknown"}`,
      ...(lines.details ?? []),
      "",
      "### What is wrong",
      "<!-- What does the site show that the filing does not say? A wrong match of a company, PAC or person? A missing record? -->",
      "",
      "### What the filing says",
      "",
      "",
      "### Link to the filing",
      "<!-- The official record (FEC, House Clerk, Senate eFD), if you have it. -->",
      "",
      "<!-- Reports are public. Please do not include personal contact details beyond what you are happy to publish. -->",
    ].join("\n"),
} as const;

/** The Corrections policy on /method, one paragraph per entry. */
export const CORRECTIONS_POLICY = {
  heading: "Corrections policy",
  counts:
    "A correction is due when this site shows something the filing does not say, when it matches a record to the wrong company, PAC or person, or when a filed record is missing. A tie we draw correctly from a filing that is itself wrong is not something we can fix: only the filer can amend a filing, with the House Clerk, the Senate or the FEC. When a filer amends, the next build picks up the amended version.",
  how:
    "Report a correction through the public issue tracker. The link at the foot of every page, on each member page, in the full file and in every evidence drawer opens a new issue already filled in with the page you were on and the data build; add what is wrong, what the filing says and a link to it if you have one.",
  reply:
    "Members of Congress and their offices can use the same route to reply to anything shown about them. We treat their reports exactly like anyone else’s: against the filings.",
  response:
    "We read every report. We check it against the filing and say on the issue what we found and what, if anything, changed. We do not promise a turnaround time.",
  where:
    "Corrections are made in the data pipeline, never by hand on a page, so the same fix reaches every page that shows the record. They take effect at the next daily build.",
  log: "The list of reports is the public corrections log:",
  logLink: "every issue labelled correction",
} as const;

/** 5 U.S.C. 13107(c), quoted on the full file, the printed case file and in downloads. */
export const USE_NOTICE =
  "Use is restricted by 5 U.S.C. 13107(c): it is unlawful to obtain or use a financial disclosure report for any unlawful purpose, for any commercial purpose other than by news and communications media for dissemination to the general public, for determining or establishing the credit rating of any individual, or for use, directly or indirectly, in the solicitation of money for any political, charitable or other purpose.";

export const SENATE_NOTE = "No annual-report data for senators yet: the source has House annual reports only.";

// ---------------------------------------------------------------- what a tie does not show

export const CASE_NOT_SHOWN =
  "Does not show who made the trade decision, whether the member knew of it, or any link between the money and the trade.";

export const NOT_SHOWN: Record<EdgeType, string> = {
  traded: "Does not show who made the trade decision, whether the member knew of it, or why; amounts are ranges, not values.",
  owns: "Does not show when the holding was bought, what it is worth now, or any decision the member took about it.",
  position: "Does not show what the role involved, whether it was paid, or any influence on the member’s work.",
  pac_money: "Does not show what, if anything, the PAC expected; PAC giving is legal, public and routine.",
  employee_money: "Does not show that the employer directed the gifts; employees give in their own names.",
  lobbyist_money: "Does not show what the lobbyist asked for, or that any request was made.",
  outside_spending: "Spent independently; by law not coordinated with the member.",
  paid_travel: "Does not show what was discussed on the trip or whether it affected any decision.",
  revolving_door: "Does not show what the person worked on, or any contact with the member after the move.",
  oversees: "Does not show any action the committee took about this organisation.",
  funds: "Does not show why the money was given or anything expected in return; giving to colleagues is routine.",
  fundraises_with: "Does not show any agreement between the members beyond the shared committee.",
  shared_donors: "Shared donors are common among members of the same party and region; not evidence of coordination.",
  traded_together: "Frequent traders overlap often; not evidence of coordination.",
  legislates_with: "Does not show agreement on any particular bill or any arrangement between the members.",
  shared_staff: "Does not show what the staff member worked on for either office.",
  sits_with: "Committee seats are assigned by party leaders; not a tie either member chose.",
};

export function notShown(type: EdgeType | "case"): string {
  return type === "case" ? CASE_NOT_SHOWN : NOT_SHOWN[type] ?? "";
}

// ---------------------------------------------------------------- Cases
// The Case rule (docs/data-dictionary.md, Case): at least two distinct filed tie types between one
// member and one organisation, at least one a holding (a trade or a disclosed holding) and at least
// one money or people, active in a common year. In practice: traded and/or owns, plus PAC money.

/** One sentence for the rule, used wherever a Case is explained. `minTypes` comes from meta.json when present. */
export function caseRuleText(minTypes = 2): string {
  const n = minTypes === 2 ? "two" : String(minTypes);
  return `A case is a member and an organisation tied by at least ${n} kinds of filed record in the same years: a holding (the household traded or held its stock) and money or people (such as its PAC giving the member money).`;
}

/** The /cases list: filters, count and pager. */
export const CASES_COPY = {
  filterLabel: "Filter cases",
  ties: "Ties",
  chamber: "Chamber",
  party: "Party",
  any: "Any",
  both: "Both",
  clear: "Clear filters",
  none: "No case matches these filters.",
  range: (first: number, last: number, total: number) =>
    `Cases ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}.`,
  rankNote: "Numbers are each case’s rank among all cases.",
  pagerLabel: "Pages of cases",
  prev: "← Previous",
  next: "Next →",
  pageLabel: (n: number) => `Page ${n}`,
  jump: "Go to page",
  of: (n: number) => `of ${n.toLocaleString("en-US")}`,
} as const;

/** The Legend line and the board's card label for a Case tag. */
export const CASE_TAG_TEXT = "the household traded or held the company’s stock and the member received money from it in the same years";

/** The empty state when a build has no cases. */
export function noCasesText(minTypes = 2): string {
  const n = minTypes === 2 ? "two" : String(minTypes);
  return `No member and organisation pair has ${n} or more kinds of filed tie that overlap in time in this build.`;
}

/** Holding part of one case, in words: "traded the stock (12 trades)", "held the stock", or both. */
export function caseHoldingWords(c: Pick<Case, "types" | "trades">): string {
  const traded = c.types.includes("traded");
  const owns = c.types.includes("owns");
  const trades = traded ? `traded the stock${c.trades ? ` (${c.trades.toLocaleString("en-US")} ${c.trades === 1 ? "trade" : "trades"})` : ""}` : "";
  if (traded && owns) return `${trades} and held it`;
  if (traded) return trades;
  if (owns) return "held the stock (annual report)";
  return "held a position";
}

// ---------------------------------------------------------------- holdings over time (House annual reports)
// What each holdings panel does not show, and the wording of the position-timeline classes. Rules:
// docs/data-dictionary.md, "Holdings and net worth". Facts about two filings and the trades between them, never a finding.

export const HOLDINGS_NOT_SHOWN = {
  positions:
    "Value bands are wide; an asset can change band without any trade. A missing purchase report is not proof of a missing filing: several kinds of acquisition need none.",
  change:
    "A change in the disclosed range is not a change in wealth: the bands are wide, and the reports leave out homes, federal retirement accounts and more.",
  liabilities:
    "Shows debts as filed, not their terms, rates or purpose. Debts of $10,000 or less, and most debts owed to relatives, are not reported.",
} as const;

export const POSITIONS_INTRO =
  "Each row is one asset as the annual reports list it, joined with the household trades filed between reports. A trade dated in a year sits before that year’s report, which values assets at the end of the year.";

export const POSITION_CLASSES: Record<string, { label: string; note: string }> = {
  consistent: {
    label: "Matches a filed trade",
    note: "A purchase or exchange is filed and the asset appears or its band rises, or a sale or exchange is filed and it disappears or its band falls.",
  },
  unexplained_appearance: {
    label: "Listed, no purchase report found",
    note: "Common reasons that need no purchase report: the asset was below the reporting threshold before; it was inherited or given; it moved between owners or accounts; it came from an exchange, merger or spin-off; it was bought before trade reports existed or before the member took office; it sits in an excepted fund; or it is real estate or another asset that trade reports do not cover.",
  },
  unexplained_disappearance: {
    label: "No longer listed, no sale report found",
    note: "Common reasons that need no sale report: the asset fell to or below the reporting threshold; it was given away or moved to another owner; it was exchanged, merged, matured or redeemed; it was sold inside an excepted fund; or it is real estate or another asset that trade reports do not cover.",
  },
  band_change_no_trade: {
    label: "Band changed, no trade filed",
    note: "Price movement alone can move an asset across value bands.",
  },
  contrary: {
    label: "Band moved against the filed trades",
    note: "For example the band rose although only sales were filed: price movement can outweigh a trade.",
  },
  traded_same_band: { label: "Traded, same band", note: "A trade can be too small to move an asset out of its band." },
  unchanged: { label: "Same band, no trade", note: "Listed in both reports in the same band, with no trade filed between them." },
  not_comparable: { label: "Bands not comparable", note: "At least one line carries no value, or the summed bands cross, so their direction cannot be compared." },
  traded_while_unlisted: {
    label: "Traded between reports, listed in neither",
    note: "Bought and sold between two reports, or held below the reporting threshold at both year ends.",
  },
};

export const POSITION_STATUS_NOTE =
  "A year with no report available is shown as a gap, never as a sale. Assets are matched across years by their resolved company, or else by the exact asset name as filed; names are never matched by similarity.";

// ---------------------------------------------------------------- data releases (permalinks)
// A permalink /r/<release>/... shows one immutable data release; the latest routes show whatever is current.
export const RELEASE = {
  /** Banner sentence 1; `short` is releaseShort(id), `built` a formatted date or null. */
  banner: (short: string, built: string | null) => `Pinned to data release ${short} (${built ? `built ${built}` : "build date unknown"}).`,
  bannerBody:
    "The figures on this page do not change when newer data is published. Links from this page lead to the latest data, except between this member’s case file and full file.",
  latestLink: "View the latest data",
  /** Provenance line on a pinned page; `release` is the full id. */
  provenance: (release: string) => `Data release ${release}. A release is a fixed copy of the published data; a newer release may differ.`,
  footerLatest: "Latest data as of",
  footerAsOf: "Data as of",
  notFound: {
    title: "This data release is not available",
    body: "Either this release was never published or it has been withdrawn, or it holds no page at this address. It is not replaced by the latest data, so nothing below is a substitute for what you were looking for.",
    latestLink: "Go to the latest data",
  },
} as const;

// ---------------------------------------------------------------- disclosure timing (/delays)
// Observed elapsed days between the transaction date as filed and the date the report became public.
// Never a finding that any report was late or unlawful (docs/validation/disclosure-timing-audit.md).
export const DELAYS = {
  title: "Disclosure timing",
  description:
    "Observed days between each stock trade's date as filed and the date its report became public, in bands, for every member and site-wide. Elapsed days only: not a finding that any report was late or unlawful.",
  lede:
    "How many days passed between the transaction date written on each periodic transaction report and the date the report became publicly available, counted from the filings and the source dataset.",
  /** The prominent neutral caveat. */
  caveatTitle: "Read this first",
  caveat: [
    "These are observed elapsed days between the transaction date as filed and the date the report became public.",
    "The law’s 30-day clock runs from the date the filer was notified of the transaction. That date is not in the data, so only the outer 45-day bound can be compared, and only as elapsed days.",
    "Committee extensions or waivers are not in the data either.",
    "Amended reports may carry the amendment’s date, so an amended trade can look later than its first appearance.",
    "This is not a finding that any report was late, or that any person broke any rule.",
  ],
  /** Used when the data's own definition is missing or incomplete. */
  fallbackMeasured: "days from the transaction date as filed to the date the report became publicly available",
  fallbackCaveats: [
    "Observed elapsed days, not a finding about whether any filing was on time or lawful.",
    "Trades with no transaction date or no availability date are counted as undated, never as 0 days.",
    "A negative value means the recorded availability date precedes the transaction date; it is counted separately.",
  ],
  measuredHeading: "How it is measured",
  methodLink: "Method and sources",
  auditSummary:
    "Dates: the transaction date is as filed (empty on some rows; on some scanned filings the day of the month is approximate). The public date is the source dataset’s availability instant, read as a US Eastern calendar date. For an amended report the site shows the current version only, and it is not known whether that version’s availability date is the original filing’s or the amendment’s.",
  bandsHeading: "Every trade, by days from transaction to public",
  bandsNote: "Bands are not additive with “amended”: an amended trade is also counted in the band it falls in. Percentages are of all trades.",
  bandLabels: {
    "0-30": "0 to 30 days",
    "31-45": "31 to 45 days",
    "46-90": "46 to 90 days",
    "91-365": "91 to 365 days",
    "over-365": "Over 365 days",
  },
  undatedLabel: "No date in the filing",
  undatedNote: "Counted apart, never as 0 days.",
  negativeLabel: "Public before the stated transaction date",
  negativeNote: "Likely an entry or extraction error; in no band and no statistic.",
  amendedLabel: "Of which amended",
  amendedNote: "Overlaps the rows above.",
  overLabel: "Over 45 days",
  chamberHeading: "By chamber of the filing",
  chamberNote: "The chamber the source dataset records for the filing, which is not always the member’s chamber.",
  yearHeading: "By year of the transaction",
  yearNote: "“None” is trades with no transaction date.",
  membersHeading: "By member",
  membersNote:
    "Members with at least one published trade. “Over 45 days” counts trades public more than 45 days after the stated transaction date; its share is of trades with both dates. Median, 90th percentile and longest are over trades with a non-negative day count.",
  csvNote: "Observed elapsed days between the transaction date as filed and the date the report became public; not a finding that any report was late or unlawful.",
  csvFile: "paper-trail-disclosure-timing",
  unavailableTitle: "Not available in this data build yet",
  unavailableBody:
    "This data build does not include disclosure-timing figures. Nothing is shown rather than a zero. They appear after the next data build that includes them.",
  /** Member page. */
  memberLine: "Days from transaction to public",
  memberLink: "How this is measured",
  overTitle: "Public more than 45 days after the stated transaction date. Observed days, not a compliance finding.",
  overChip: "over 45 days",
  overFilter: "Over 45 days only",
  overLabelLong: "Public over 45 days after the transaction",
} as const;

// ---------------------------------------------------------------- contextual coverage (plan packet R1.4)
// Limits of the data, worded once and shown next to the measure they qualify (components/shared/CoverageNote.tsx,
// facts chosen in lib/domain/coverage.ts). Each fact says one thing: how a match was made, whether a figure is
// complete, whether it is current, or whether a tie is filed or derived are never merged. Missing is not zero.
export const COVERAGE = {
  heading: "What the data covers here",
  senateHoldings:
    "No annual-report holdings are in the data for senators: the source has House annual reports only. This is a gap in the data, not a sign that a senator holds nothing.",
  houseNoReport:
    "No House annual report for this member is in the source data. This is a gap in the data, not a sign that nothing is held.",
  senateYears: "The annual-report holdings cover House service only. Years served as a senator are not in the data.",
  holdingsMissing: (years: string) =>
    `Annual reports are missing for ${years}. A missing year is a gap in the data, not a sign that nothing was held.`,
  tradesPartial: (years: string) =>
    `Trade coverage is partial for ${years} (a first part-year, the current year, or a filing that could not be extracted). A trade not listed in those years is not shown to be absent.`,
  tradesNone: (years: string) =>
    `No trade coverage in this build for ${years}. A count of zero there means no data, not no trading.`,
  tradesNa: (years: string) =>
    `No trade reports existed for ${years} (periodic reports begin in July 2012).`,
  moneyPartial: (years: string) =>
    `Money coverage is partial for ${years} (for example Senate paper filings before 2019, or a year still open). Missing money records are not shown to be absent.`,
  moneyNone: (years: string) =>
    `No money coverage in this build for ${years} (no FEC candidate id, or no loaded election cycle). A total of zero there means no data.`,
  moneyNa: (years: string) => `No money records exist or apply for ${years}.`,
  fresh: (built: string) => `Trades and money are listed as of the data build on ${built}. Reports filed later are not included.`,
  freshUnknown: "The date of the data build is not recorded in this release, so how current the records are cannot be stated.",
  owner: (n: number, total: string) =>
    `${n} of ${total} trades state no owner on the filing. They are labelled unspecified and are never assumed to be the member’s own.`,
  openEnded: (n: string) =>
    `${n} trades are filed as open-ended ranges (“over” a figure). The top of the range is not known and none is filled in.`,
  noValue: (n: string) => `${n} trades carry no value on the filing. They are shown as not disclosed, never as $0.`,
  derivedMoney:
    "Some money ties here are statistical derivations (shared donors), not filed records: they meet a published rule against a shuffled baseline.",
  derivedTrades:
    "Some trade ties here are statistical derivations (trading the same securities at the same time), not filed records: they meet a published rule against a shuffled baseline.",
  orgsExact:
    "A company is matched only on an exact identifier (a ticker as filed, checked against the SEC list) or an exact normalised name. Similar names are never matched.",
  orgsReviewed:
    "A match can also come from a hand-reviewed override list. Those are decided by a person, not found by the matching rule.",
  orgsTicker: (noTicker: string | null, unresolved: string | null) =>
    `${[noTicker ? `${noTicker} trades in this build carry no ticker` : null, unresolved ? `${unresolved} carry a ticker that does not resolve to a company` : null].filter(Boolean).join(" and ")}. They are not tied to any company.`,
  pacShare: (share: string) =>
    `Across all members in this build, ${share} of PAC dollars come from committees matched to a named public company. The rest are shown under the committee’s own name, which does not mean they are unrelated to a company.`,
  tie: {
    ledgerOnly: "This tie comes from the summary ledger, which totals filings without listing them one by one. No transaction-level filing is attached.",
    derived: "This tie is a statistical derivation, not a filed record.",
    weak: "The evidence for this tie is thin or incomplete.",
    committee: "One end is a committee that is not matched to a named company; a committee is shown under its own name.",
    partialList: "Only some of the underlying records are listed; the others are in the same source filings.",
    noAmount: "No amount is disclosed for this tie; it is not zero.",
    openEnded: "The amount is an open-ended range; its top is not known.",
  },
} as const;

// ---------------------------------------------------------------- "Cite this" (plan packet R1.4)
export const CITE = {
  button: "Cite this",
  panelTitle: "Cite this",
  intro: "A plain-text citation and a structured packet for what is on screen now. Built in your browser; nothing is sent anywhere.",
  textLabel: "Citation text",
  copy: "Copy citation",
  copied: "Citation copied to the clipboard.",
  copyFailed: "Copying is not available in this browser. The citation text is selected: press Ctrl+C (Cmd+C on a Mac).",
  download: "Download citation (JSON)",
  downloaded: "Citation file downloaded.",
  close: "Close",
  permanentLabel: (short: string) => `Permanent link, fixed to data release ${short}`,
  latestLabel: "Link to the latest data (changes as new data is published)",
  noPermanent:
    "No permanent link: this build is not served from an archived data release, so the link shows whatever data is current when it is opened. Record the data build date above.",
  ledgerOnlyNote:
    "Ledger-only tie: the summary ledger totals the filings without listing them, so no transaction-level filing is attached to this citation.",
  printHeading: "How to cite this page",
  attribution: (releaseText: string, built: string, retrieved: string) => `Paper Trail, ${releaseText}, built ${built}, retrieved ${retrieved}.`,
  releaseText: (short: string) => `data release ${short}`,
  noReleaseText: "data release not recorded",
} as const;

// ---------------------------------------------------------------- saved boards (plan packet R3.2)
// Boards live only in the reader's browser. Fixed wording for the Save control, /saved, exports and shared links.
export const SAVED = {
  nav: "Saved",
  title: "Saved boards",
  description: "Boards of saved records, kept only in your browser.",
  lede: "Collect the members, organisations and ties you are researching, compare them side by side, and export your evidence. Your work stays on this device.",
  privacyTitle: "Where your boards live",
  privacy: [
    "Boards are stored only in this browser. Clearing this site’s data deletes them, so download a board to keep a copy.",
    "Nothing is uploaded. Paper Trail keeps no account and does not log what you save. Your notes never leave this device unless you download or print them yourself.",
  ],
  loading: "Loading your boards…",
  empty: "No boards yet. Use “Save” in the evidence drawer or on a member page to start one, or import a board file below.",
  memoryNotice:
    "This browser is not letting the site store data, so your boards will be lost when you leave or reload this page. Download a board to keep it.",
  saveFailed:
    "Your last change could not be stored in this browser (it may be full or blocked). It is kept for this page only; download your boards to keep them.",
  corruptKept:
    "Your saved boards could not be read, so none are shown. The unreadable data was kept aside in this browser, not deleted.",
  corruptNotKept: "Your saved boards could not be read, and a copy of the unreadable data could not be kept.",
  downloadUnreadable: "Download the unreadable data",
  save: {
    button: "Save",
    saved: "Saved",
    panelTitle: "Save to a board",
    savedIn: "Saved in",
    remove: (board: string) => `Remove from ${board}`,
    saveTo: "Save to",
    newBoard: "New board…",
    newName: "New board name",
    firstBoard: "My first board",
    confirm: "Save",
    close: "Close",
    added: (board: string) => `Saved to ${board}.`,
    removed: (board: string) => `Removed from ${board}.`,
    failed: "Could not save this: the board is full or the name is not valid.",
    boardsFull: "You have the most boards allowed. Delete one on the Saved page first.",
    privateNote: "Stored only in this browser.",
    viewBoards: "Open saved boards",
  },
  kind: { tie: "Tie", member: "Member", org: "Organisation" },
  newBoardHeading: "New board",
  createBoard: "Create board",
  boardsHeading: "Your boards",
  boardCount: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
  rename: "Rename board",
  renameSave: "Save name",
  deleteBoard: "Delete board",
  deleteAsk: "Delete this board and everything on it from this browser? This cannot be undone.",
  deleteConfirm: "Yes, delete the board",
  cancel: "Cancel",
  titleLabel: "Board name",
  boardNoteLabel: "Private note for this board: stays in this browser; not included in share links",
  noteLabel: "Private note: stays in this browser; not included in share links",
  noItems: "This board has no items yet.",
  item: {
    savedOn: (d: string) => `Saved ${d}`,
    release: (short: string) => `Saved from data release ${short}`,
    latestAtTime: "Saved from the latest data at the time (no release recorded)",
    amountLabel: "Amount as saved",
    yearsLabel: "Years",
    noAmount: "no amount (a member or organisation page, not a single tie)",
    openMember: "Open the member page",
    openOrg: "Open the organisation page",
    openPinned: (short: string) => `Open the page as of release ${short}`,
    up: "Move up",
    down: "Move down",
    remove: "Remove",
    moved: (label: string, pos: number, n: number) => `${label} moved to position ${pos} of ${n}.`,
    removedMsg: (label: string) => `${label} removed from the board.`,
    compare: "Compare",
    recheck: "Re-check against the current data",
    checking: "Checking…",
    same: "The current data shows the same as saved.",
    different: (now: string) => `The current data shows “${now}”. What you saved is kept as it was.`,
    missing: "Not found in the current data.",
    error: "Could not load the current data to check.",
  },
  compare: {
    heading: "Compare",
    hint: "Tick two or more items. Each is shown as saved, side by side. Nothing is added up across different kinds of records.",
    pick: (n: number) => `${n} selected`,
    caption: "Selected items, side by side, as saved",
    rows: { kind: "Kind", parties: "Parties", amount: "Amount as saved", years: "Years", sources: "Sources", release: "Data release", name: "Item" },
    notRecorded: "not recorded",
    noAmount: "not a tie",
    latest: "latest at the time",
  },
  exportHeading: "Export and share",
  downloadBoard: "Download board (JSON)",
  includeNotes: "Include my private notes in the file",
  notesOff: "The file will not contain your private notes.",
  notesOn: "The file will contain your private notes. Do not share it if they are not for others.",
  downloadCitations: "Download citations (text)",
  noCitationText: "No citation was captured when this was saved. The label, amount and years above are what was shown.",
  copyLink: "Copy share link",
  linkCopied: "Share link copied.",
  linkFailed: "Copying is not available in this browser. The link is selected below: press Ctrl+C (Cmd+C on a Mac).",
  linkLabel: "Share link",
  linkNote:
    "The link lists this board’s name and the records on it, and nothing else. Your notes are not included. Anyone with the link sees the listed records. The part of the address after # is never sent to the server.",
  linkTooLarge: "This board cannot be a link (it needs 1 to 100 items and must fit in 16 KB). Download the board file instead.",
  downloaded: "File downloaded.",
  printBoard: "Print this board",
  printNotes: "Include my private notes when printing",
  printNoteLabel: "My note:",
  printHeading: (title: string) => `${title}: evidence list`,
  printedFrom: "Printed from Paper Trail. Amounts are the disclosed ranges as displayed when saved; they are not totals.",
  importHeading: "Import a board",
  importLabel: "Paper Trail board file (JSON)",
  importDone: (n: number, renamed: number) => `Imported ${n} ${n === 1 ? "board" : "boards"}${renamed ? ` (${renamed} got a new id because it was already here)` : ""}. Your existing boards were not changed.`,
  importFailed: "That file could not be imported:",
  importNotesIn: "The file included private notes; they are now on your boards.",
  shared: {
    banner: "Shared board — not saved in this browser",
    intro: "This board came from a link. The link carried only the records’ ids; what you see is looked up in the data now. Nothing here is stored unless you save a copy.",
    saveCopy: "Save a copy to this browser",
    copySaved: "A copy was saved to this browser.",
    openMine: "Open my saved boards",
    notFound: "not found in the current data",
    loading: "Looking up the record…",
    fromRelease: (short: string) => `Looked up in data release ${short}`,
    fromCurrent: "Looked up in the current data",
    invalid: (why: string) => `This share link cannot be opened: ${why}.`,
  },
} as const;

// ---------------------------------------------------------------- trade timing wording (neutral: observed days, not a compliance finding)
export const TIMING = {
  countLabel: "Public over 45 days after the trade",
  tradesNote:
    "Reports the public could first see more than 45 days after the stated transaction date are counted; these are observed days, not a compliance finding.",
} as const;

// ---------------------------------------------------------------- comparing data releases (/changes)
// What a difference between two archived releases does and does not show. A missing record is never a sale, and
// a new record does not say when the transaction happened (docs/PRODUCT-PLAN.md, R2.2 and "Accuracy gates").
export const COMPARE = {
  title: "Compare data releases",
  description:
    "What changed in one member's records between two archived data releases: new filing versions, changes in the source data or our extraction, and records added or no longer in the data.",
  link: "Compare data releases",
  none: "not on file",
  heading: { trades: "Trades", ties: "Ties with their evidence", holdings: "Holdings and net worth ranges" },
  /** Fixed explanation shown above every comparison. */
  explainTitle: "How to read this comparison",
  classes: {
    amended_filing: { label: "New filing version", body: "The same record is in both releases and its filing version number is higher in the later one: a newer version of the filing exists." },
    changed_same_version: { label: "Changed without a newer filing version", body: "The same record is in both releases with no higher filing version, but a published field differs. That comes from the source dataset or from our own extraction, not from a filing amendment. The changed fields are listed with before and after." },
    added: { label: "In the later release only", body: "The record is in the later release’s data and not in the earlier one." },
    removed: { label: "In the earlier release only", body: "The record is no longer in the data. That is all it shows." },
    unchanged: { label: "Unchanged", body: "Counted, not listed." },
  },
  explain: [
    "A record missing from the later release does not show that anything was sold, and a new record does not show when the transaction happened.",
    "A filing amendment, a change in the source dataset and a correction in our own extraction are different things; this page separates the first from the other two but cannot tell the last two apart.",
    "The archive starts when release publishing was switched on; it cannot show what the public could see before that.",
    "Amounts are the disclosed ranges, shown before and after. A year or record that is not in one release’s data is not in that release’s data; it is never counted as zero.",
  ],
  origin: {
    public_after: "Became public after the earlier release",
    public_before: "Added to the data later (source or extraction); was already public",
    unknown: "Public date or the earlier release’s build date is unknown",
  },
  holdingsClasses: {
    doc_changed: { label: "Different report document used", body: "The report used for this year is a different document (for example an amendment) in the later release." },
    net_worth_changed: { label: "Net worth range changed, same document", body: "The same document is used but the disclosed net worth range differs: a source or extraction change." },
    year_added: { label: "Year only in the later release", body: "No report for this year is in the earlier release’s data." },
    year_removed: { label: "Year only in the earlier release", body: "No report for this year is in the later release’s data." },
  },
  holdingsNoFile: (short: string) => `No holdings file in release ${short}’s data.`,
  edgeNote:
    "A tie missing from the member file of a release may be listed in that file’s ledger instead, and the evidence list holds at most five records, so an evidence difference alone is not a finding.",
  edgeKinds: { added: "Tie only in the later release", removed: "Tie only in the earlier release", changed: "Tie changed" },
  // states
  notSwitchedOnTitle: "Comparisons need archived data releases",
  notSwitchedOnBody: "Comparisons need archived data releases, which are not switched on for this site yet.",
  noIndexBody: "The list of archived releases is empty or could not be read, so there is nothing to compare yet.",
  badLinkTitle: "This comparison link is not valid",
  badLinkBody: "It needs a member id and two data release ids. Open a member page and use “Compare data releases”.",
  pickMember: "Member",
  fromLabel: "Earlier release",
  toLabel: "Later release",
  sameRelease: "Pick two different releases.",
  unavailable: (short: string) => `Data release ${short} is not available for this member. It is not replaced by any other release, so no comparison is shown.`,
  loadError: "The records failed to load. Check your connection and reload.",
  loading: "Loading both releases…",
  noChanges: "No differences were found in the records compared.",
  csv: "Download CSV",
  csvName: (member: string, from: string, to: string) => `changes-${member}-${from}-${to}`,
  memberAt: (short: string) => `Member page at release ${short}`,
  indexAdvisory: "The release list is a convenience, not a statement of which release is current.",
} as const;

// ---------------------------------------------------------------- documented connections (/connect, plan packet R3.3)
// What a chain of published ties does and does not show. Each step is a separate record; the chain never says the two
// ends dealt with each other (docs/PRODUCT-PLAN.md, "Accuracy gates": path finder).
export const CONNECT = {
  title: "Documented connections",
  description: "Chains of published ties between two members or organisations, step by step, each with its records.",
  link: "Find documented connections…",
  intro: "Pick two members or organisations. This lists the published ties that join them in a few steps, each step with its records.",
  incomplete:
    "Paths are found among published ties; an absent path does not mean no connection exists, and a listed path does not mean the two ends dealt with each other directly.",
  pathNote: (a: string, b: string) => `Each step is a separate filed record. Together they do not show that ${a} and ${b} are tied to each other directly.`,
  pathNoteStat: "A statistical step is not a filed record: it meets a published rule against a shuffled baseline.",
  rankingTitle: "How paths are ordered",
  ranking: [
    "Fewer steps first.",
    "Then paths made only of filed records, before any path with a statistical tie.",
    "Then paths whose steps all have records in a common calendar year, before the others.",
    "Then more filed records.",
    "Then by id, alphabetically.",
  ],
  rankingNone: "There is no score and no strength measure: the order is only this list of rules.",
  rulesTitle: "What is and is not used",
  rules: [
    "Only ties the data lists are used. Nothing is matched by name or similarity.",
    "Spending against a member, and committee and bill context, are not ties and are never used.",
    "Statistical ties are off unless you include them, and two never sit on one path.",
    "A path is never shown as a single line of cause. Each step keeps the direction the record gives.",
  ],
  labels: { a: "From", b: "To", swap: "Swap", hops: "Most steps", derived: "Include statistical ties", hubs: "Expand widely tied organisations", options: "Options" },
  optionHints: {
    derived: "Ties that meet a published statistical rule rather than a filed record. Shown with a STATISTICAL mark.",
    hubs: (n: number) => `Organisations tied to more than ${n} members (index funds, national party committees) are skipped by default, because a path through one says little.`,
  },
  hopsOptions: ["1 step (direct)", "2 steps", "3 steps"],
  pick: { placeholder: "Search members and organisations", none: "Nothing matches.", loading: "Loading the index…", change: "Change", choose: "Choose a member or an organisation" },
  needTwo: "Choose two ends to look for connections.",
  same: "Choose two different ends.",
  badId: "One of the ends in this link is not a valid member or organisation id.",
  loading: "Reading the published ties…",
  loadError: "The records failed to load. Check your connection and try again.",
  notFound: (id: string) => `No member or organisation with the id “${id}” has published ties in this build.`,
  found: (shown: number, total: number) => (shown === total ? `${shown} ${shown === 1 ? "path" : "paths"} found` : `Showing ${shown} of ${total} paths found`),
  more: (n: number) => `${n} more ${n === 1 ? "path was" : "paths were"} found and not shown.`,
  capped: "The search stopped at its safety limit; more paths may exist.",
  none: (n: number) => `No path found among published ties within ${n} ${n === 1 ? "step" : "steps"}.`,
  tryMore: "Allowing more steps may find a longer path.",
  searchedTitle: "What was searched",
  searched: (ends: string, extra: number) =>
    extra > 0 ? `The published ties of ${ends} and of ${extra} intermediate ${extra === 1 ? "node" : "nodes"}.` : `The published ties of ${ends}.`,
  bounded: (read: number, notRead: number) =>
    `A three-step search reads at most ${read} intermediate files, the least widely tied first.${notRead > 0 ? ` ${notRead} other intermediate ${notRead === 1 ? "node was" : "nodes were"} not read, so longer paths through them are not shown.` : ""}`,
  readFailed: (n: number) => `${n} intermediate ${n === 1 ? "file" : "files"} could not be loaded and ${n === 1 ? "was" : "were"} left out.`,
  skippedTitle: "Skipped",
  hubsSkipped: (names: string) => `Not expanded because very widely tied: ${names}.`,
  derivedUnused: (n: number) => `${n} statistical ${n === 1 ? "tie was" : "ties were"} not used (the switch is off).`,
  against: (n: number) => `${n} outside-spending ${n === 1 ? "tie" : "ties"} against a member ${n === 1 ? "was" : "were"} left out: spending against a member is not a tie.`,
  sideUnknown: (n: number) => `${n} outside-spending ${n === 1 ? "tie" : "ties"} ${n === 1 ? "was" : "were"} left out because the data does not say which side the money was spent on here.`,
  context: (n: number) => `${n} committee or bill context ${n === 1 ? "tie was" : "ties were"} left out.`,
  pathHeading: (n: number, steps: number) => `Path ${n}: ${steps} ${steps === 1 ? "step" : "steps"}`,
  stepHeading: (n: number, a: string, b: string) => `Step ${n}: ${a} and ${b}`,
  evidence: "Evidence",
  evidenceFor: (label: string, a: string, b: string) => `Evidence: ${label}, ${a} and ${b}`,
  summaryOnly: "summary only",
  summaryOnlyWhy: "The data lists this tie as a total without its filings.",
  statistical: "STATISTICAL",
  records: (n: number) => `${n} ${n === 1 ? "record" : "records"}`,
  temporal: {
    overlap: (years: string) => `Overlapping years: every step has records in ${years}`,
    overlapSpan: "Where yearly detail is not published, the span from first to last record is used.",
    none: "The records are from different years (no overlap)",
    unknown: "Years not stated for every step; overlap is not assumed",
  },
  /** One phrase per tie type, read as "<from> <phrase> <to>" in the direction the record gives. */
  verbs: {
    traded: "reported trading stock in",
    owns: "reported holding",
    position: "reported a position at",
    pac_money: "PAC gave money to",
    employee_money: "employees gave money to",
    lobbyist_money: "lobbyists gave money to",
    outside_spending: "spent independently to support",
    paid_travel: "paid for travel of",
    revolving_door: "has a revolving-door link with",
    oversees: "oversees",
    funds: "gave money to",
    fundraises_with: "raised funds jointly with",
    shared_donors: "shares donors (statistically) with",
    traded_together: "traded the same stocks close in time (statistically) as",
    legislates_with: "co-sponsored bills with",
    shared_staff: "paid the same staffer as",
    sits_with: "sits with",
  } satisfies Record<EdgeType, string>,
} as const;

// ---------------------------------------------------------------- feeds, embeds and exports (plan packet R4.1)
// RSS feeds of trades made public, the citation-preserving embed card, and the research export bundle.
export const FEED = {
  siteTitle: `${SITE.name}: trades recently made public`,
  memberTitle: (name: string) => `${SITE.name}: ${name}, trades made public`,
  /** `bound` is the number of member files read to build the site feed. */
  siteNote: (bound: number) =>
    `Lists recent trades from members with recent activity in this data build, not every trade site-wide: at most ${bound} members with trades in the latest years are read, and the 100 most recently made-public of their trades are shown.`,
  memberNote: (caseFile: string) => `The 50 most recently made-public trades filed for this member. The full record is in the case file: ${caseFile}`,
  amounts: "Amounts are the disclosed ranges, never a single figure. A missing date or amount is shown as not disclosed, not as zero.",
  noDate: "Trades with no public-availability date are left out of feeds, because a feed item needs a date it became public.",
  source: (sourceName: string, release: string, built: string) => `Source: ${sourceName}; Paper Trail data release ${release} built ${built}`,
  latestBuild: "latest build",
  unknownBuild: "build date not recorded",
  ownerUnstated: "not stated in the filing",
  noAsset: "asset not named",
} as const;

export const EMBED = {
  title: "Embed a member card",
  intro:
    "A small, self-contained card for one member of Congress, for a news story or a classroom page. It carries its own source line and data date; neither can be turned off.",
  attribution: "Attribution is required. The card's footer names Paper Trail, links to the case file and shows the data release and build date. Do not crop or cover it, and do not edit the card's text.",
  usage: "Paste the snippet below where the card should appear. The card needs no scripts and sets no cookies. Add ?theme=dark for a dark card (light is the default).",
  pinned: "To fix the card to one archived data release, use the /embed/r/<release>/m/<member> address; otherwise the card shows the latest data and its date moves with each build.",
  footerShort: SITE.disclaimer,
  source: "Source: Paper Trail",
  counts: { trades: "Trades", orgs: "Organisations", cases: "Cases" },
  sourceLine: (release: string, built: string) => `data release ${release} · built ${built}`,
  latestBuild: "latest build",
  noTies: "No ties are published for this member.",
  topTies: "Top ties by disclosed amount",
  notFound: "This member card is not available.",
  height: 340,
  copy: "Copy embed code",
  copied: "Embed code copied.",
  copyFailed: "Copying is not available here. Select the code and press Ctrl+C (Cmd+C on a Mac).",
  frameTitle: (name: string) => `Paper Trail member card: ${name}`,
  noticeHeading: "Use of the data",
} as const;

export const EXPORT = {
  title: "Research export",
  lede: "Pick a member and the kinds of record you need. You get one JSON file holding exactly the published rows, with the data file, release and checksum of each source, so a researcher can fetch the same bytes again.",
  memberLabel: "Member",
  kindsLabel: "Records to include",
  kinds: { ties: "Ties (full edges, with their evidence)", trades: "Trades (every filed row)", holdings: "Holdings (House annual reports)" },
  build: "Build the export",
  building: "Building the export...",
  download: "Download export (JSON)",
  none: "Pick a member and at least one kind of record.",
  done: "Export downloaded.",
  failed: "The export could not be built: a data file did not load. Try again.",
  hashNote: "Each checksum (SHA-256) identifies the bytes this page downloaded, not whether the filing is accurate or complete.",
  rowsUnmodified: "Rows are copied exactly as published; nothing is recomputed, rounded or filled in.",
  noRelease: "This build is not served from an archived data release, so files have no permanent address. Record the data build date; the files may change when new data is published.",
  missing: "This member has no file of this kind in the published data (not the same as none filed).",
  kindHeading: "What the file holds",
} as const;

// ---------------------------------------------------------------- one view of a member (board, case file, full file)
// The shared view state (years, assumptions, tie families, selected tie, date basis) is carried between the three
// views in the URL (lib/domain/viewstate.ts). This is the wording for the switcher, the filters and the printed line.
export const VIEW = {
  switchLabel: "View:",
  switchAria: "Views of this member",
  board: "Board",
  caseFile: "Case file",
  fullFile: "Full file",
  /** Printed on every view: what the numbers on the page are limited to. */
  showing: "Showing",
  yearsAll: "all years",
  byEvent: "by transaction date",
  byPublic: "by date made public",
  families: (labels: string[]) => (labels.length ? `ties limited to ${labels.join(", ")}` : "no tie families shown"),
  assumeAll: "all household trades counted",
  assumeOwn: "household trades counted as the member’s own",
  assumeOwnShort: "only the member’s own and jointly owned trades",
  assumeSome: "household trades counted with these limits",
  dropSelf: "member’s own trades left out",
  dropFamily: "spouse and dependents left out",
  dropUnstated: "unstated owners left out",
  dropFunds: "funds, bonds and unlabelled assets left out",
  dropSmall: "trades under $15,000 left out",
  lateOnly: "only trades public over 45 days after the trade",
  /** The year filter. */
  filtered: (years: string) => `Filtered to ${years}`,
  showAll: "show all years",
  clearAria: "Show all years: clear the year filter",
  yearsLabel: "Years",
  /** Which date the years are counted by. */
  basisLabel: "Count trades by",
  basisEvent: "Transaction date",
  basisPublic: "Date made public",
  basisEventHint: "The transaction date as filed",
  basisPublicHint: "The date the public could first see the report",
  axisEvent: "Trades by transaction date (as filed)",
  axisPublic: "Trades by date made public",
  axisMoney: "Money records by record year",
  publicNote: "Money ties and holdings are shown by record year: the data holds no publication date for them.",
  undated: (n: number, basis: "event" | "public") =>
    `${n.toLocaleString("en-US")} ${n === 1 ? "trade has" : "trades have"} no ${basis === "public" ? "date made public" : "transaction date"} and ${n === 1 ? "is" : "are"} not counted in any year.`,
  undatedRows: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row has" : "rows have"} no date and ${n === 1 ? "is" : "are"} not counted in any year.`,
  showUndated: (n: number) => `Show the ${n.toLocaleString("en-US")} undated`,
  hideUndated: "Hide the undated rows",
  /** Selected tie. */
  selectedTie: "Selected tie",
  clearTie: "Clear the selected tie",
  selectTie: (id: string) => `Select tie ${id}`,
  notDrawn: "The selected tie is not drawn on the board; it is listed in the case file.",
  notDrawnLink: "Open it in the case file",
  /** Full file tables. */
  recordYearsNote: "Ties are placed by the years of their records, first to last; holdings and coverage by report year.",
  rowsInWindow: (shown: number, total: number) => `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} rows in these years`,
  assumeAppliedNote: "Trades follow the assumptions above; ties, holdings and documents do not.",
  leftOut: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "trade is" : "trades are"} left out by the assumptions.`,
} as const;


// ---------------------------------------------------------------- data freshness (footer, stale banner, newer-data note)
// How old the published data is, said plainly. Staleness is a statement about the daily update, never about any filing.
export const FRESH = {
  /** Footer: "updated 6 hours ago", after the date. */
  updated: "updated",
  justNow: "updated just now",
  /** Banner text; `when` is a formatted date and `days` like "3 days". */
  stale: (when: string, days: string) => `This data was last updated ${when} (${days} ago). The daily update may have failed; figures may be out of date.`,
  staleLink: "Data status",
  newer: "Newer data has been published. Reload to see it.",
  newerDismiss: "Dismiss",
} as const;

// ---------------------------------------------------------------- a permalink compared with later releases
// The snapshot's own figures are never altered; later differences are described, not judged (see COMPARE).
export const SNAPSHOT = {
  /** `list` is a comma-joined list of what differs. */
  since: (list: string) => `Since this snapshot: ${list}.`,
  seeChanges: "see what changed",
  unchanged: "No records for this member have changed in later data releases.",
  error: "Could not check whether this member’s records changed in later data releases. The figures on this page are unaffected.",
  /** Header counts that differ from the latest data. */
  count: (snapshot: string, latest: string) => `${snapshot} in this snapshot · ${latest} in today’s data`,
  parts: {
    amended: "with a newer filing version",
    changedSource: "changed in the source data or our extraction",
    added: "added to the data",
    removed: "no longer in the data",
    tiesChanged: "changed",
    holdings: "holdings or net worth years changed",
  },
} as const;

// ---------------------------------------------------------------- /status
export const STATUS = {
  title: "Data status",
  description: "When the published data was last updated, which sources it was built from, and how the last daily update ran.",
  lede: "How fresh the data on this site is, and what happened the last time it was refreshed.",
  /** The workflow file whose latest run on main is the daily update. The repository is CORRECTIONS.repo. */
  workflow: "data.yml",
  updatedHeading: "Last data update",
  updatedAt: "Built",
  pipelineCommit: "Pipeline commit",
  contract: "Data contract",
  release: "Data release",
  releaseNote: "The release this site currently serves as the latest.",
  sourcesHeading: "Sources in this build",
  sourcesNote: "As of, revision and row counts are what each source reported when it was read. A source with nothing listed gave nothing; it is not zero.",
  noSources: "This build lists no sources.",
  retrieved: "Retrieved",
  revision: "Revision",
  rows: "Rows",
  coverageHeading: "Coverage notes",
  runHeading: "Last daily update run",
  runStatus: "Status",
  runConclusion: "Result",
  runWhen: "Started",
  runLink: "Open the run on GitHub",
  /** GitHub's run conclusions in plain words; anything else is shown as GitHub wrote it. */
  conclusions: { success: "succeeded", failure: "failed", cancelled: "cancelled", skipped: "skipped", timed_out: "timed out" } as Record<string, string>,
  runUnavailable: "Run history unavailable right now",
  runSample: "Run history is not shown on the sample site.",
  explainHeading: "What this means",
  explain: [
    "Once a day an automated job reads the public sources again, rebuilds every figure and publishes the result. That is the “daily update”.",
    "If an update fails, the site keeps showing the previous data. Nothing is blanked or filled in, so the date above is the date the figures describe.",
    "A banner appears on every page when the data is more than 48 hours old.",
  ],
  methodLink: "Sources and method",
  correctionsLink: "Corrections log",
} as const;

// ---------------------------------------------------------------- plain-language explainers (components/shared/Explain.tsx)
// One short definition per term, reusing the settled wording above. A tie is never a finding of wrongdoing.
export const EXPLAIN = {
  household: {
    label: "household",
    body: "Trades are the household’s unless the filing says the member owns the asset. A jointly owned asset counts as the member’s own.",
  },
  range: {
    label: "disclosed range",
    body: "Amounts are filed as ranges, such as $1,001–$15,000. The site shows the range as filed and never invents a single figure. An open-ended range (“over” a figure) stays open.",
  },
  tie: {
    label: "tie",
    body: "A tie is drawn only when a filed public record names both ends, or when a published statistical rule is met. A tie is not a finding. This shows what the filings say, not why.",
  },
  statistical: {
    label: "statistical tie",
    body: "A statistical tie is not a filed record: it meets a published statistical rule against a shuffled baseline. It is marked STATISTICAL wherever it appears.",
  },
  /** The button's accessible hint, read after the term. */
  hint: "explanation",
  close: "Close explanation",
} as const;
