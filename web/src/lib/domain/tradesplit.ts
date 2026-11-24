// Buys and sells apart for one company: a tie's trade total adds every buy and every sell, so it reads as neither a
// position nor a net figure. This adds the disclosed low and high ends of each side separately, from the member's trade
// rows. A trade with no amount is counted apart, never as 0; one open-ended range makes that side's top unknown. Pure.
import { amountText } from "../format.ts";
import { PRECISE } from "../copy-precision.ts";

export type SideSum = { n: number; low: number | null; high: number | null };
export type TradeSplit = { bought: SideSum; sold: SideSum; other: SideSum; undisclosed: number };

type Row = { action: string; org: string | null; low: number | null; high: number | null };

/** Sums for the trades in company `org`. `high` is null when any trade on that side is open-ended ("over $X"). */
export function tradeSplit(rows: readonly Row[], org: string): TradeSplit {
  const side = (): SideSum & { open: boolean } => ({ n: 0, low: null, high: 0, open: false });
  const buy = side(), sell = side(), oth = side();
  let undisclosed = 0;
  for (const r of rows) {
    if (r.org !== org) continue;
    if (r.low === null) { undisclosed++; continue; }
    const s = r.action === "buy" ? buy : r.action === "sell" ? sell : oth;
    s.n++;
    s.low = (s.low ?? 0) + r.low;
    if (r.high === null) s.open = true;
    else s.high = (s.high ?? 0) + r.high;
  }
  const fin = (s: ReturnType<typeof side>): SideSum => ({ n: s.n, low: s.low, high: s.n === 0 || s.open ? null : s.high });
  return { bought: fin(buy), sold: fin(sell), other: fin(oth), undisclosed };
}

function sideText(s: SideSum): string {
  return s.n === 0 ? "none" : amountText({ low: s.low, high: s.high, exact: null }) ?? "no amount disclosed";
}

/**
 * "Bought $1,001–$15,000 (2 trades) · Sold $15,001–$50,000 (1 trade) · Exchanges and other $1,001–$15,000 (1 trade) · 1 trade has no
 * amount disclosed and is not in these sums". Buys + sells + other add up to the combined total. Null when there is neither a buy nor a
 * sell (an exchange-only tie): the combined figure then stands alone, with no "none" beside it.
 */
export function splitText(sp: TradeSplit): string | null {
  if (sp.bought.n === 0 && sp.sold.n === 0) return null;
  const t = (s: SideSum) => `${sideText(s)} (${s.n} ${s.n === 1 ? "trade" : "trades"})`;
  const parts = [`${PRECISE.bought} ${t(sp.bought)}`, `${PRECISE.sold} ${t(sp.sold)}`];
  if (sp.other.n > 0) parts.push(`${PRECISE.otherActions} ${t(sp.other)}`);
  if (sp.undisclosed > 0) parts.push(PRECISE.noAmounts(sp.undisclosed));
  return parts.join(" · ");
}
