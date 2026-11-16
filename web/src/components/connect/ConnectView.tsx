"use client";
// /connect: pick two members or organisations and list the published ties that join them in up to three steps.
// The page is one static shell; everything is read in the browser. The address holds the query (shareable):
// /connect?a=<id>&b=<id>&h=2&d=1&hub=1. Search rules live in lib/domain/paths.ts, reading in load.ts.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Edge, OrgSummary } from "@/lib/types";
import { CONNECT } from "@/lib/copy";
import { loadSearchIndex, type SearchIndex } from "@/lib/data/fetch";
import { isMemberId, isOrgId } from "@/lib/data/ids";
import { DEFAULT_HOPS, HUB_DEGREE, MAX_HOPS, type Hop } from "@/lib/domain/paths";
import { edgeFromHop } from "@/lib/domain/pathhops";
import type { NameBook } from "@/lib/domain/names";
import { connectHref } from "@/lib/urls";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { NodePicker } from "./NodePicker";
import { PathCard } from "./PathCard";
import { EmptyResult, IncompleteNote, RankingNote, Searched } from "./ConnectNotes";
import { resolveHop } from "./load";
import { useConnect } from "./useConnect";
import "@/styles/connect.css";

type Query = { a: string | null; b: string | null; hops: number; derived: boolean; hubs: boolean; bad: boolean };

const valid = (id: string | null) => id === null || isMemberId(id) || isOrgId(id);

function parse(search: string): Query {
  const q = new URLSearchParams(search);
  const a = q.get("a") || null;
  const b = q.get("b") || null;
  const h = Number(q.get("h"));
  return {
    a: valid(a) ? a : null,
    b: valid(b) ? b : null,
    hops: Number.isInteger(h) && h >= 1 && h <= MAX_HOPS ? h : DEFAULT_HOPS,
    derived: q.get("d") === "1",
    hubs: q.get("hub") === "1",
    bad: !valid(a) || !valid(b),
  };
}

const CHANGED = "pt:connect-query";
function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(CHANGED, cb);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";

