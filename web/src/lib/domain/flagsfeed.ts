// Feed items for /feed/flags.xml: flagged trades made public in the 30 days up to the data build date, worded neutrally
// (which published rules were met, the owner, dates and range as filed, the statement). Pure; tests/flags.test.mjs loads it.
import type { MemberSummary } from "../types.ts";
import { FLAGS } from "../copy-flags.ts";
import { amountText, date, NOT_DISCLOSED } from "../format.ts";
import { memberTradeHref, siteUrl } from "../urls.ts";
import { oneLine } from "./escape.ts";
import { PRECISE } from "../copy-precision.ts";
import { madePublicWithin, ruleLabel, type FlagRow } from "./flags.ts";
import { attribution, type FeedContext, type FeedItem } from "./feed.ts";
import type { FlagRule } from "../types.ts";

export const FLAG_FEED_ITEMS = 200;

const ACTION: Record<string, string> = { buy: "buy", sell: "sell", exchange: "exchange", other: "other transaction" };

type Names = { member: (id: string) => Pick<MemberSummary, "name" | "party" | "state"> | undefined; org: (id: string) => string | undefined };

/** Recent rows, newest public date first (then trade id), at most `limit`. */
export function recentFlagRows(rows: FlagRow[], buildDate: string, limit = FLAG_FEED_ITEMS): FlagRow[] {
  return rows
    .filter((r) => madePublicWithin(r.available, buildDate))
    .sort((a, b) => (b.available ?? "").localeCompare(a.available ?? "") || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function flagItem(r: FlagRow, names: Names, rules: FlagRule[] | null, statement: string, c: FeedContext): FeedItem {
  const m = names.member(r.member);
  const who = m ? `${oneLine(m.name)} (${m.party}-${oneLine(m.state)})` : r.member;
  const what = (r.org && names.org(r.org)) || r.ticker || "an asset with no ticker";
  const range = amountText({ low: r.low, high: r.high, exact: null }) ?? NOT_DISCLOSED;
  const labels = r.rules.map((id) => ruleLabel(id, rules)).join("; ");
  // Same owner wording as the trades feed ("owner spouse", "owner not stated"); left out when the file has no owner column.
  const owner = r.owner === undefined ? "" : `, ${PRECISE.feedOwner(r.owner)}`;
  return {
    title: `${who}${owner}: ${ACTION[r.action] ?? "other transaction"} ${oneLine(what)}${r.ticker && r.ticker !== what ? ` (${oneLine(r.ticker)})` : ""}, ${range}`,
    link: siteUrl(memberTradeHref(r.member, r.id)),
    guid: `flags:${r.member}:${r.id}`,
    pubDate: r.available as string,
    description: [
      FLAGS.feedRules(labels),
      `Transaction date as filed: ${date(r.date)}.`,
      `Made public: ${date(r.available)}.`,
      statement,
      `${attribution(c)}.`,
    ].join(" "),
  };
}
