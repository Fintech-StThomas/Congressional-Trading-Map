"use client";
// One met review-flag rule's detail, in words, with its source where one exists: days for `late`, the range for
// `large_amount`, the other members (linked) with observed and expected for `pile_on`, the PAC money tie's records for
// `money_both_ways` and the committee for `sector_overseen`. A rule id this build does not know (an older release's
// rule) reads as its id. Also the plain-text form used for the badge tooltip (`flagTitle`).
import Link from "next/link";
import type { FlagDetail } from "@/lib/types";
import type { TradeRow } from "@/lib/data/decode";
import { AROUND, RULE_IDS, RULE_LABEL, type RuleId } from "@/lib/copy-flags";
import { amountText, count, days, NOT_DISCLOSED } from "@/lib/format";
import { memberHref } from "@/lib/urls";
import { updateView } from "@/components/shared/useViewState";
import type { TradeFlagInfo } from "./memberTrades";

type D = Record<string, unknown>;
const range = (t: TradeRow) => amountText({ low: t.low, high: t.high, exact: null }) ?? NOT_DISCLOSED;

/** The detail as one plain sentence (badge tooltips, feeds). */
export function flagSentence(rule: RuleId, detail: FlagDetail, t: TradeRow, info: Pick<TradeFlagInfo, "names" | "committees">): string {
  const d = detail as D;
  switch (rule) {
    case "late": return AROUND.late(days(d.lag_days as number));
    case "large_amount": return AROUND.large(range(t));
    case "pile_on": return AROUND.pileOn(count(d.observed as number), String(d.expected));
    case "money_both_ways": return AROUND.money;
    case "sector_overseen": return AROUND.committee(info.committees[d.committee as string] ?? String(d.committee));
    default: return String(rule);
  }
}

/** Tooltip text for a row's badge: each met rule's label and detail. */
export function flagTitle(flags: Record<string, FlagDetail>, t: TradeRow, info: Pick<TradeFlagInfo, "names" | "committees">): string {
  return RULE_IDS.filter((r) => flags[r]).map((r) => `${RULE_LABEL[r]}: ${flagSentence(r, flags[r], t, info)}`).join("\n");
}

export function FlagDetailLine({ rule, d, t, info }: { rule: RuleId; d: FlagDetail; t: TradeRow; info: TradeFlagInfo }) {
  const x = d as D;
  const text = flagSentence(rule, d, t, info);
  if (rule === "pile_on") {
    const ids = (x.members as string[]) ?? [];
    return (
      <>
        {text}{" "}
        {ids.map((m, i) => <span key={m}>{i > 0 && ", "}<Link href={memberHref(m)}>{info.names[m] ?? m}</Link></span>)}
      </>
    );
  }
  if (rule === "money_both_ways") {
    const edge = String(x.edge ?? "");
    const published = Object.values(info.pac).some((list) => list.some((e) => e.id === edge));
    return (
      <>
        {text}{" "}
        {published ? (
          <button type="button" className="linkbtn" onClick={() => updateView({ edge, org: t.org }, { push: true })} data-testid="around-money-open">{AROUND.moneyOpen}</button>
        ) : <span className="sub">{AROUND.moneyLedger}</span>}
      </>
    );
  }
  return <>{text}</>;
}
