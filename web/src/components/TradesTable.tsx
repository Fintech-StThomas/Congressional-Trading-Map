"use client";

import { useEffect, useMemo, useState } from "react";
import type { Trade } from "@/lib/types";
import { count, date, money, NOT_DISCLOSED } from "@/lib/format";
import { ExternalIcon } from "./EvidenceDrawer";

type Props = { initial: Trade[]; total: number; fullUrl: string };
type Key = "date" | "available" | "lag_days" | "owner" | "action" | "asset" | "ticker" | "low";
const PAGE = 25;

const OWNER_LABEL: Record<Trade["owner"], string> = {
  self: "Self", spouse: "Spouse", joint: "Joint", dependent: "Dependent", unspecified: "Unspecified",
};
const ACTION_LABEL: Record<Trade["action"], string> = { buy: "Buy", sell: "Sell", exchange: "Exchange", other: "Other" };
const CLASS_LABEL: Record<Trade["asset_class"], string> = {
  stock: "Stock", option: "Option", fund: "Fund", bond: "Bond", crypto: "Crypto", private: "Private", other: "Other", unknown: "Unknown",
};

function cmp(a: Trade, b: Trade, k: Key): number {
  const va = a[k], vb = b[k];
  // Missing values sort last in either direction.
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}

function Nd() {
  return <span className="nd">{NOT_DISCLOSED}</span>;
}

export function TradesTable({ initial, total, fullUrl }: Props) {
  const [trades, setTrades] = useState(initial);
  const [status, setStatus] = useState<"ok" | "loading" | "error">(total > initial.length ? "loading" : "ok");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "date", dir: -1 });
  const [year, setYear] = useState("all");
  const [owner, setOwner] = useState("all");
  const [cls, setCls] = useState("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (total <= initial.length) return;
    let live = true;
    fetch(fullUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { trades: Trade[] }) => {
        if (live) {
          setTrades(body.trades);
          setStatus("ok");
        }
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [fullUrl, total, initial.length]);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const t of trades) s.add(t.date?.slice(0, 4) ?? "undated");
    return [...s].sort().reverse();
  }, [trades]);
  const owners = useMemo(() => [...new Set(trades.map((t) => t.owner))], [trades]);
  const classes = useMemo(() => [...new Set(trades.map((t) => t.asset_class))], [trades]);

  const rows = useMemo(() => {
    const f = trades.filter(
      (t) =>
        (year === "all" || (t.date?.slice(0, 4) ?? "undated") === year) &&
        (owner === "all" || t.owner === owner) &&
        (cls === "all" || t.asset_class === cls),
    );
    return f.sort((a, b) => {
      const c = cmp(a, b, sort.k);
      const missing = a[sort.k] == null || b[sort.k] == null;
      return missing ? c : c * sort.dir;
    });
  }, [trades, year, owner, cls, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE);
  const late = rows.filter((t) => t.late).length;

  const th = (k: Key, label: string, cls?: string) => {
    const active = sort.k === k;
    return (
      <th scope="col" className={cls} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="sortbtn"
          onClick={() => {
            setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "date" || k === "available" || k === "lag_days" || k === "low" ? -1 : 1 }));
            setPage(0);
          }}
        >
          {label}
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={active ? `sorticon is-${sort.dir === 1 ? "up" : "down"}` : "sorticon"}>
            <path d="M2 4l3-3 3 3M2 6l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </th>
    );
  };

  if (!total) return <p className="empty">No periodic transaction reports on file for this member. Reports exist only from July 2012.</p>;

  return (
    <div className="trades" data-testid="trades-table">
      <div className="filters">
        <label>
          <span>Year</span>
          <select value={year} onChange={(e) => { setYear(e.target.value); setPage(0); }}>
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y === "undated" ? "Date not disclosed" : y}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Owner</span>
          <select value={owner} onChange={(e) => { setOwner(e.target.value); setPage(0); }}>
            <option value="all">Any owner</option>
            {owners.map((o) => (
              <option key={o} value={o}>{OWNER_LABEL[o]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Asset class</span>
          <select value={cls} onChange={(e) => { setCls(e.target.value); setPage(0); }}>
            <option value="all">Any class</option>
            {classes.map((c) => (
              <option key={c} value={c}>{CLASS_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <p className="filters__count mono" aria-live="polite">
          {status === "loading" ? `Loading all ${count(total)} trades…` : status === "error" ? `Showing ${count(trades.length)} of ${count(total)}; the rest failed to load.` : `${count(rows.length)} trades · ${count(late)} filed late`}
        </p>
      </div>
      <div className="tablewrap">
        <table className="tradetable">
          <caption className="visually-hidden">Periodic transaction reports, sortable. Column headers sort the table.</caption>
          <thead>
            <tr>
              {th("date", "Traded")}
              {th("available", "Disclosed")}
              {th("lag_days", "Lag", "num")}
              {th("owner", "Owner")}
              {th("action", "Action")}
              {th("asset", "Asset")}
              {th("ticker", "Ticker")}
              {th("low", "Range", "num")}
            </tr>
          </thead>
          <tbody>
            {slice.map((t) => (
              <tr key={t.id}>
                <td data-label="Traded" className="mono">{t.date ? date(t.date) : <Nd />}</td>
                <td data-label="Disclosed" className="mono">{t.available ? date(t.available) : <Nd />}</td>
                <td data-label="Lag" className="num mono">
                  {t.lag_days == null ? <Nd /> : <>{count(t.lag_days)} d</>}
                  {t.late && <span className="late" title="Disclosed more than 45 days after the trade">late</span>}
                </td>
                <td data-label="Owner">{t.owner === "unspecified" ? <span className="nd">unspecified</span> : OWNER_LABEL[t.owner]}</td>
                <td data-label="Action">
                  {ACTION_LABEL[t.action]}
                  {t.partial && <span className="ties__sub"> partial</span>}
                </td>
                <td data-label="Asset" className="trades__asset">
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noopener noreferrer">
                      {t.asset} <ExternalIcon />
                    </a>
                  ) : (
                    t.asset
                  )}
                  <span className="ties__sub">
                    {CLASS_LABEL[t.asset_class]}
                    {t.amended ? ` · amended, version ${t.version}` : ""}
                  </span>
                </td>
                <td data-label="Ticker" className="mono">{t.ticker ?? <Nd />}</td>
                <td data-label="Range" className="num mono">
                  {t.low == null && t.high == null ? <Nd /> : t.low != null && t.high != null ? `${money(t.low)}–${money(t.high)}` : money(t.low ?? t.high)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Trade pages">
          <button type="button" className="btn btn--small" onClick={() => setPage(p - 1)} disabled={p === 0}>
            Previous
          </button>
          <span className="mono">
            Page {p + 1} of {pages}
          </span>
          <button type="button" className="btn btn--small" onClick={() => setPage(p + 1)} disabled={p >= pages - 1}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
