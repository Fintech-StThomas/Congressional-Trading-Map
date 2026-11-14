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
