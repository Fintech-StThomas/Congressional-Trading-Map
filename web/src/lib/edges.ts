import type { Edge, EdgeType, NodeRef } from "./types";
import { amountText, type Amount } from "./format";
import { YEAR_MAX, YEAR_MIN } from "./site";

export type Family = Edge["family"];
export const FAMILIES: Family[] = ["money", "holding", "people", "context"];

export const FAMILY_LABEL: Record<Family, string> = {
  money: "Money",
  holding: "Holdings",
  people: "People",
  context: "Context",
};

export const FAMILY_HINT: Record<Family, string> = {
  money: "Contributions, outside spending, paid travel and member-to-member money",
  holding: "Stock trades, holdings and outside positions",
  people: "Staff, lobbyists and committee seats",
  context: "Shared committees and co-sponsored bills. Common, so off by default",
};

/** Plain-words name for each kind of string. */
export const TYPE_LABEL: Record<EdgeType, string> = {
  traded: "Stock trades",
  owns: "Holding",
  position: "Outside position",
  pac_money: "PAC contributions",
  employee_money: "Employee donations",
  lobbyist_money: "Lobbyist donations",
  outside_spending: "Outside spending",
  paid_travel: "Paid travel",
  revolving_door: "Revolving door",
  oversees: "Committee oversight",
  funds: "Gave money",
  fundraises_with: "Joint fundraising",
  shared_donors: "Shared donors",
  traded_together: "Traded together",
  legislates_with: "Co-sponsored bills",
  shared_staff: "Shared staff",
  sits_with: "Same committee",
};

/** One sentence: what a filed record of this type says. Used on /method and in the drawer. */
export const TYPE_RULE: Record<EdgeType, string> = {
  traded: "A periodic transaction report filed by the member lists a trade in this company's securities, by the member, a spouse, a dependent or jointly.",
  owns: "An annual financial disclosure lists a holding in this company.",
  position: "An annual financial disclosure lists a position (officer, director, partner, trustee) the member held at this organisation.",
  pac_money: "FEC filings show this organisation's political action committee, or a PAC connected to it, contributing to the member's campaign or leadership PAC.",
  employee_money: "FEC itemised receipts show people who list this organisation as employer giving to the member.",
  lobbyist_money: "LD-203 reports show lobbyists registered for this organisation reporting contributions to the member.",
  outside_spending: "FEC independent expenditure reports show this group spending money for or against the member.",
  paid_travel: "A privately funded travel disclosure shows this organisation paying for the member's trip.",
  revolving_door: "A lobbying registration names a former staffer of the member as a lobbyist for this organisation, or the member's own past employment.",
  oversees: "The member sits on a congressional committee with jurisdiction over this organisation or its sector.",
  funds: "FEC filings show the member's campaign or leadership PAC giving money to the other member.",
  fundraises_with: "A joint fundraising committee filed with the FEC names both members as participants.",
  shared_donors: "Derived: the two members share more individual donors than a published baseline predicts.",
  traded_together: "Derived: the two members traded the same securities close together in time more often than a published baseline predicts.",
  legislates_with: "Bill records show both members as sponsor or co-sponsor of the same bills. Context only.",
  shared_staff: "Disbursement records show the same staffer paid by both offices.",
  sits_with: "Committee rosters show both members on the same committee. Context only.",
};

/** Type label for one edge: outside spending says which way the money went. */
export function typeLabel(e: Pick<Edge, "type" | "note" | "via">): string {
  if (e.type === "outside_spending") {
    const side = e.note === "oppose" || e.via?.id.endsWith(":oppose") ? "oppose" : e.note === "support" || e.via?.id.endsWith(":support") ? "support" : null;
    if (side === "oppose") return "Outside spending opposing";
    if (side === "support") return "Outside spending supporting";
  }
  return TYPE_LABEL[e.type];
}

export function size(e: Edge, range?: [number, number]): number {
  const a = filteredAmount(e, range);
  const dollars = a.exact ?? a.high ?? a.low;
  return dollars ?? 0;
}

/** Totals limited to a year window, summing lows and highs separately (never a midpoint). */
export function filteredAmount(e: Edge, range?: [number, number]): Amount & { n: number } {
  if (!range || (range[0] <= YEAR_MIN && range[1] >= YEAR_MAX)) return { ...e.amount, n: e.count };
  let low: number | null = null, high: number | null = null, exact: number | null = null, n = 0;
  for (const b of e.by_year) {
    if (b.y < range[0] || b.y > range[1]) continue;
    n += b.n;
    if (b.low != null) low = (low ?? 0) + b.low;
    if (b.high != null) high = (high ?? 0) + b.high;
    if (b.exact != null) exact = (exact ?? 0) + b.exact;
  }
  return { low, high, exact, n };
}

export function inYears(e: Edge, range: [number, number]): boolean {
  if (range[0] <= YEAR_MIN && range[1] >= YEAR_MAX) return true;
  if (!e.by_year.length) {
    const a = Number(e.first?.slice(0, 4));
    const b = Number(e.last?.slice(0, 4));
    return !(b < range[0] || a > range[1]);
  }
  return e.by_year.some((b) => b.n > 0 && b.y >= range[0] && b.y <= range[1]);
}

/** The end of the edge that is not `self`. */
export function otherEnd(e: Edge, selfId: string): NodeRef {
  if (e.from.id === selfId) return e.to;
  if (e.to.id === selfId) return e.from;
  return e.to;
}

