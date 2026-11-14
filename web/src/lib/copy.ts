// The site's fixed wording, in one place: name and tagline, the disclaimer and legal notices,
// "what this does not show" for each tie type, and how a Case is described.
// Pure (types only); change the voice here, not in components.
import type { Case, EdgeType } from "./types.ts";

export const SITE = {
  name: "Paper Trail",
  tagline: "Talk is cheap. Follow the money.",
  description:
    "A map of every member of Congress and the organisations and colleagues they are tied to by filed public records: stock trades, PAC money, outside spending, member-to-member money and committee seats. Every string shows its records.",
  // Placeholder: replace with a monitored address before launch.
  correctionsEmail: "corrections@example.org",
  /** The live site, for plain URLs printed on paper and as the metadata base outside Vercel. */
  url: "https://red-paper-trail.vercel.app",
  disclaimer: "A tie is not a finding. This shows what the filings say, not why.",
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
