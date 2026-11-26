"use client";
// "Trades" on the member page: every periodic transaction report row, filterable, sortable and windowed
// (only visible rows are in the DOM). Starts with the newest rows from the server, then loads trades/<id>.json.
// The shared view (year window, date basis, assumptions) narrows it: years count by the transaction date or the date
// made public, never both, and trades without that date are listed apart, not placed in any year.
import "@/styles/delays.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade, TradeFile } from "@/lib/types";
import { decodeTradeFile, type TradeRow } from "@/lib/data/decode";
import Link from "next/link";
import { amountText, count, date, days, NOT_DISCLOSED } from "@/lib/format";
import { DELAYS, VIEW } from "@/lib/copy";
import { FLAGS } from "@/lib/copy-flags";
import { AMEND, DELAYS_AMEND } from "@/lib/copy-amend";
import { LaterCell, type Later } from "./LaterCell";
import { readAmendments } from "@/lib/domain/amendments";
import { isDefault, tradeCounts } from "@/lib/domain/assume";
import { basisYear, splitByYears } from "@/lib/domain/datebasis";
import { useView } from "@/components/shared/useViewState";
import { delayGroupFromTrades, overCount } from "@/lib/domain/delays";
import { getJSON } from "@/lib/data/fetch";
import { delaysHref, safeHttpUrl } from "@/lib/urls";
import { ExternalIcon } from "@/components/shared/ExternalIcon";
import "@/styles/flags.css";
import { ACTION_LABEL, CLASS_LABEL, OWNER_LABEL, cmp } from "./tradeLabels";
import type { FlagMap, TradeFlagInfo } from "./memberTrades";
import { AroundCell, FlagSummary, useLinkedTrade } from "./TradeFlags";
import { TradeAround } from "./TradeAround";

type Props = { initial: TradeRow[]; total: number; fullUrl: string; later?: Later; /** rows in the file, including those not counted (defaults to `total`) */ listed?: number; /** review flags and what "Around this trade" needs */ flags?: TradeFlagInfo };
type Key = "date" | "available" | "lag_days" | "owner" | "action" | "asset" | "ticker" | "low";

const ROW = 44; // px, fixed so the list can be windowed
const VIEW_ROWS = 14;
const OVERSCAN = 8;

function Nd({ text = NOT_DISCLOSED }: { text?: string }) {
  return <span className="nd">{text}</span>;
}

/** How the shown trades split by owner: most are not the member's own. */
function OwnerMix({ trades }: { trades: TradeRow[] }) {
  const c: Record<string, number> = {};
  for (const t of trades) c[t.owner] = (c[t.owner] ?? 0) + 1;
  const parts = (Object.keys(OWNER_LABEL) as Trade["owner"][]).filter((k) => c[k]).map((k) => `${OWNER_LABEL[k].toLowerCase()} ${count(c[k])}`);
  return <span className="ownermix"> · by owner: {parts.join(", ")}</span>;
}

const COLS: { k: Key; label: string; cls?: string }[] = [
  { k: "date", label: "Traded" },
  { k: "available", label: "Disclosed" },
  { k: "lag_days", label: "Lag", cls: "num" },
  { k: "owner", label: "Owner" },
  { k: "action", label: "Action" },
  { k: "asset", label: "Asset" },
  { k: "ticker", label: "Ticker" },
  { k: "low", label: "Range", cls: "num" },
];

/**
 * Every periodic transaction report row, sortable and filterable. The list is
 * windowed: only the rows in view are in the DOM, so tens of thousands stay fast.
 */
