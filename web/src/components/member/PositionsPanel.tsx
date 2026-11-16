"use client";
// On-demand asset timelines: annual snapshots, filed trades, report gaps and source links.
import { useMemo, useState } from "react";
import { getJSON } from "@/lib/data/fetch";
import { dataUrl, safeHttpUrl } from "@/lib/urls";
import { HOLDINGS_NOT_SHOWN, POSITIONS_INTRO, POSITION_CLASSES, POSITION_STATUS_NOTE } from "@/lib/copy";
import { bandText, decodePositions, filterPositions, gridYears, sortPositions, statusText, yearState, type FilterKey, type PositionsFile, type SortKey } from "@/lib/domain/positions";

function Filing({ url, children }: { url: string | null | undefined; children: React.ReactNode }) {
  const safe = safeHttpUrl(url);
  return safe ? <a href={safe} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
}

export function PositionsPanel({ memberId, available }: { memberId: string; available: boolean }) {
  const [file, setFile] = useState<PositionsFile | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ok">("idle");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [limit, setLimit] = useState(20);
  const decoded = useMemo(() => file ? decodePositions(file) : [], [file]);
  const assets = useMemo(() => sortPositions(filterPositions(decoded, filter), sort), [decoded, filter, sort]);
  const years = useMemo(() => file ? gridYears(file) : [], [file]);
  async function load() {
    setState("loading");
    try {
      setFile(await getJSON<PositionsFile>(dataUrl(`holdings/positions/${memberId}.json`)));
      setState("ok");
    } catch { setState("error"); }
  }
  return <section className="section hold positions" aria-labelledby="positions-h" data-testid="positions">
    <h2 id="positions-h">Positions over time</h2>
    <p className="section__note">{POSITIONS_INTRO}</p>
    <p className="hold__small">{POSITION_STATUS_NOTE}</p>
    {!available ? <p className="hold__small">Position timelines are not available in this data build.</p> : <>
      {state !== "ok" && <button className="btn btn--paper" disabled={state === "loading"} onClick={load}>{state === "loading" ? "Loading positions…" : state === "error" ? "Retry loading positions" : "Load position timelines"}</button>}
      {state === "error" && <p role="alert">The positions file failed to load. Try again.</p>}
      {file && <>
        <div className="positions__controls">
          <label>Show <select value={filter} onChange={(e) => { setFilter(e.target.value as FilterKey); setLimit(20); }}><option value="all">All assets</option><option value="stock">Stocks</option><option value="fund">Funds</option><option value="traded">With filed trades</option></select></label>
          <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="value">Latest listed value</option><option value="first">First listed year</option><option value="trades">Filed trades</option></select></label>
          <span>{assets.length.toLocaleString("en-US")} assets</span>
        </div>
        <p className="hold__small">Each cell links to an annual report. Select an asset for its trades and transitions. Bands are disclosed ranges, not prices.</p>
        <div className="tablewrap" tabIndex={0} role="region" aria-label="Asset timelines, scroll to see every year">
          <table className="ties hold__table positions__table"><thead><tr><th scope="col">Asset / filed records</th>{years.map((y) => <th scope="col" key={y}>{y}</th>)}</tr></thead>
            <tbody>{assets.slice(0, limit).map((a) => <tr key={a.key}>
              <th scope="row"><details><summary>{a.name}</summary><p>{statusText(a.status)} · {a.kind}</p>
                <ul>{a.transitions.map((x) => <li key={x.from}>{x.from}–{x.to}: <span title={POSITION_CLASSES[x.class]?.note}>{POSITION_CLASSES[x.class]?.label ?? x.class}</span>{x.gap > 0 ? `; ${x.gap} intervening year(s) without a used report` : ""}{x.owner_change ? "; owner changed" : ""}. {POSITION_CLASSES[x.class]?.note}</li>)}</ul>
                {a.tradeList.length ? <ul>{a.tradeList.map((t) => <li key={t.id}><Filing url={file.filings[t.doc]}>{t.date} · {t.action} · {bandText(t.low, t.high)} · {t.owner}</Filing></li>)}</ul> : <p>No matched household trades.</p>}
              </details></th>
              {years.map((y) => { const s = a.snaps.get(y); return <td key={y}>{s ? <><Filing url={file.docs[s.doc]}>{bandText(s.low, s.high, s.unvalued)}</Filing><span className="sub">{s.owners.join(", ")}</span></> : yearState(file, y) === "report" ? "Not listed" : yearState(file, y) === "not_serving" ? "Not serving" : "No report available"}</td>; })}
            </tr>)}</tbody>
          </table>
        </div>
        {assets.length === 0 && <p>No assets match this filter.</p>}
        {assets.length > limit && <button className="btn btn--paper" onClick={() => setLimit((n) => n + 20)}>Show 20 more assets</button>}
        <p className="hold__small"><a href={`/m/${memberId}/records#rec-positions`}>Every transition and CSV download</a></p>
      </>}
    </>}
    <p className="hold__small">{HOLDINGS_NOT_SHOWN.positions}</p>
  </section>;
}
