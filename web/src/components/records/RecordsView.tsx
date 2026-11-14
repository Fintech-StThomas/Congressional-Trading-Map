"use client";

import { useEffect, useMemo, useState } from "react";
import { dataUrl, getJSON } from "@/lib/client";
import type { MemberFileWire } from "@/lib/types";
import {
  caveats, DOC_COLS, documentRows, identifierLinks, TIE_COLS, tieRows, TRADE_COLS_ALL, tradeRows, USE_NOTICE, type Col,
} from "@/lib/records";
import { DataTable, download } from "./DataTable";
import { ASSET_COLS, coverageWords, holdingRows, LIABILITY_COLS, netWorthText, SENATE_NOTE, type HoldingsFile } from "@/lib/holdings";

type TradeWire = { cols: string[]; rows: unknown[][]; filings: Record<string, string> };
type Source = { id: string; name: string; revision: string | null; retrieved: string | null; url: string | null };

const COV_COLS: Col[] = [
  { key: "year", label: "Year", kind: "num", width: 80 },
  { key: "trades", label: "Trade coverage", kind: "text", width: 130 },
  { key: "money", label: "Money coverage", kind: "text", width: 130 },
  { key: "n_trades", label: "Trades in this file", kind: "num", width: 140 },
];

/** Everything the site holds for one member, unfiltered: loaded from the same public files the site uses. */
export function RecordsView({ id, hasTrades, hasHoldings, everHouse, names, sources, built, pageUrl, siteName }: {
  id: string; hasTrades: boolean; hasHoldings: boolean; everHouse: boolean; names: Record<string, string>; sources: Source[];
  built: string | null; pageUrl: string; siteName: string;
}) {
  const [file, setFile] = useState<MemberFileWire | null>(null);
  const [trades, setTrades] = useState<TradeWire | null>(null);
  const [holdings, setHoldings] = useState<HoldingsFile | null>(null);
  const [holdState, setHoldState] = useState<"none" | "loading" | "ok" | "error">(hasHoldings ? "loading" : "none");
  const [state, setState] = useState<{ member: "loading" | "ok" | "error"; trades: "loading" | "ok" | "error" | "none" }>({
    member: "loading", trades: hasTrades ? "loading" : "none",
  });

  useEffect(() => {
    getJSON<MemberFileWire>(dataUrl(`members/${id}.json`))
      .then((f) => {
        setFile(f);
        setState((s) => ({ ...s, member: "ok" }));
      })
      .catch(() => setState((s) => ({ ...s, member: "error" })));
    if (hasTrades)
      getJSON<TradeWire>(dataUrl(`trades/${id}.json`))
        .then((t) => {
          setTrades(t);
          setState((s) => ({ ...s, trades: "ok" }));
        })
        .catch(() => setState((s) => ({ ...s, trades: "error" })));
    // holdings/<id>.json (House annual reports) exists only for some House members.
    if (hasHoldings)
      getJSON<HoldingsFile>(dataUrl(`holdings/${id}.json`))
        .then((h) => {
          setHoldings(h);
          setHoldState("ok");
        })
        .catch(() => setHoldState("error"));
  }, [id, hasTrades, hasHoldings]);

  const name = useMemo(() => {
    const nodes = file?.nodes ?? {};
    return (x: string) => names[x] ?? nodes[x]?.name ?? x;
  }, [file, names]);
  const sourceName = useMemo(() => {
    const m = Object.fromEntries(sources.map((s) => [s.id, s.name]));
    return (x: string) => m[x] ?? x;
  }, [sources]);

  const ties = useMemo(() => (file ? tieRows(file, name) : []), [file, name]);
  const tradeTable = useMemo(() => tradeRows(trades), [trades]);
  const docs = useMemo(() => (file ? documentRows(file, trades, sourceName) : []), [file, trades, sourceName]);
  const notes = useMemo(() => (file ? caveats(file, trades) : []), [file, trades]);
  const assets = useMemo(() => (holdings ? holdingRows(holdings, "assets") : []), [holdings]);
  const liabilities = useMemo(() => (holdings ? holdingRows(holdings, "liabilities") : []), [holdings]);
  const coverage = useMemo(() => {
    const by = file?.trade_summary?.by_year ?? {};
    return (file?.coverage ?? []).map((c) => [c.year, c.trades, c.money, by[String(c.year)] ?? 0]);
  }, [file]);

  if (state.member === "error") return <p className="rec__state" role="alert">The member file failed to load. Reload the page to try again.</p>;
  if (!file) return <p className="rec__state" aria-busy="true">Loading the file…</p>;
  const m = file.member;
  const tradesReady = state.trades !== "loading";

  const everything = () => {
    const out = {
      provenance: {
        site: siteName, page: pageUrl, built, generated: new Date().toISOString(),
        sources: sources.map((s) => ({ id: s.id, name: s.name, revision: s.revision, retrieved: s.retrieved, url: s.url })),
        use_notice: USE_NOTICE,
        note: "The records as filed and as published by the site's pipeline, not conclusions. Amounts are disclosed ranges; no midpoint is implied.",
      },
      member: file,
      trades: trades ?? null,
      documents: docs.map((r) => Object.fromEntries(DOC_COLS.map((c, i) => [c.key, r[i]]))),
      ...(holdings ? { holdings } : {}),
    };
    download(`${m.id}-full-file.json`, JSON.stringify(out, null, 1), "application/json");
  };

  return (
    <div className="rec" data-testid={tradesReady && holdState !== "loading" ? "records-ready" : "records-loading"}>
      <div className="rec__actions">
        <button type="button" className="btn btn--paper" onClick={everything} disabled={!tradesReady} data-testid="rec-json">
          Download everything as JSON
        </button>
        <span className="rec__hint">Built from the files already loaded: the member file{hasTrades ? ", the trade file" : ""} and the source list, with a provenance header.</span>
      </div>

      <nav className="rec__toc" aria-label="On this page">
        <a href="#rec-ties">Ties ({ties.length.toLocaleString("en-US")})</a>
        {hasTrades && <a href="#rec-trades">Trades ({tradesReady ? tradeTable.length.toLocaleString("en-US") : "…"})</a>}
        <a href="#rec-docs">Source documents</a>
        <a href="#rec-ids">Identifiers</a>
        <a href="#rec-cov">Coverage and caveats</a>
        <a href="#rec-holdings">Holdings and net worth</a>
      </nav>

      <section id="rec-ties" className="rec__sec" aria-labelledby="rec-ties-h">
        <h2 id="rec-ties-h">Every tie</h2>
        <p className="rec__note">Full edges (records attached, up to five shown per tie) and every ledger row (summarised, no records attached). Direction is from this member: in = received, out = given.</p>
        <DataTable id="ties" title="Every tie" cols={TIE_COLS} rows={ties} file={`${m.id}-ties`} />
      </section>

      {hasTrades && (
        <section id="rec-trades" className="rec__sec" aria-labelledby="rec-trades-h">
          <h2 id="rec-trades-h">Every trade</h2>
          <p className="rec__note">Current versions of periodic transaction reports, all columns as published. Low and high are the disclosed range.</p>
          {state.trades === "error" ? (
            <p className="rec__state" role="alert">The trade file failed to load.</p>
          ) : !trades ? (
            <p className="rec__state" aria-busy="true">Loading the trade file…</p>
          ) : (
            <DataTable id="trades" title="Every trade" cols={TRADE_COLS_ALL} rows={tradeTable} file={`${m.id}-trades`} />
          )}
        </section>
      )}

      <section id="rec-docs" className="rec__sec" aria-labelledby="rec-docs-h">
        <h2 id="rec-docs-h">Source documents</h2>
        <p className="rec__note">Every official document or record page referenced anywhere in this member&rsquo;s data, once each, with how many rows cite it.</p>
        {tradesReady ? <DataTable id="docs" title="Source documents" cols={DOC_COLS} rows={docs} file={`${m.id}-documents`} /> : <p className="rec__state" aria-busy="true">Waiting for the trade file…</p>}
      </section>

      <section id="rec-ids" className="rec__sec" aria-labelledby="rec-ids-h">
        <h2 id="rec-ids-h">Identifiers and official pages</h2>
        <dl className="rec__ids">
          {identifierLinks(m).map((x, i) => (
            <div key={i}>
              <dt>{x.label}</dt>
              <dd>
                <span className="mono">{x.value}</span>
                {x.url && (
                  <> · <a href={x.url} target="_blank" rel="noreferrer">{x.url.replace(/^https:\/\//, "")}</a></>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="rec-cov" className="rec__sec" aria-labelledby="rec-cov-h">
        <h2 id="rec-cov-h">Coverage by year and caveats</h2>
        <ul className="rec__caveats">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <DataTable id="coverage" title="Coverage by year" cols={COV_COLS} rows={coverage} file={`${m.id}-coverage`} />
      </section>

      {/* Holdings and net worth (House annual reports, holdings/<id>.json): a one-line note when absent. */}
      <section id="rec-holdings" className="rec__sec" aria-labelledby="rec-holdings-h">
        <h2 id="rec-holdings-h">Holdings and net worth</h2>
        {holdState === "loading" ? (
          <p className="rec__state" aria-busy="true">Loading the holdings file…</p>
        ) : holdState === "error" ? (
          <p className="rec__state" role="alert">The holdings file failed to load.</p>
        ) : !holdings ? (
          <p className="rec__note" data-testid="rec-holdings-none">{everHouse ? "No House annual report for this member is in the source data." : SENATE_NOTE}</p>
        ) : (
          <div data-testid="rec-holdings">
            <p className="rec__note">
              Every asset and liability row from the House annual reports used, {Object.keys(holdings.years).sort()[0]}–{Object.keys(holdings.years).sort().slice(-1)[0]}, as filed: owner as printed (a blank owner is &ldquo;unspecified&rdquo;), real property at city and state only, value bands not midpoints.
              Disclosed net worth range by year: {Object.keys(holdings.years).sort().map((y) => `${y} ${netWorthText(holdings.years[y].net_worth)}`).join("; ")}.
            </p>
            <p className="rec__note">Coverage: {holdings.coverage.map((c) => `${c.year} ${coverageWords(c.status)}`).join("; ")}.</p>
            <p className="rec__note">Excluded by law: {holdings.net_worth_definition.excludes.join("; ")}.</p>
            <h3 className="rec__h3">Assets</h3>
            <DataTable id="assets" title="Assets" cols={ASSET_COLS} rows={assets} file={`${m.id}-assets`} />
            <h3 className="rec__h3">Liabilities</h3>
            <DataTable id="liabilities" title="Liabilities" cols={LIABILITY_COLS} rows={liabilities} file={`${m.id}-liabilities`} />
          </div>
        )}
      </section>
    </div>
  );
}
