"use client";
// "Around this trade": what public records sit near one trade, each with its source. The review flags it met (with
// their detail and the rules that could not be checked), the company's 8-K filings within 30 days either side (from
// the organisation file, loaded on open; the block is left out for a build without the SEC stage), PAC money from the
// company to this member in the trade's two-year cycle (full edges and ledger rows), other members trading it within
// 7 days (from the pile_on detail), and a news-search link. Coverage decides the wording: "not available" when the org
// file has no sec_coverage, and "no 8-K" only when coverage is complete over the whole window and the trade is
// counted (org files keep 8-Ks only near counted trades). A trade a later filing deleted was never checked against
// the flags, and the PAC block never says "none" for a trade the money rule flagged.
import "@/styles/around.css";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FlagDetail, OrgFileWire, SecCoverage, SecEvent } from "@/lib/types";
import type { TradeRow } from "@/lib/data/decode";
import { AROUND, RULE_LABEL, type RuleId } from "@/lib/copy-flags";
import { cycleOf, metRules } from "@/lib/domain/flags";
import { eventsNear, itemLabel, newsSearchUrl, secState, secStateText } from "@/lib/domain/secevents";
import { fecCommitteeUrl, notChecked, notCheckedText, pacEmptyKind, pacTies } from "@/lib/domain/around";
import { amountText, assetWithTicker, count, date, NOT_DISCLOSED, plural } from "@/lib/format";
import { dataUrl, memberHref, safeHttpUrl } from "@/lib/urls";
import { getJSON } from "@/lib/data/fetch";
import { orgShard } from "@/lib/hash";
import { ExternalIcon } from "@/components/shared/ExternalIcon";
import { actionLabel } from "./tradeLabels";
import { FlagDetailLine } from "./FlagDetailLine";
import type { TradeFlagInfo } from "./memberTrades";

type Sec = { status: "loading" | "ok" | "error"; coverage?: SecCoverage; events?: SecEvent[] };

function useOrgSec(org: string | null): Sec {
  const [s, setS] = useState<Sec>({ status: "loading" });
  useEffect(() => {
    if (!org || !org.startsWith("co:")) return;
    let live = true;
    orgShard(org)
      .then((sh) => getJSON<Record<string, OrgFileWire>>(dataUrl(`orgs/${sh}.json`)))
      .then((m) => live && setS({ status: "ok", coverage: m[org]?.sec_coverage, events: m[org]?.sec_events }))
      .catch(() => live && setS({ status: "error" }));
    return () => { live = false; };
  }, [org]);
  return s;
}

