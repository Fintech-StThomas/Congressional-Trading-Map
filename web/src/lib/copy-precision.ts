// Wording that names who did what exactly: the owner of a trade, a committee that gave money, what a combined trade
// total adds up, and where a tie's unlisted records are. Import from here, not copy.ts (which may only shrink).
import type { EdgeType } from "./types.ts";

/** Owner values of a trade as the filing gives them. */
export type OwnerKey = "self" | "spouse" | "joint" | "dependent" | "unspecified";

export const OWNER_WORD: Record<OwnerKey, string> = {
  self: "self", spouse: "spouse", joint: "joint", dependent: "dependent child", unspecified: "owner not stated",
};

export const PRECISE = {
  /** An RSS item title names the owner as filed: "<member> (D-CA), owner spouse: buy ...". */
  feedOwner: (owner: string | null | undefined) =>
    owner === "unspecified" || !owner ? "owner not stated" : `owner ${OWNER_WORD[owner as OwnerKey] ?? owner}`,
  /** What a trade total adds up. */
  combined: "bought and sold combined",
  combinedExplain: "Adds the disclosed low and the disclosed high of every buy and every sell; it is not a position or a net amount.",
  household: "household",
  /** The drawer's mark line for spending against a member: a record, not a tie. */
  againstMark: "Filed record of spending against the member. Not a tie",
  bought: "Bought",
  sold: "Sold",
  otherActions: "Exchanges and other",
  noAmounts: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "trade has" : "trades have"} no amount disclosed and ${n === 1 ? "is" : "are"} not in these sums`,
  /** The evidence drawer's sentence about records that are counted but not listed. */
  drawerMore: (type: EdgeType, n: number, committee?: string | null): string => {
    const k = n.toLocaleString("en-US");
    if (type === "traded") return `The other ${k} records are trades in other periodic transaction reports; the member's full file lists every trade. The largest and most recent are listed here.`;
    if (type === "pac_money" || type === "outside_spending" || type === "funds" || type === "fundraises_with")
      return `The other ${k} records are in the committee's other FEC filings${committee ? ` (FEC committee ${committee}; its FEC page lists its filings)` : ""}, not listed here. The largest and most recent are listed.`;
    return `The other ${k} records are in other filings of the same source, not listed here. The largest and most recent are listed.`;
  },
} as const;

/** /connect: who a step's record names. A committee is not the member; a trade belongs to the household unless the filing says otherwise. */
export const CONNECT_WORDS = {
  /** Text that follows the member's name when the record is not the member's own. */
  household: "’s household",
  spouse: "’s spouse",
  dependent: "’s dependent child",
  committeeOf: "a committee of",
  owners: (note: string) => `owners as filed: ${note}`,
} as const;
