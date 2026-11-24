"use client";
// The full file (/m/<id>/records): loads the member, trade and holdings files and shows every record in DataTables, with CSV and JSON downloads.
import { useEffect, useMemo, useState } from "react";
import { dataUrl, safeHttpUrl } from "@/lib/urls";
import { getJSON } from "@/lib/data/fetch";
import type { MemberFileWire } from "@/lib/types";
import { caveats, DOC_COLS, documentRows, identifierLinks, TIE_COLS, tieRows, TRADE_COLS_ALL, tradeRows } from "@/lib/domain/records";
import { USE_NOTICE, COVERAGE, VIEW } from "@/lib/copy";
import { SECTION_INDEX } from "@/lib/copy-ui";
import { buildViewCitation, type Citation, type SourceRef } from "@/lib/domain/citation";
import { coverageFacts, tradeValueStats, type CoverageMeta } from "@/lib/domain/coverage";
import { CiteButton } from "@/components/shared/CiteButton";
import { CitePrint } from "@/components/shared/CitePrint";
import { CoverageNote } from "@/components/shared/CoverageNote";
import "@/styles/cite.css";
import { PositionsRecords } from "./PositionsRecords";
import { DataTable, download, type TableCite } from "./DataTable";
import { FinanceRecords } from "./FinanceRecords";
import { UndatedBucket } from "./UndatedBucket";
import { COV_COLS, useRecordsView } from "./useRecordsView";
import { ViewBar, ViewPrintLine } from "@/components/shared/ViewBar";
import { AssumptionBar, useAssumptions } from "@/components/shared/Assume";
import { updateView } from "@/components/shared/useViewState";
import { Explain } from "@/components/shared/Explain";
import { isOrgId } from "@/lib/data/ids";
import { ASSET_COLS, coverageWords, holdingRows, LIABILITY_COLS, netWorthText, type HoldingsFile } from "@/lib/domain/holdings";

type TradeWire = { cols: string[]; rows: unknown[][]; filings: Record<string, string> };
const NO_EDGES: never[] = [];
type Source = { id: string; name: string; revision: string | null; retrieved: string | null; url: string | null };