export function ConnectView({ sources }: { sources: Record<string, string> }) {
  // The address is the state: the static shell renders with no query, then follows the browser's address.
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const q = useMemo(() => parse(search), [search]);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  const [open, setOpen] = useState<{ hop: Hop; edge: Edge } | null>(null);
  const [resolving, setResolving] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const loadIndex = useCallback(() => {
    if (index || indexFailed) return;
    loadSearchIndex().then(setIndex, () => setIndexFailed(true));
  }, [index, indexFailed]);
  useEffect(() => {
    if (q.a || q.b) loadIndex();
  }, [q.a, q.b, loadIndex]);

  const update = (next: Partial<Query>) => {
    const n = { ...q, ...next, bad: false };
    window.history.replaceState(null, "", connectHref({ a: n.a, b: n.b, hops: n.hops, derived: n.derived, hubs: n.hubs }));
    window.dispatchEvent(new Event(CHANGED));
    setOpen(null);
  };

  const same = Boolean(q.a && q.a === q.b);
  const state = useConnect(!q.bad ? q.a : null, !q.bad ? q.b : null, { maxHops: q.hops, includeDerived: q.derived, expandHubs: q.hubs });
  const names = useMemo(() => (state.status === "ok" ? state.outcome.names : {}), [state]);
  const nameFor = (id: string | null) => (id ? index?.members.find((m) => m.id === id)?.name ?? index?.orgs.find((o) => o.id === id)?.name ?? names[id]?.name ?? null : null);

  const book: NameBook = useMemo(() => {
    const orgs: Record<string, OrgSummary> = {};
    for (const [id, n] of Object.entries(names)) if (n.kind === "org") orgs[id] = { id, name: n.name } as OrgSummary;
    return { members: Object.fromEntries((index?.members ?? []).map((m) => [m.id, m])), orgs };
  }, [names, index]);

  const openHop = useCallback((hop: Hop, el: HTMLElement) => {
    trigger.current = el;
    setOpen({ hop, edge: edgeFromHop(hop) });
    if (hop.edge && hop.file) {
      setResolving(true);
      resolveHop(hop)
        .then((edge) => setOpen((cur) => (cur?.hop.key === hop.key ? { hop, edge } : cur)))
        .finally(() => setResolving(false));
    }
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    trigger.current?.focus();
  }, []);

  const result = state.status === "ok" ? state.outcome.result : null;
  const ends = q.a && q.b ? `${nameFor(q.a) ?? q.a} and ${nameFor(q.b) ?? q.b}` : "";

  return (
    <article className="page page--narrow connect" data-testid="connect-page">
      <h1>{CONNECT.title}</h1>
      <p className="lede">{CONNECT.intro}</p>
      <IncompleteNote />

      <form className="cform no-print" onSubmit={(e) => e.preventDefault()} aria-label={CONNECT.title}>
        <div className="cform__ends">
          <NodePicker label={CONNECT.labels.a} value={q.a} name={nameFor(q.a)} index={index} indexFailed={indexFailed} onFocus={loadIndex} onChange={(id) => update({ a: id })} />
          <button type="button" className="btn btn--small cform__swap" onClick={() => update({ a: q.b, b: q.a })} disabled={!q.a && !q.b}>
            {CONNECT.labels.swap}
          </button>
          <NodePicker label={CONNECT.labels.b} value={q.b} name={nameFor(q.b)} index={index} indexFailed={indexFailed} onFocus={loadIndex} onChange={(id) => update({ b: id })} />
        </div>
        <fieldset className="cform__opts">
          <legend>{CONNECT.labels.options}</legend>
          <label className="cform__opt">
            <span>{CONNECT.labels.hops}</span>
            <select value={q.hops} onChange={(e) => update({ hops: Number(e.target.value) })}>
              {CONNECT.hopsOptions.map((t, i) => (
                <option key={t} value={i + 1}>{t}</option>
              ))}
            </select>
          </label>
          <label className="cform__opt cform__opt--check">
            <input type="checkbox" checked={q.derived} onChange={(e) => update({ derived: e.target.checked })} />
            <span>{CONNECT.labels.derived}<small>{CONNECT.optionHints.derived}</small></span>
          </label>
          <label className="cform__opt cform__opt--check">
            <input type="checkbox" checked={q.hubs} onChange={(e) => update({ hubs: e.target.checked })} />
            <span>{CONNECT.labels.hubs}<small>{CONNECT.optionHints.hubs(HUB_DEGREE)}</small></span>
          </label>
        </fieldset>
      </form>

      <div className="cresults" aria-live="polite" aria-busy={state.status === "loading"}>
        {q.bad && <p className="empty">{CONNECT.badId}</p>}
        {!q.bad && !(q.a && q.b) && <p className="empty">{CONNECT.needTwo}</p>}
        {!q.bad && same && <p className="empty">{CONNECT.same}</p>}
        {state.status === "loading" && <p className="cresults__status" role="status">{CONNECT.loading}</p>}
        {state.status === "error" && <p className="empty" role="alert">{CONNECT.loadError}</p>}
        {state.status === "missing" && <p className="empty" role="alert">{CONNECT.notFound(state.id)}</p>}
        {state.status === "ok" && result && (
          <>
            {result.paths.length === 0 ? (
              <EmptyResult maxHops={result.maxHops} />
            ) : (
              <>
                <p className="cresults__count mono" data-testid="path-count">{CONNECT.found(result.paths.length, result.total)}</p>
                <ol className="cpaths">
                  {result.paths.map((p, i) => (
                    <PathCard key={p.id} path={p} index={i} names={state.outcome.names} onEvidence={openHop} activeKey={open?.hop.key ?? null} />
                  ))}
                </ol>
                {result.more > 0 && <p className="cresults__more">{CONNECT.more(result.more)}</p>}
              </>
            )}
            <Searched outcome={state.outcome} ends={ends} maxHops={result.maxHops} />
            <RankingNote />
          </>
        )}
      </div>
      <EvidenceDrawer edge={open?.edge ?? null} book={book} sources={sources} onClose={close} loading={resolving} />
    </article>
  );
}
