// Missing values on the holdings section, never drawn or written as zero: the residence-secured debt cell and the
// net-worth bar geometry (an unbounded-below range gets a marker, not a bar from $0). Pure.
import type { NetWorth } from "./holdings.ts";
import { bandText } from "./positions.ts";
import { HOLDINGS_MISSING } from "../copy-member-totals.ts";

/** "Residence-secured" cell: no liability identified as residence-secured (n = 0) is "not identified", not $0–$0. */
export function residenceCell(n: number | undefined, low: number | null, high: number | null): string {
  if (n === 0 || (n == null && !low && !high)) return HOLDINGS_MISSING.residenceNone;
  return bandText(low, high);
}

export type NwBar =
  | { kind: "range"; bottom: number; top: number }
  | { kind: "unbounded_below"; top: number | null };

/** Bar bounds for one report year. A null low is unbounded below (never 0); a null top with a low is drawn open at the top by the caller. */
export function nwBar(nw: NetWorth): NwBar {
  const top = nw.high ?? nw.high_valued ?? nw.low;
  if (nw.low === null) return { kind: "unbounded_below", top: nw.high ?? nw.high_valued };
  return { kind: "range", bottom: nw.low, top: top ?? nw.low };
}