/** Everything the site holds for one member, unfiltered: loaded from the same public files the site uses. */
export function RecordsView({ id, hasTrades, hasHoldings, everHouse, names, sources, built, pageUrl, siteName, release, cmeta }: {
  id: string; hasTrades: boolean; hasHoldings: boolean; everHouse: boolean; names: Record<string, string>; sources: Source[];
  built: string | null; pageUrl: string; siteName: string;
  /** The data release this page was rendered from (server-provided), or null. */
  release: string | null;
  /** The numbers the coverage facts need from meta.json. */
  cmeta: CoverageMeta;
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

  // The shared view (years, date basis, assumptions, selected tie) narrows each table; undated rows are kept apart.
  const { tables, edge } = useRecordsView(useMemo(() => ({ ties, trades: tradeTable, docs, assets, liabilities, coverage }), [ties, tradeTable, docs, assets, liabilities, coverage]));
  const assumption = useAssumptions(hasTrades ? id : null, hasTrades, NO_EDGES, NO_EDGES);
  const selectTie = useMemo(() => {
    const e = TIE_COLS.findIndex((c) => c.key === "edge_id"), o = TIE_COLS.findIndex((c) => c.key === "counterparty_id");
    return {
      col: "edge_id", selected: edge,
      onSelect: (v: string | null) => {
        const row = v ? ties.find((r) => r[e] === v) : null;
        const org = row && typeof row[o] === "string" && isOrgId(row[o]) ? (row[o] as string) : null;
        updateView({ edge: v, org }, { push: true });
      },
    };
  }, [edge, ties]);

  // Coverage limits for this member; holdings facts wait until the holdings file has loaded.
  const facts = useMemo(() => {
    if (!file) return [];
    const all = coverageFacts({
      member: file.member, coverage: file.coverage, tradeSummary: file.trade_summary, edges: file.edges, ledgerTotals: file.ledger_totals,
      holdings, meta: cmeta, tradeValues: tradeValueStats(trades),
    });
    return holdState === "loading" || holdState === "error" ? all.filter((f) => f.scope !== "holdings") : all;
  }, [file, holdings, holdState, cmeta, trades]);
  const env = useMemo(() => ({
    release, built,
    sources: sources.map((s): SourceRef => ({ id: s.id, name: s.name, url: s.url, revision: s.revision, retrieved: s.retrieved })),
  }), [release, built, sources]);
  const cite = useMemo(() => {
    const limitations = facts.map((f) => f.text);
    const view = (kind: "records", retrieved: string): Citation => buildViewCitation({
      kind, member: { id, name: file?.member.name ?? id }, limitations, env: { ...env, retrieved }, fec_candidate_ids: file?.member.fec_ids,
      counts: { ties: ties.length, trades: hasTrades && trades ? tradeTable.length : null, source_documents: docs.length },
      dates: { first: file?.trade_summary?.first ?? null, last: file?.trade_summary?.last ?? null },
    });
    const table = (idKeys: TableCite["idKeys"]): TableCite => ({
      idKeys,
      build: (t, retrieved) => buildViewCitation({
        kind: "table", member: { id, name: file?.member.name ?? id }, limitations, env: { ...env, retrieved }, fec_candidate_ids: file?.member.fec_ids,
        table: { title: t.title, filters: t.filters, shown: t.shown, total: t.total, ids: t.ids },
      }),
    });
    return { view, ties: table({ edge_ids: "edge_id" }), trades: table({ trade_ids: "id", filing_docs: "doc" }), docs: table({ filing_docs: "id" }), finance: table({}) };
  }, [facts, env, id, file, ties.length, tradeTable.length, docs.length, hasTrades, trades]);

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
        <CiteButton build={(retrieved) => cite.view("records", retrieved)} testId="cite-records" />
        <span className="rec__hint">Built from the files already loaded: the member file{hasTrades ? ", the trade file" : ""} and the source list, with a provenance header.</span>
      </div>

      <ViewPrintLine />
      <ViewBar showBasis={hasTrades} />
      {hasTrades && (
        <div className="no-print rec__assume">
          <AssumptionBar state={assumption} scope={m.name} />
          <p className="rec__note">{VIEW.assumeAppliedNote}</p>
        </div>
      )}
      {edge && (
        <p className="view-selected no-print" data-testid="rec-selected-tie">
          {VIEW.selectedTie}: <span className="mono">{edge}</span>{" "}
          <button type="button" className="linkbtn" onClick={() => updateView({ edge: null, org: null }, { push: true })}>{VIEW.clearTie}</button>
        </p>
      )}

      <span id="records-toc-start" className="rec__toc-start" tabIndex={-1} />
      <nav className="rec__toc" aria-label="On this page">
        <a href="#rec-ties">Ties ({ties.length.toLocaleString("en-US")})</a>
        {hasTrades && <a href="#rec-trades">Trades ({tradesReady ? tradeTable.length.toLocaleString("en-US") : "…"})</a>}
        <a href="#rec-money">Campaign money</a>
        <a href="#rec-docs">Source documents</a>
        <a href="#rec-ids">Identifiers</a>
        <a href="#rec-cov">Coverage and caveats</a>
        <a href="#rec-holdings">Holdings and net worth</a>
        {holdings?.positions_summary && <a href="#rec-positions">Position transitions</a>}
        <a href="#records-toc-start">{SECTION_INDEX.backToSections}</a>
      </nav>

      <section id="rec-ties" className="rec__sec" aria-labelledby="rec-ties-h">
        <h2 id="rec-ties-h">Every tie</h2>
        <p className="rec__note">Full edges (records attached, up to five shown per tie) and every ledger row (summarised, no records attached). Direction is from this member: in = received, out = given.</p>
        <CoverageNote facts={facts} scopes={["money", "orgs"]} label="Coverage for ties and money" testId="rec-coverage-ties" />
        <DataTable id="ties" title="Every tie" cols={TIE_COLS} rows={tables.ties.rows} file={`${m.id}-ties`} cite={cite.ties} years={tables.ties.years} select={selectTie} />
        <UndatedBucket id="ties" title="Every tie" cols={TIE_COLS} rows={tables.ties.undated} file={`${m.id}-ties`} />
      </section>

      {hasTrades && (
        <section id="rec-trades" className="rec__sec" aria-labelledby="rec-trades-h">
          <h2 id="rec-trades-h">Every trade</h2>
          <p className="rec__note">Current versions of periodic transaction reports, all columns as published. Low and high are the <Explain term="range">disclosed range</Explain>.</p>
          <CoverageNote facts={facts} scopes={["trades", "owner", "values"]} label="Coverage for trades" testId="rec-coverage-trades" />
          {state.trades === "error" ? (
            <p className="rec__state" role="alert">The trade file failed to load.</p>
          ) : !trades ? (
            <p className="rec__state" aria-busy="true">Loading the trade file…</p>
          ) : (
            <>
              {tables.trades.excluded > 0 && !tables.trades.years && <p className="rec__note" data-testid="rec-trades-leftout">{VIEW.leftOut(tables.trades.excluded)}</p>}
              <DataTable id="trades" title="Every trade" cols={TRADE_COLS_ALL} rows={tables.trades.rows} file={`${m.id}-trades`} cite={cite.trades} years={tables.trades.years} />
              <UndatedBucket id="trades" title="Every trade" cols={TRADE_COLS_ALL} rows={tables.trades.undated} file={`${m.id}-trades`} />
            </>
          )}
        </section>
      )}

      <FinanceRecords id={m.id} cf={file.campaign_finance} cite={cite.finance} />

      <section id="rec-docs" className="rec__sec" aria-labelledby="rec-docs-h">
        <h2 id="rec-docs-h">Source documents</h2>
        <p className="rec__note">Every official document or record page referenced anywhere in this member&rsquo;s data, once each, with how many rows cite it.</p>
        {tradesReady ? <><DataTable id="docs" title="Source documents" cols={DOC_COLS} rows={tables.docs.rows} file={`${m.id}-documents`} cite={cite.docs} years={tables.docs.years} /><UndatedBucket id="docs" title="Source documents" cols={DOC_COLS} rows={tables.docs.undated} file={`${m.id}-documents`} /></> : <p className="rec__state" aria-busy="true">Waiting for the trade file…</p>}
      </section>

      <section id="rec-ids" className="rec__sec" aria-labelledby="rec-ids-h">
        <h2 id="rec-ids-h">Identifiers and official pages</h2>
        <dl className="rec__ids">
          {identifierLinks(m).map((x, i) => {
            const url = safeHttpUrl(x.url);
            return (
              <div key={i}>
                <dt>{x.label}</dt>
                <dd>
                  <span className="mono">{x.value}</span>
                  {url && (
                    <> · <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https:\/\//, "")}</a></>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section id="rec-cov" className="rec__sec" aria-labelledby="rec-cov-h">
        <h2 id="rec-cov-h">Coverage by year and caveats</h2>
        <ul className="rec__caveats">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <DataTable id="coverage" title="Coverage by year" cols={COV_COLS} rows={tables.coverage.rows} file={`${m.id}-coverage`} years={tables.coverage.years} />
      </section>

      {holdings && <PositionsRecords id={id} available={!!holdings.positions_summary} />}

      {/* Holdings and net worth (House annual reports, holdings/<id>.json): a one-line note when absent. */}
      <section id="rec-holdings" className="rec__sec" aria-labelledby="rec-holdings-h">
        <h2 id="rec-holdings-h">Holdings and net worth</h2>
        {holdState === "loading" ? (
          <p className="rec__state" aria-busy="true">Loading the holdings file…</p>
        ) : holdState === "error" ? (
          <p className="rec__state" role="alert">The holdings file failed to load.</p>
        ) : !holdings ? (
          <p className="rec__note" data-testid="rec-holdings-none">{everHouse ? COVERAGE.houseNoReport : COVERAGE.senateHoldings}</p>
        ) : (
          <div data-testid="rec-holdings">
            <p className="rec__note">
              Every asset and liability row from the House annual reports used, {Object.keys(holdings.years).sort()[0]}–{Object.keys(holdings.years).sort().slice(-1)[0]}, as filed: owner as printed (a blank owner is &ldquo;unspecified&rdquo;), real property at city and state only, value bands not midpoints.
              Disclosed net worth range by year: {Object.keys(holdings.years).sort().map((y) => `${y} ${netWorthText(holdings.years[y].net_worth)}`).join("; ")}.
            </p>
            <p className="rec__note">Coverage: {holdings.coverage.map((c) => `${c.year} ${coverageWords(c.status)}`).join("; ")}.</p>
            <p className="rec__note">Excluded by law: {holdings.net_worth_definition.excludes.join("; ")}.</p>
            <h3 className="rec__h3">Assets</h3>
            <DataTable id="assets" title="Assets" cols={ASSET_COLS} rows={tables.assets.rows} file={`${m.id}-assets`} years={tables.assets.years} />
            <h3 className="rec__h3">Liabilities</h3>
            <DataTable id="liabilities" title="Liabilities" cols={LIABILITY_COLS} rows={tables.liabilities.rows} file={`${m.id}-liabilities`} years={tables.liabilities.years} />
          </div>
        )}
      </section>
      <CitePrint build={(retrieved) => cite.view("records", retrieved)} />
    </div>
  );
}