export function TradesTable({ initial, total, fullUrl, later: laterProp, listed, flags: info }: Props) {
  const rowsInFile = listed ?? total;
  const [trades, setTrades] = useState(initial);
  const [later, setLater] = useState<Later>(laterProp ?? { map: {}, filings: {}, marked: false });
  const [status, setStatus] = useState<"ok" | "loading" | "error">(rowsInFile > initial.length ? "loading" : "ok");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "date", dir: -1 });
  const [year, setYear] = useState("all");
  const [owner, setOwner] = useState("all");
  const [cls, setCls] = useState("all");
  const [late, setLate] = useState(false);
  const [undatedFor, setUndatedFor] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  const [flagMap, setFlagMap] = useState<FlagMap>(info?.byTrade ?? {});
  const [selected, setSelected] = useState<string | null>(null);
  const linked = useLinkedTrade();
  const view = useView();
  // "Show only the undated" holds for the year window it was chosen under, and lapses when the window changes.
  const yearsKey = view.years ? view.years.join("-") : "";
  const undatedOnly = yearsKey !== "" && undatedFor === yearsKey;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rowsInFile <= initial.length) return;
    let live = true;
    getJSON<TradeFile>(fullUrl)
      .then((file) => {
        if (!live) return;
        setTrades(decodeTradeFile(file, undefined, { listed: true }));
        setLater({ map: readAmendments(file), filings: file.filings ?? {}, marked: file.not_counted !== undefined });
        if (file.flags) setFlagMap(file.flags);
        setStatus("ok");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [fullUrl, rowsInFile, initial.length]);

  // The shared view first: assumptions drop trades, the year window splits the rest into in-window and undated.
  const counted = useMemo(() => (isDefault(view.assume) ? trades : trades.filter((t) => t.notCounted || tradeCounts(t, view.assume))), [trades, view.assume]);
  const windowed = useMemo(() => splitByYears(counted, view.years, view.basis), [counted, view.years, view.basis]);
  const base = undatedOnly && view.years ? windowed.undated : windowed.shown;
  const yearOfRow = (t: TradeRow) => basisYear(t, view.basis)?.toString() ?? "undated";
  const years = useMemo(() => [...new Set(base.map((t) => basisYear(t, view.basis)?.toString() ?? "undated"))].sort().reverse(), [base, view.basis]);
  const owners = useMemo(() => [...new Set(trades.map((t) => t.owner))], [trades]);
  const classes = useMemo(() => [...new Set(trades.map((t) => t.asset_class))], [trades]);

  const rows = useMemo(() => {
    const f = base.filter(
      (t) =>
        (year === "all" || yearOfRow(t) === year) &&
        (owner === "all" || t.owner === owner) &&
        (cls === "all" || t.asset_class === cls) &&
        (!late || (t.late === true && !t.notCounted)),
    );
    return f.sort((a, b) => {
      const c = cmp(a, b, sort.k);
      return a[sort.k] == null || b[sort.k] == null ? c : c * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, view.basis, year, owner, cls, late, sort]);

  const lateCount = useMemo(() => rows.reduce((n, t) => n + (t.late && !t.notCounted ? 1 : 0), 0), [rows]);
  // Rows a later filing marks Deleted are listed and marked, but counted nowhere: every figure below is over the counted rows.
  const liveRows = useMemo(() => rows.filter((t) => !t.notCounted), [rows]);
  const notCountedN = rows.length - liveRows.length;
  // Observed days from the transaction date to public availability, over every loaded trade (not the filtered rows).
  // The column appears only when this member has amended trades with later filings (older builds and most members have none).
  const showLater = useMemo(() => trades.some((t) => (t.amended && later.map[t.id]) || t.notCounted || t.lagWithheld === "amended_unmatched"), [trades, later]);
  const timing = useMemo(() => delayGroupFromTrades(trades), [trades]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [year, owner, cls, late, sort, view.years, view.basis, view.assume, undatedOnly]);
  // A link from /flags (?t=<trade id>): once every row is loaded, scroll that row into view and open its panel.
  useEffect(() => {
    const at = linked && status === "ok" ? rows.findIndex((t) => t.id === linked) : -1;
    if (at < 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time jump to a linked row
    setSelected(linked);
    scroller.current?.scrollTo({ top: Math.max(0, (at - 2) * ROW) });
  }, [linked, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = selected ? trades.find((t) => t.id === selected) ?? null : null;

  if (!total && !rowsInFile) return <p className="empty">No periodic transaction reports on file for this member&rsquo;s household. Reports exist only from July 2012.</p>;

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + ROW * VIEW_ROWS) / ROW) + OVERSCAN);
  const slice = rows.slice(first, last);

  return (
    <div className="trades" data-testid="trades-table">
      {status === "ok" && (
        <p className="trades__timing" data-testid="trades-timing">
          {DELAYS.memberLine}: median {days(timing.median)}, 90th percentile {days(timing.p90)}.{" "}
          {count(overCount(timing.bands))} of {count(timing.dated)} trades with both dates were public over 45 days after the transaction
          {timing.undated > 0 ? `; ${count(timing.undated)} with no date` : ""}
          {(timing.amended_unmatched ?? 0) > 0 ? `; ${DELAYS_AMEND.memberUnmatched(timing.amended_unmatched ?? 0)}` : ""}
          {(timing.date_corrected ?? 0) > 0 ? `; ${DELAYS_AMEND.memberCorrected(timing.date_corrected ?? 0)}` : ""}.{" "}
          <Link href={delaysHref()}>{DELAYS.memberLink}</Link>
        </p>
      )}
      {view.years && windowed.undated.length > 0 && (
        <p className="view-undated" data-testid="trades-undated">
          {VIEW.undated(windowed.undated.length, view.basis)}{" "}
          <button type="button" className="linkbtn" aria-pressed={undatedOnly} onClick={() => setUndatedFor(undatedOnly ? null : yearsKey)} data-testid="trades-undated-toggle">
            {undatedOnly ? VIEW.hideUndated : VIEW.showUndated(windowed.undated.length)}
          </button>
        </p>
      )}
      {counted.length < trades.length && <p className="view-undated" data-testid="trades-leftout">{VIEW.leftOut(trades.length - counted.length)}</p>}
      {info && <FlagSummary info={info} />}
      <div className="filters">
        <label>
          <span>Year</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y === "undated" ? "Date not disclosed" : y}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Owner</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Any owner</option>
            {owners.map((o) => (
              <option key={o} value={o}>{OWNER_LABEL[o]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Asset class</span>
          <select value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="all">Any class</option>
            {classes.map((c) => (
              <option key={c} value={c}>{CLASS_LABEL[c] ?? c}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} />
          <span>{DELAYS.overFilter}</span>
        </label>
        <p className="filters__count mono" aria-live="polite">
          {status === "loading"
            ? `Loading all ${count(total)} trades…`
            : status === "error"
              ? `Showing ${count(trades.length)} of ${count(total)}; the rest failed to load.`
              : `${count(liveRows.length)} ${liveRows.length === 1 ? "trade" : "trades"} · ${count(lateCount)} public over 45 days after the trade${notCountedN ? ` · ${count(notCountedN)} more listed, not counted` : ""}`}
          {status === "ok" && owners.length > 0 && <OwnerMix trades={liveRows} />}
        </p>
      </div>
      <div
        className="vtable"
        ref={scroller}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        style={{ "--row": `${ROW}px`, maxHeight: ROW * VIEW_ROWS + 42 } as React.CSSProperties}
        tabIndex={0}
        aria-label="Trades. Scroll to see more rows."
      >
        <table className={showLater ? "tradetable has-later" : "tradetable"} aria-rowcount={rows.length + 1}>
          <caption className="visually-hidden">Periodic transaction reports. Column buttons sort the table.</caption>
          <thead>
            <tr aria-rowindex={1}>
              {COLS.map(({ k, label, cls: c }) => {
                const active = sort.k === k;
                return (
                  <th key={k} scope="col" className={c} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      className="sortbtn"
                      onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : ["date", "available", "lag_days", "low"].includes(k) ? -1 : 1 }))}
                    >
                      {label}
                      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={active ? `sorticon is-${sort.dir === 1 ? "up" : "down"}` : "sorticon"}>
                        <path d="M2 4l3-3 3 3M2 6l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </button>
                  </th>
                );
              })}
              {showLater && <th scope="col" className="trades__laterh">{AMEND.column}</th>}
              {info && <th scope="col" className="trades__aroundh">{FLAGS.aroundColumn}</th>}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr className="vspacer" style={{ height: first * ROW }} aria-hidden="true"><td colSpan={8 + (showLater ? 1 : 0) + (info ? 1 : 0)} /></tr>}
            {slice.map((t, i) => (
              <tr key={t.id} aria-rowindex={first + i + 2} className={[t.notCounted ? "is-notcounted" : "", selected === t.id ? "is-active" : ""].join(" ").trim() || undefined} title={t.notCounted ? AMEND.notCounted : undefined}>
                <td className="mono">{t.date ? date(t.date) : <Nd />}</td>
                <td className="mono">{t.available ? date(t.available) : <Nd />}</td>
                <td className="num mono">
                  {t.lag_days != null ? <>{count(t.lag_days)} d</> : t.lagWithheld === "amended_unmatched" ? <span className="nd" title={AMEND.unmatched}>{AMEND.unmatchedShort}</span> : t.date && t.available && t.amended ? <span className="nd" title={AMEND.dateCorrectedTitle}>{AMEND.dateCorrectedShort}</span> : <Nd />}
                  {t.late && !t.notCounted && <span className="late" title={DELAYS.overTitle} aria-label={DELAYS.overTitle}>{DELAYS.overChip}</span>}
                </td>
                <td className={`owner owner--${t.owner}`}>{t.owner === "unspecified" ? <Nd text="not stated" /> : OWNER_LABEL[t.owner]}</td>
                <td>
                  {ACTION_LABEL[t.action] ?? t.action}
                  {t.partial ? <span className="sub"> partial</span> : null}
                </td>
                <td className="trades__asset" title={t.asset}>
                  {safeHttpUrl(t.url) ? (
                    <a href={safeHttpUrl(t.url) ?? undefined} target="_blank" rel="noopener noreferrer">
                      <span className="trades__assettext">{t.asset}</span> <ExternalIcon />
                    </a>
                  ) : (
                    <span className="trades__assettext">{t.asset}</span>
                  )}
                  <span className="sub">
                    {CLASS_LABEL[t.asset_class] ?? t.asset_class}
                    {t.amended ? ` · ${AMEND.amended}${t.version > 1 ? ` v${t.version}` : ""}` : ""}
                    {t.notCounted ? ` · ${AMEND.notCountedShort}` : ""}
                  </span>
                </td>
                <td className="mono">{t.ticker ?? <Nd />}</td>
                <td className="num mono">
                  {amountText({ low: t.low, high: t.high, exact: null }) ?? <Nd />}
                </td>
                {showLater && <td className="trades__later">{t.amended && <LaterCell t={t} later={later} />}</td>}
                {info && <AroundCell t={t} flags={flagMap[t.id]} info={info} open={selected === t.id} onToggle={() => setSelected(selected === t.id ? null : t.id)} />}
              </tr>
            ))}
            {last < rows.length && <tr className="vspacer" style={{ height: (rows.length - last) * ROW }} aria-hidden="true"><td colSpan={8 + (showLater ? 1 : 0) + (info ? 1 : 0)} /></tr>}
          </tbody>
        </table>
        {rows.length === 0 && status !== "loading" && <p className="empty">No trades match these filters.</p>}
      </div>
      {info && picked && <TradeAround key={picked.id} t={picked} info={info} flags={flagMap[picked.id]} onClose={() => setSelected(null)} />}
    </div>
  );
}