function SecBlock({ t }: { t: TradeRow }) {
  const sec = useOrgSec(t.org);
  const isCo = Boolean(t.org?.startsWith("co:"));
  if (isCo && sec.status === "loading") return <p className="nd">{AROUND.secLoading}</p>;
  if (isCo && sec.status === "error") return <p className="nd">{AROUND.secError}</p>;
  const state = secState(t.org, sec.coverage, t.date);
  const list = state.kind === "no_company" || state.kind === "unavailable" || state.kind === "undated" ? [] : eventsNear(sec.events, t.date);
  // Org files hold 8-Ks only near counted trades: for a deleted row an empty list proves nothing.
  const note = t.notCounted && state.kind !== "no_company" && state.kind !== "unavailable" && state.kind !== "undated"
    ? AROUND.secNotCounted : secStateText(state, list.length === 0);
  return (
    <>
      {note && <p className="around__note" data-testid="around-sec-note">{note}</p>}
      {list.length > 0 && (
        <table className="around__table" data-testid="around-sec">
          <thead><tr><th scope="col">{AROUND.secCols.date}</th><th scope="col">{AROUND.secCols.form}</th><th scope="col">{AROUND.secCols.items}</th><th scope="col"><span className="visually-hidden">{AROUND.secCols.link}</span></th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.accession}>
                <td className="mono">{date(e.date)}<span className="sub"> {AROUND.secDays(e.offset)}</span></td>
                <td className="mono">{e.form}</td>
                <td>{e.items.map((c) => <span key={c} className="around__item"><span className="mono">{c}</span> {itemLabel(c)}</span>)}</td>
                <td>{safeHttpUrl(e.url) && <a href={safeHttpUrl(e.url)!} target="_blank" rel="noopener noreferrer">SEC <ExternalIcon /></a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function PacBlock({ t, info, flagged }: { t: TradeRow; info: TradeFlagInfo; flagged: boolean }) {
  const cycle = cycleOf(t.date);
  if (!t.org || cycle == null) return <p className="nd">{t.org ? AROUND.secNoDate : AROUND.secNoCompany}</p>;
  const span = `${cycle - 1}–${cycle}`;
  const ties = pacTies(t.org, cycle, info.pac[t.org] ?? [], info.ledger[t.org] ?? []);
  if (!ties.edges.length && !ties.ledger.length) {
    const kind = pacEmptyKind(flagged, info.ledgerTrimmed);
    return <p className="around__note" data-testid="around-pac-none">{kind === "flagged" ? AROUND.pacFlagged : kind === "trimmed" ? AROUND.pacTrimmed(span) : AROUND.pacNone(span)}</p>;
  }
  const money = (x: { low: number | null; high: number | null; exact: number | null }) => amountText(x) ?? NOT_DISCLOSED;
  return (
    <ul className="around__list" data-testid="around-pac">
      {ties.edges.map((m) => (
        <li key={m.edge}>
          {m.via && <strong>{m.via}: </strong>}
          {AROUND.pacTotal(money({ low: m.low, high: m.high, exact: m.exact }), plural(m.n, "record"))}
          <ul>
            {m.evidence.map((x, i) => (
              <li key={i}>{safeHttpUrl(x.url) ? <a href={safeHttpUrl(x.url)!} target="_blank" rel="noopener noreferrer">{x.label} <ExternalIcon /></a> : x.label}</li>
            ))}
          </ul>
        </li>
      ))}
      {ties.ledger.map((r, i) => {
        const fec = fecCommitteeUrl(r.viaId);
        return (
          <li key={`l${i}`} data-testid="around-pac-ledger">
            {r.via && <strong>{r.via}: </strong>}
            {AROUND.pacLedger(money(r), plural(r.n, "record"), date(r.first), date(r.last))}
            {!r.whole && <> {AROUND.pacLedgerSpan}</>}
            {fec && <> <a href={fec} target="_blank" rel="noopener noreferrer">{AROUND.pacFec} <ExternalIcon /></a></>}
          </li>
        );
      })}
    </ul>
  );
}

function FlagsBlock({ t, info, flags }: { t: TradeRow; info: TradeFlagInfo; flags: Record<string, FlagDetail> | undefined }) {
  if (t.notCounted) return <p className="around__note" data-testid="around-not-counted">{AROUND.notCounted}</p>;
  const met = metRules(flags);
  const skipped = notCheckedText(notChecked(t, info).filter((x) => !met.includes(x.rule)));
  return (
    <>
      {met.length === 0 ? <p className="around__note">{AROUND.noFlags}</p> : (
        <ul className="around__list">
          {met.map((r: RuleId) => <li key={r}><span className="flagchip">{RULE_LABEL[r]}</span> <FlagDetailLine rule={r} d={flags![r]} t={t} info={info} /></li>)}
        </ul>
      )}
      {skipped && <p className="around__note sub" data-testid="around-not-checked">{skipped}</p>}
      <p className="around__stmt">{info.statement}</p>
    </>
  );
}

export function TradeAround({ t, info, flags, onClose }: { t: TradeRow; info: TradeFlagInfo; flags: Record<string, FlagDetail> | undefined; onClose: () => void }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [t.id]);
  const pile = flags?.pile_on as { members: string[]; observed: number; expected: number } | undefined;
  const name = (t.org && info.orgs[t.org]) || t.ticker || t.asset;
  const news = newsSearchUrl(name, t.date);
  return (
    <section ref={box} id="trade-around" className="around" aria-labelledby="around-h" data-testid="trade-around">
      <header className="around__head">
        <h3 id="around-h">{AROUND.title}</h3>
        <p className="around__trade">
          <span className="mono">{date(t.date)}</span> · {actionLabel(t.action)} · {assetWithTicker(t.asset, t.ticker)} · <span className="mono">{amountText({ low: t.low, high: t.high, exact: null }) ?? NOT_DISCLOSED}</span>
        </p>
        <button type="button" className="btn btn--small around__close" onClick={onClose} data-testid="around-close">{AROUND.close}</button>
      </header>
      <div className="around__grid">
        <div className="around__part" data-testid="around-flags">
          <h4>{AROUND.flagsTitle}</h4>
          <FlagsBlock t={t} info={info} flags={flags} />
        </div>
        {info.sec && (
          <div className="around__part" data-testid="around-sec-part">
            <h4>{AROUND.secTitle}</h4>
            <SecBlock t={t} />
          </div>
        )}
        <div className="around__part">
          <h4>{AROUND.pacTitle(cycleOf(t.date) ? `${cycleOf(t.date)! - 1}–${cycleOf(t.date)}` : NOT_DISCLOSED)}</h4>
          <PacBlock t={t} info={info} flagged={Boolean(flags?.money_both_ways) && !t.notCounted} />
        </div>
        <div className="around__part" data-testid="around-others">
          <h4>{AROUND.othersTitle}</h4>
          {pile ? (
            <>
              <ul className="around__list">{pile.members.map((m) => <li key={m}><Link href={memberHref(m)}>{info.names[m] ?? m}</Link></li>)}</ul>
              <p className="around__note">{AROUND.pileOn(count(pile.observed), String(pile.expected))}</p>
            </>
          ) : <p className="around__note">{AROUND.othersNone}</p>}
        </div>
      </div>
      {news && (
        <p className="around__news">
          <a href={news} target="_blank" rel="noopener noreferrer" data-testid="around-news">{AROUND.newsLink} <ExternalIcon /></a> <span className="sub">{AROUND.newsNote}</span>
        </p>
      )}
    </section>
  );
}
