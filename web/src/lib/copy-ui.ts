// Fixed wording for the shared interface chrome added in the declutter pass: the header menus, the member page's
// action menu, the in-page section index and the "Show all" controls. Import from here; copy.ts holds the rest.

export const NAV_UI = {
  mainAria: "Main",
  moreLabel: "More",
  moreAria: "More pages",
  menuLabel: "Menu",
  menuOpenAria: "Open the menu",
  menuCloseAria: "Close the menu",
  searchOpenAria: "Open search",
  searchCloseAria: "Close search",
  /** Links in the primary row. */
  primary: [
    { href: "/", label: "Board" },
    { href: "/new", label: "New" },
    { href: "/cases", label: "Cases" },
    { href: "/orgs", label: "Organisations" },
  ],
  /** Links behind "More", in the order shown. `watch` and `status` take their href from lib/urls.ts. */
  more: [
    { key: "wall", label: "Wall" },
    { key: "delays", label: "Timing" },
    { key: "flags", label: "Review flags" },
    { key: "saved", label: "Saved" },
    { key: "watch", label: "Following" },
    { key: "method", label: "Method" },
    { key: "status", label: "Data status" },
  ],
} as const;

export const ACTIONS_UI = {
  more: "More",
  moreAria: (name: string) => `More actions for ${name}`,
  followIcon: "Follow",
} as const;

/** The in-page index on a member page: the label of each anchor, in page order. */
export const SECTION_INDEX = {
  aria: "On this page",
  label: "On this page",
  backToSections: "Back to sections",
  cases: "Cases",
  ties: "Ties",
  activity: "Activity",
  money: "Campaign money",
  holdings: "Holdings",
  trades: "Trades",
} as const;

export const FOLD_UI = {
  showAll: (n: number, what: string) => `Show all ${n.toLocaleString("en-US")} ${what}`,
  showFewer: (n: number, what: string) => `Show the first ${n.toLocaleString("en-US")} ${what}`,
} as const;

export const ASSUME_UI = {
  summaryKey: "Assumptions",
  /** The chip's value for the default switches. */
  summaryDefault: "household, every trade",
  summaryOwnOnly: "own trades only",
  summaryChanged: (n: number) => (n === 1 ? "1 changed" : `${n} changed`),
  summaryOwnPlus: (n: number) => `own trades only, ${n} more changed`,
} as const;

export const CASES_UI = {
  /** Said once above the cases list; the sentence itself is CASE_NOT_SHOWN in copy.ts. */
  notShownLabel: "What a case does not show:",
} as const;

export const BOARD_UI = {
  whyFeatured: "Why this example?",
  closeEvidence: "Close evidence",
  closeEvidenceHint: "Close evidence (Escape)",
} as const;
