"use client";
// Review flags in the member trades table: the one-line summary above it (from trade_summary.flags), the last cell of
// each row (a neutral badge when the trade met any rule, and the control that opens "Around this trade"), and the
// `?t=<trade id>` link target that /flags uses (the table scrolls to that row and opens its panel). Older builds have
// no flags: no summary and no badges, never a zero.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FlagDetail } from "@/lib/types";
import type { TradeRow } from "@/lib/data/decode";
import { FLAGS, RULE_IDS, RULE_LABEL } from "@/lib/copy-flags";
import { metRules } from "@/lib/domain/flags";
import { count, date } from "@/lib/format";
import { flagsHref } from "@/lib/urls";
import { flagTitle } from "./FlagDetailLine";
import type { TradeFlagInfo } from "./memberTrades";

export function FlagSummary({ info }: { info: TradeFlagInfo }) {
  if (!info.summary) return null;
  const s = info.summary;
  const met = RULE_IDS.filter((r) => (s[r] ?? 0) > 0);
  return (
    <p className="trades__flagline" data-testid="trades-flag-summary">
      {met.length === 0 ? FLAGS.summaryNone : <>{FLAGS.summaryLead} {met.map((r, i) => <span key={r}>{i > 0 && " · "}{RULE_LABEL[r]} <span className="mono">{count(s[r])}</span></span>)}.</>}{" "}
      <span className="stmt">{info.statement}</span> <Link href={flagsHref()}>{FLAGS.pageLink}</Link>
    </p>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M2.5 11V1.5M2.5 1.8h6.2l-1.4 2.1 1.4 2.1H2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function AroundCell({ t, flags, info, open, onToggle }: { t: TradeRow; flags: Record<string, FlagDetail> | undefined; info: TradeFlagInfo; open: boolean; onToggle: () => void }) {
  const n = metRules(flags).length;
  return (
    <td className="trades__around">
      <button
        type="button" className="aroundbtn" aria-expanded={open} aria-controls="trade-around"
        aria-label={n ? FLAGS.badgeAria(n) : `${FLAGS.aroundOpen}: ${t.asset}, ${date(t.date)}`}
        title={n ? flagTitle(flags!, t, info) : FLAGS.aroundOpen} onClick={onToggle} data-testid={n ? "trade-flag-badge" : "trade-around-open"}
      >
        {n > 0 && <span className="flagchip"><FlagIcon />{FLAGS.badge(n)}</span>}
        <svg className="chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
    </td>
  );
}

/** The trade named by `?t=` in the address, read once after mount (null when none). */
export function useLinkedTrade(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is read once, after hydration
    if (t) setId(t);
  }, []);
  return id;
}
