"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MemberFileWire, Trade } from "@/lib/types";
import { decodeTrades, type TradeRow } from "@/lib/decode";
import { count, date, money, NOT_DISCLOSED } from "@/lib/format";
import { getJSON } from "@/lib/client";
import { ExternalIcon } from "./EvidenceDrawer";

type Props = { initial: TradeRow[]; total: number; fullUrl: string };
type Key = "date" | "available" | "lag_days" | "owner" | "action" | "asset" | "ticker" | "low";

const ROW = 44; // px, fixed so the list can be windowed
const VIEW_ROWS = 14;
const OVERSCAN = 8;

const OWNER_LABEL: Record<Trade["owner"], string> = {
  self: "Self", spouse: "Spouse", joint: "Joint", dependent: "Dependent", unspecified: "Unspecified",
};
const ACTION_LABEL: Record<Trade["action"], string> = { buy: "Buy", sell: "Sell", exchange: "Exchange", other: "Other" };
const CLASS_LABEL: Record<Trade["asset_class"], string> = {
  stock: "Stock", option: "Option", fund: "Fund", bond: "Bond", crypto: "Crypto", private: "Private", other: "Other", unknown: "Unknown",
};

function cmp(a: TradeRow, b: TradeRow, k: Key): number {
  const va = a[k], vb = b[k];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}

function Nd({ text = NOT_DISCLOSED }: { text?: string }) {
  return <span className="nd">{text}</span>;
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
export function TradesTable({ initial, total, fullUrl }: Props) {
  const [trades, setTrades] = useState(initial);
  const [status, setStatus] = useState<"ok" | "loading" | "error">(total > initial.length ? "loading" : "ok");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "date", dir: -1 });
  const [year, setYear] = useState("all");
  const [owner, setOwner] = useState("all");
  const [cls, setCls] = useState("all");
  const [late, setLate] = useState(false);
  const [top, setTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (total <= initial.length) return;
    let live = true;
    getJSON<MemberFileWire>(fullUrl)
      .then((file) => {
        if (!live) return;
        setTrades(decodeTrades(file));
        setStatus("ok");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [fullUrl, total, initial.length]);

  const years = useMemo(() => [...new Set(trades.map((t) => t.date?.slice(0, 4) ?? "undated"))].sort().reverse(), [trades]);
  const owners = useMemo(() => [...new Set(trades.map((t) => t.owner))], [trades]);
  const classes = useMemo(() => [...new Set(trades.map((t) => t.asset_class))], [trades]);

  const rows = useMemo(() => {
    const f = trades.filter(
      (t) =>
        (year === "all" || (t.date?.slice(0, 4) ?? "undated") === year) &&
        (owner === "all" || t.owner === owner) &&
        (cls === "all" || t.asset_class === cls) &&
        (!late || t.late === true),
    );
    return f.sort((a, b) => {
      const c = cmp(a, b, sort.k);
      return a[sort.k] == null || b[sort.k] == null ? c : c * sort.dir;
    });
  }, [trades, year, owner, cls, late, sort]);

  const lateCount = useMemo(() => rows.reduce((n, t) => n + (t.late ? 1 : 0), 0), [rows]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [year, owner, cls, late, sort]);

  if (!total) return <p className="empty">No periodic transaction reports on file for this member. Reports exist only from July 2012.</p>;

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + ROW * VIEW_ROWS) / ROW) + OVERSCAN);
  const slice = rows.slice(first, last);

  return (
    <div className="trades" data-testid="trades-table">
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
          <span>Late only</span>
        </label>
        <p className="filters__count mono" aria-live="polite">
          {status === "loading"
            ? `Loading all ${count(total)} trades…`
            : status === "error"
              ? `Showing ${count(trades.length)} of ${count(total)}; the rest failed to load.`
              : `${count(rows.length)} ${rows.length === 1 ? "trade" : "trades"} · ${count(lateCount)} disclosed late`}
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
        <table className="tradetable" aria-rowcount={rows.length + 1}>
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
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr className="vspacer" style={{ height: first * ROW }} aria-hidden="true"><td colSpan={8} /></tr>}
            {slice.map((t, i) => (
              <tr key={t.id} aria-rowindex={first + i + 2}>
                <td className="mono">{t.date ? date(t.date) : <Nd />}</td>
                <td className="mono">{t.available ? date(t.available) : <Nd />}</td>
                <td className="num mono">
                  {t.lag_days == null ? <Nd /> : <>{count(t.lag_days)} d</>}
                  {t.late && <span className="late" title="Disclosed more than 45 days after the trade">late</span>}
                </td>
                <td>{t.owner === "unspecified" ? <Nd text="unspecified" /> : OWNER_LABEL[t.owner]}</td>
                <td>
                  {ACTION_LABEL[t.action] ?? t.action}
                  {t.partial ? <span className="sub"> partial</span> : null}
                </td>
                <td className="trades__asset" title={t.asset}>
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noopener noreferrer">
                      <span className="trades__assettext">{t.asset}</span> <ExternalIcon />
                    </a>
                  ) : (
                    <span className="trades__assettext">{t.asset}</span>
                  )}
                  <span className="sub">
                    {CLASS_LABEL[t.asset_class] ?? t.asset_class}
                    {t.amended ? ` · amended v${t.version}` : ""}
                  </span>
                </td>
                <td className="mono">{t.ticker ?? <Nd />}</td>
                <td className="num mono">
                  {t.low == null && t.high == null ? <Nd /> : t.low != null && t.high != null ? `${money(t.low)}–${money(t.high)}` : money(t.low ?? t.high)}
                </td>
              </tr>
            ))}
            {last < rows.length && <tr className="vspacer" style={{ height: (rows.length - last) * ROW }} aria-hidden="true"><td colSpan={8} /></tr>}
          </tbody>
        </table>
        {rows.length === 0 && status !== "loading" && <p className="empty">No trades match these filters.</p>}
      </div>
    </div>
  );
}