/** Stroke width on a clamped log scale: money by dollars, everything else by record count. */
export function strokeWidth(e: Edge, range?: [number, number]): number {
  if (e.family === "context") return 1.1;
  const a = filteredAmount(e, range);
  const dollars = a.exact ?? a.high ?? a.low;
  let t: number;
  if (dollars != null && dollars > 0) {
    t = (Math.log10(Math.max(1000, dollars)) - 3) / 4; // $1K .. $10M
  } else {
    t = Math.log10(Math.max(1, a.n)) / 2; // 1 .. 100 records
  }
  t = Math.min(1, Math.max(0, t));
  return Math.round((1.6 + t * 3.6) * 10) / 10;
}

export type StringStyle = "filed" | "derived" | "weak" | "context";

export function stringStyle(e: Edge): StringStyle {
  if (e.family === "context") return "context";
  if (e.basis === "derived") return "derived";
  if (e.weak) return "weak";
  return "filed";
}

export function amountLabel(e: Edge, range?: [number, number], compact = false): string | null {
  return amountText(filteredAmount(e, range), compact);
}

/** "Example PAC → Ada Sampleworth" style direction words. */
export function directionWords(e: Edge, name: (n: NodeRef) => string): string {
  const a = name(e.from);
  const b = name(e.to);
  return e.directed ? `${a} → ${b}` : `${a} ↔ ${b}`;
}

const FAMILY_ORDER: Record<Family, number> = { money: 0, holding: 1, people: 2, context: 3 };

export function sortEdges(edges: Edge[]): Edge[] {
  return [...edges].sort(
    (a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || size(b) - size(a) || b.count - a.count || a.id.localeCompare(b.id),
  );
}

export function plainStat(stat: NonNullable<Edge["stat"]>): string {
  const exp = stat.expected < 1 ? "less than 1" : `about ${Math.round(stat.expected).toLocaleString("en-US")}`;
  return `Seen ${stat.observed.toLocaleString("en-US")} ${stat.observed === 1 ? "time" : "times"}; ${exp} expected by chance.`;
}

/** Weak or derived strings are drawn frayed. Never the only signal: see `frayCue`. */
export function isFrayed(e: Pick<Edge, "basis" | "weak" | "family">): boolean {
  return e.family !== "context" && (e.basis === "derived" || e.weak);
}

/** The words that go with a frayed string, so appearance is never the only cue. */
export function frayCue(e: Pick<Edge, "basis" | "weak">): string | null {
  if (e.basis === "derived") return e.weak ? "statistical, not filed; thin evidence" : "statistical, not filed";
  if (e.weak) return "thin evidence";
  return null;
}

function surname(name: string): string {
  const parts = name.replace(/,.*$/, "").trim().split(/\s+/).filter((p) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(p));
  return parts[parts.length - 1] ?? name;
}

/**
 * What a string says, with the card at its far end as the subject:
 * "gave $2K to Rooney", "spent $238 opposing Rooney", "received $5K from its PAC".
 * `centre` is the name of the board's centre (member or organisation).
 */
export function tiePhrase(e: Edge, cardId: string, centre: string, range?: [number, number]): string {
  const amt = amountText(filteredAmount(e, range), true);
  const $ = amt ? ` ${amt}` : "";
  const cardIsFrom = e.from.id === cardId;
  const cardIsOrg = (cardIsFrom ? e.from : e.to).kind === "org";
  const c = cardIsOrg ? surname(centre) : "this member";
  switch (e.type) {
    case "funds":
      return cardIsFrom ? `gave${$} to ${surname(centre)}` : `received${$} from ${surname(centre)}`;
    case "outside_spending": {
      const side = spendingSideOf(e);
      const verb = side === "oppose" ? "opposing" : side === "support" ? "supporting" : "on the race of";
      return cardIsOrg ? `spent${$} ${verb} ${c}` : `${amt ?? "money"} spent ${side === "oppose" ? "against" : "for"} them`;
    }
    case "pac_money":
      return cardIsOrg ? `PAC gave${$} to ${c}` : `received${$} from its PAC`;
    case "employee_money":
      return cardIsOrg ? `employees gave${$} to ${c}` : `received${$} from its employees`;
    case "lobbyist_money":
      return cardIsOrg ? `lobbyists gave${$} to ${c}` : `received${$} from its lobbyists`;
    case "paid_travel":
      return cardIsOrg ? `paid${$} for ${c}'s travel` : `travel paid${$}`;
    case "traded":
      return cardIsOrg ? `stock traded by ${c}'s household${amt ? `, ${amt}` : ""}` : `household traded this stock${amt ? `, ${amt}` : ""}`;
    case "owns":
      return cardIsOrg ? `held by ${c}${amt ? `, ${amt}` : ""}` : `holds this stock${amt ? `, ${amt}` : ""}`;
    case "traded_together":
      return `traded the same stocks close in time (statistical)`;
    case "shared_donors":
      return `shares donors (statistical)`;
    case "fundraises_with":
      return `joint fundraising committee`;
    default:
      return typeLabel(e).toLowerCase();
  }
}

function spendingSideOf(e: Pick<Edge, "note" | "via">): "support" | "oppose" | null {
  if (e.note === "oppose" || e.via?.id.endsWith(":oppose")) return "oppose";
  if (e.note === "support" || e.via?.id.endsWith(":support")) return "support";
  return null;
}
