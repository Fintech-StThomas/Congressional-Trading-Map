// "What this does not show": one fixed line per tie type, and one for a Case.
// The only place this wording lives. Browser-safe, no runtime imports.
import type { EdgeType } from "./types";

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
