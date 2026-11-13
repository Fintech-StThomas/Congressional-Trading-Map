"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, EdgeType, NodeRef, OrgFileWire, OrgSummary } from "@/lib/types";
import type { MapGeometry } from "@/lib/geo";
import { FAMILIES, FAMILY_HINT, FAMILY_LABEL, TYPE_LABEL, inYears, sortEdges, type Family } from "@/lib/edges";
import { date, plural, seat, stateName, TERRITORIES } from "@/lib/format";
import { dataUrl, getJSON, loadSearchIndex, memberHref, orgHref, resolveTie, type BoardMember, type NameBook } from "@/lib/client";
import { decodeOrgTies, type TieEdge } from "@/lib/decode";
import { orgShard } from "@/lib/hash";
import { YEAR_MAX, YEAR_MIN } from "@/lib/site";
import { Print, PartyTag } from "../Print";
import { LineSample } from "../LineSample";
import { TieTable } from "../TieTable";
import { EvidenceDrawer } from "../EvidenceDrawer";
import { ErrorBoundary } from "../ErrorBoundary";
import { BoardCanvas, type Center } from "./BoardCanvas";
import { YearRange } from "./YearRange";
import { Legend } from "./Legend";

export type CaseLite = {
  id: string;
  member: string;
  org: string;
  orgName: string;
  types: EdgeType[];
  years: [number, number];
  money: number;
  trades: number;
};

export type Featured = { kind: "case"; c: CaseLite } | { kind: "member"; member: string } | null;

export type StateChunk = {
  strings: Record<string, Edge[]>;
  nodes: Record<string, OrgSummary>;
  members: Record<string, BoardMember>;
  /** Ties per member beyond the drawn strings. */
  more: Record<string, number>;
};

type Props = {
  geo: MapGeometry;
  states: Record<string, string[]>;
  members: Record<string, BoardMember>;
  featured: Featured;
  initialChunks: Record<string, StateChunk>;
  cases: CaseLite[];
  caseTotal: number;
  caseIndex: Record<string, string[]>;
  sources: Record<string, string>;
  asOf: string | null;
};

type Sel = { s: string | null; m: string | null; o: string | null; focus: string | null };
const EMPTY: Sel = { s: null, m: null, o: null, focus: null };
const MAX_STRINGS = 12;

function readLocation(): Sel | null {
  const q = new URLSearchParams(window.location.search);
  const sel: Sel = { s: q.get("s"), m: q.get("m"), o: q.get("o"), focus: q.get("focus") };
  return sel.s || sel.m || sel.o ? sel : null;
}

function toQuery(sel: Sel): string {
  const q = new URLSearchParams();
  if (sel.s) q.set("s", sel.s);
  if (sel.m) q.set("m", sel.m);
  if (sel.o) q.set("o", sel.o);
  if (sel.focus) q.set("focus", sel.focus);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export function BoardApp(props: Props) {
  const { geo, states, featured, cases, caseTotal, caseIndex, sources, asOf } = props;

  const featuredSel: Sel = useMemo(() => {
    if (featured?.kind === "case") {
      const m = props.members[featured.c.member];
      return { s: m?.state ?? null, m: featured.c.member, o: null, focus: featured.c.org };
    }
    if (featured?.kind === "member") return { s: props.members[featured.member]?.state ?? null, m: featured.member, o: null, focus: null };
    return EMPTY;
  }, [featured, props.members]);

  const [sel, setSel] = useState<Sel>(featuredSel);
  const [isFeatured, setIsFeatured] = useState(Boolean(featured));
  const [families, setFamilies] = useState<Set<Family>>(() => new Set<Family>(["money", "holding", "people"]));
  const [range, setRange] = useState<[number, number]>([YEAR_MIN, YEAR_MAX]);
  const [view, setView] = useState<"board" | "table">("board");
  const [panel, setPanel] = useState<"delegation" | "cases">("delegation");
  const [open, setOpen] = useState<Edge | null>(null);
  const trigger = useRef<Element | null>(null);

  const [chunks, setChunks] = useState<Record<string, StateChunk>>(props.initialChunks);
  const [memberBook, setMemberBook] = useState<Record<string, BoardMember>>(props.members);
  const [orgBook, setOrgBook] = useState<Record<string, OrgSummary>>(() => Object.assign({}, ...Object.values(props.initialChunks).map((c) => c.nodes)));
  const [orgFiles, setOrgFiles] = useState<Record<string, { org: OrgSummary; ties: TieEdge[]; total: number }>>({});
  const [memberFiles, setMemberFiles] = useState<Record<string, { edges: Edge[]; more: number }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const book: NameBook = useMemo(() => ({ members: memberBook, orgs: orgBook }), [memberBook, orgBook]);
  const counts = useMemo(() => Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.length])), [states]);
  const current = useMemo(() => new Set(Object.values(states).flat()), [states]);

  // ---- URL <-> selection -------------------------------------------------------
  const go = useCallback((next: Sel, replace = false) => {
    setSel(next);
    setIsFeatured(false);
    setOpen(null);
    const url = toQuery(next);
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  useEffect(() => {
    const sync = () => {
      const loc = readLocation();
      if (loc) {
        setSel(loc);
        setIsFeatured(false);
      } else {
        setSel(featuredSel);
        setIsFeatured(Boolean(featured));
      }
      setOpen(null);
    };
    // Deep links (/?m=…) replace the featured example on first load.
    if (readLocation()) sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("pt:locationchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("pt:locationchange", sync);
    };
  }, [featuredSel, featured]);

  // Narrow screens get the table layout by default.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 719px)");
    const apply = () => mq.matches && setView("table");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ---- data loading ----------------------------------------------------------------
  const centerMember = sel.m ? memberBook[sel.m] ?? null : null;
  const memberState = centerMember?.state ?? null;
  const viewState = sel.m ? memberState : sel.s;

  const ensureMembers = useCallback(async (ids: string[]) => {
    if (ids.every((id) => memberBook[id])) return;
    const idx = await loadSearchIndex();
    setMemberBook((prev) => {
      const next = { ...prev };
      for (const m of idx.members) if (!next[m.id]) next[m.id] = m;
      return next;
    });
  }, [memberBook]);

  useEffect(() => {
    let live = true;
    async function load() {
      setError(null);
      try {
        // A member's strings come from their state's slice of board.json.
        if (sel.m) {
          if (!memberBook[sel.m]) await ensureMembers([sel.m]);
          const st = memberBook[sel.m]?.state;
          if (st && current.has(sel.m) && !chunks[st]?.strings[sel.m]) {
            setLoading(true);
            const chunk = await getJSON<StateChunk>(`/board-data/${st}`);
            if (!live) return;
            setChunks((c) => ({
              ...c,
              [st]: {
                strings: { ...c[st]?.strings, ...chunk.strings },
                nodes: { ...c[st]?.nodes, ...chunk.nodes },
                members: { ...c[st]?.members, ...chunk.members },
                more: { ...c[st]?.more, ...chunk.more },
              },
            }));
            setOrgBook((b) => ({ ...b, ...chunk.nodes }));
            setMemberBook((b) => ({ ...chunk.members, ...b }));
          } else if (!current.has(sel.m) && memberBook[sel.m] && !memberFiles[sel.m]) {
            // Former members are not on board.json: their strings are cut from
            // the case file at build time.
            setLoading(true);
            const body = await getJSON<{ edges: Edge[]; nodes: Record<string, OrgSummary>; members: Record<string, BoardMember>; more: number }>(`/board-member/${sel.m}`);
            if (!live) return;
            setOrgBook((b) => ({ ...b, ...body.nodes }));
            setMemberBook((b) => ({ ...body.members, ...b }));
            setMemberFiles((f) => ({ ...f, [sel.m!]: { edges: body.edges, more: body.more } }));
          }
        } else if (sel.o && !orgFiles[sel.o]) {
          setLoading(true);
          const shard = await orgShard(sel.o);
          const body = await getJSON<Record<string, OrgFileWire>>(dataUrl(`orgs/${shard}.json`));
          const file = body[sel.o];
          if (!live) return;
          if (!file) throw new Error("not-found");
          const ties = decodeOrgTies(file);
          // ledger_totals counts every tie, including those past the top rows shipped.
          const totals = Object.values(file.ledger_totals ?? {}).reduce((n, t) => n + (t?.edges ?? 0), 0);
          setOrgFiles((f) => ({ ...f, [sel.o!]: { org: file.org, ties, total: Math.max(ties.length, totals) } }));
          setOrgBook((b) => ({ ...b, [file.org.id]: file.org }));
          await ensureMembers(ties.slice(0, 60).map((e) => (e.from.kind === "member" ? e.from.id : e.to.id)));
        }
      } catch (err) {
        if (live) setError(err instanceof Error && err.message === "not-found" ? "That organisation is not in this build." : "The records for this view failed to load. Check your connection and try again.");
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    return () => {
      live = false;
    };
  }, [sel.m, sel.o, memberBook, chunks, orgFiles, memberFiles, current, ensureMembers]);

  // ---- what is on the board -------------------------------------------------------
  const center: Center = useMemo(() => {
    if (sel.m && centerMember) {
      const st = centerMember.state;
      const all = current.has(sel.m) ? chunks[st]?.strings[sel.m] : memberFiles[sel.m]?.edges;
      return all ? { kind: "member", member: centerMember, total: all.length } : null;
    }
    if (sel.o && orgFiles[sel.o]) {
      const f = orgFiles[sel.o];
      return { kind: "org", org: f.org, total: f.total };
    }
    return null;
  }, [sel.m, sel.o, centerMember, chunks, memberFiles, orgFiles, current]);

  const allStrings: Edge[] = useMemo(() => {
    if (!center) return [];
    if (center.kind === "member") {
      const id = center.member.id;
      return (current.has(id) ? chunks[center.member.state]?.strings[id] : memberFiles[id]?.edges) ?? [];
    }
    return orgFiles[center.org.id]?.ties ?? [];
  }, [center, chunks, memberFiles, orgFiles, current]);

  const visible = useMemo(() => {
    const filtered = allStrings.filter((e) => families.has(e.family) && inYears(e, range));
    return center?.kind === "org" ? sortEdges(filtered).slice(0, MAX_STRINGS) : sortEdges(filtered);
  }, [allStrings, families, range, center]);

  const familyCounts = useMemo(() => {
    const c: Record<Family, number> = { money: 0, holding: 0, people: 0, context: 0 };
    for (const e of allStrings) if (inYears(e, range)) c[e.family]++;
    return c;
  }, [allStrings, range]);

  const caseNodes = useMemo(() => {
    if (!center) return new Set<string>();
    if (center.kind === "member") return new Set(caseIndex[center.member.id] ?? []);
    const s = new Set<string>();
    for (const [m, orgs] of Object.entries(caseIndex)) if (orgs.includes(center.org.id)) s.add(m);
    return s;
  }, [center, caseIndex]);

  // Ties not drawn: the rest of the member's organisations and colleagues, which
  // live in the case file (full edges and the money ledger).
  const moreTies = useMemo(() => {
    if (!center) return 0;
    if (center.kind === "org") return Math.max(0, center.total - visible.length);
    const id = center.member.id;
    if (!current.has(id)) return memberFiles[id]?.more ?? 0;
    return chunks[center.member.state]?.more?.[id] ?? 0;
  }, [center, visible.length, current, memberFiles, chunks]);

  const drawKey = `${center?.kind ?? "none"}-${center ? (center.kind === "member" ? center.member.id : center.org.id) : ""}`;
  const selfId = center?.kind === "member" ? center.member.id : center?.kind === "org" ? center.org.id : "";

  const [resolving, setResolving] = useState(false);
  const openEdge = useCallback((e: Edge, el: Element) => {
    trigger.current = el;
    setOpen(e);
    const tie = (e as TieEdge)._tie;
    if (tie?.edge) {
      // Org ties carry no evidence; the full record is in the member's file.
      setResolving(true);
      resolveTie(e as TieEdge)
        .then((full) => setOpen((cur) => (cur?.id === e.id ? full : cur)))
        .catch(() => undefined)
        .finally(() => setResolving(false));
    }
  }, []);
  const closeEdge = useCallback(() => {
    setOpen(null);
    const t = trigger.current as HTMLElement | SVGElement | null;
    t?.focus?.();
  }, []);

  const recenter = useCallback(
    (n: NodeRef) => {
      if (n.kind === "member") go({ s: memberBook[n.id]?.state ?? null, m: n.id, o: null, focus: null });
      else go({ s: null, m: null, o: n.id, focus: null });
    },
    [go, memberBook],
  );

  const selectState = useCallback((code: string) => go({ s: code, m: null, o: null, focus: null }), [go]);

  // ---- slip: what the board is showing -------------------------------------------
  const featuredCase = isFeatured && featured?.kind === "case" ? featured.c : null;
  const slip = (
    <Slip
      sel={sel}
      center={center}
      featuredCase={featuredCase}
      featuredMember={isFeatured && featured?.kind === "member"}
      asOf={asOf}
      shown={visible.length}
      more={moreTies}
      onClear={() => go(EMPTY)}
      onState={(s) => go({ ...EMPTY, s })}
    />
  );

  const delegation = viewState ? (states[viewState] ?? []).map((id) => memberBook[id]).filter(Boolean) : [];

  return (
    <div className={`board view-${view}`} data-view={view}>
      <div className="board__toolbar">
        <nav className="crumbs" aria-label="Board position">
          <button type="button" className="crumb" onClick={() => go(EMPTY)} aria-current={!sel.s && !sel.m && !sel.o ? "true" : undefined}>
            United States
          </button>
          {viewState && (
            <>
              <Sep />
              <button type="button" className="crumb" onClick={() => go({ ...EMPTY, s: viewState })} aria-current={sel.s && !sel.m ? "true" : undefined}>
                {stateName(viewState)}
              </button>
            </>
          )}
          {centerMember && (
            <>
              <Sep />
              <span className="crumb is-current" aria-current="true">{centerMember.name}</span>
            </>
          )}
          {sel.o && !sel.m && (
            <>
              <Sep />
              <span className="crumb is-current" aria-current="true">{orgBook[sel.o]?.name ?? "Organisation"}</span>
            </>
          )}
        </nav>
        <label className="statepick">
          <span className="visually-hidden">Choose a state</span>
          <select value={viewState ?? ""} onChange={(e) => (e.target.value ? selectState(e.target.value) : go(EMPTY))}>
            <option value="">Choose a state…</option>
            {Object.keys(states)
              .sort((a, b) => stateName(a).localeCompare(stateName(b)))
              .map((st) => (
                <option key={st} value={st}>
                  {stateName(st)} ({states[st].length})
                </option>
              ))}
          </select>
        </label>
        <div className="board__controls">
          <div className="chips" role="group" aria-label="Kinds of string to show">
            {FAMILIES.map((f) => {
              const on = families.has(f);
              return (
                <button
                  key={f}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  title={FAMILY_HINT[f]}
                  onClick={() =>
                    setFamilies((prev) => {
                      const next = new Set(prev);
                      if (next.has(f)) next.delete(f);
                      else next.add(f);
                      return next;
                    })
                  }
                >
                  <LineSample style={f === "context" ? "context" : "filed"} width={18} />
                  {FAMILY_LABEL[f]}
                  {center && <span className="mono chip__n">{familyCounts[f]}</span>}
                </button>
              );
            })}
          </div>
          <YearRange value={range} onChange={setRange} />
          <button type="button" className="btn viewtoggle" aria-pressed={view === "table"} onClick={() => setView((v) => (v === "board" ? "table" : "board"))}>
            {view === "board" ? "View as table" : "View as board"}
          </button>
        </div>
      </div>

      <div className="board__main">
        <div className="board__stage">
          {error && (
            <p className="board__error" role="alert">
              {error}
            </p>
          )}
          <ErrorBoundary label="board">
            <div className="stage__board">
              <BoardCanvas
                geo={geo}
                counts={counts}
                selectedState={viewState}
                onSelectState={selectState}
                center={center}
                edges={visible}
                book={book}
                caseNodes={caseNodes}
                focusNode={sel.focus}
                drawKey={drawKey}
                range={range}
                activeEdge={open?.id ?? null}
                onOpenEdge={openEdge}
                onRecenter={recenter}
                slip={slip}
                loading={loading}
              />
            </div>
          </ErrorBoundary>
          <div className="stage__table">
            <div className="tableslip">{slip}</div>
            <ErrorBoundary label="table">
              {center ? (
                <TieTable
                  edges={visible}
                  selfId={selfId}
                  book={book}
                  range={range}
                  onOpen={openEdge}
                  activeId={open?.id}
                  caption="Strings on the board"
                  caseEdges={new Set(visible.filter((e) => caseNodes.has(e.from.id) || caseNodes.has(e.to.id)).map((e) => e.id))}
                  groupBy="family"
                  emptyText={loading ? "Pulling the records…" : "No strings match the current filters. Turn on more families or widen the years."}
                />
              ) : viewState ? (
                <p className="empty">Choose a member of the {stateName(viewState)} delegation to list their ties.</p>
              ) : (
                <StateTable states={states} onPick={selectState} />
              )}
            </ErrorBoundary>
          </div>
          <Legend />
        </div>

        <aside className="board__side" aria-label="Delegation and cases">
          <div className="tabs" role="tablist" aria-label="Side panel">
            <button type="button" role="tab" id="tab-del" aria-selected={panel === "delegation"} aria-controls="panel-del" onClick={() => setPanel("delegation")}>
              Delegation
            </button>
            <button type="button" role="tab" id="tab-cases" aria-selected={panel === "cases"} aria-controls="panel-cases" onClick={() => setPanel("cases")}>
              Open cases <span className="mono">{caseTotal}</span>
            </button>
          </div>
          <div id="panel-del" role="tabpanel" aria-labelledby="tab-del" hidden={panel !== "delegation"} className="side__panel">
            {sel.o && !sel.m && center?.kind === "org" ? (
              <OrgSide org={center.org} total={center.total} shown={visible.length} />
            ) : viewState ? (
              <Delegation st={viewState} members={delegation} selected={sel.m} onPick={(id) => go({ ...EMPTY, s: viewState, m: id })} />
            ) : (
              <StateList states={states} onPick={selectState} />
            )}
          </div>
          <div id="panel-cases" role="tabpanel" aria-labelledby="tab-cases" hidden={panel !== "cases"} className="side__panel">
            <CaseList cases={cases} total={caseTotal} book={book} onOpen={(c) => go({ s: memberBook[c.member]?.state ?? null, m: c.member, o: null, focus: c.org })} />
          </div>
        </aside>
      </div>

      <EvidenceDrawer edge={open} book={book} sources={sources} range={range} onClose={closeEdge} loading={resolving} />
    </div>
  );
}

function Sep() {
  return (
    <svg className="crumbs__sep" viewBox="0 0 8 12" width="7" height="11" aria-hidden="true">
      <path d="M2 1l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function Slip({
  sel, center, featuredCase, featuredMember, asOf, shown, more, onClear, onState,
}: {
  sel: Sel; center: Center; featuredCase: CaseLite | null; featuredMember: boolean; asOf: string | null; shown: number; more: number;
  onClear: () => void; onState: (s: string) => void;
}) {
  if (center?.kind === "member") {
    const m = center.member;
    return (
      <div className="slip">
        {(featuredCase || featuredMember) && (
          <p className="slip__kicker">
            <span className="stamp-label">Featured example</span>
            {asOf && <span className="mono">as of {date(asOf)}</span>}
          </p>
        )}
        <h2 className="slip__title">
          {m.name} <PartyTag party={m.party} />
        </h2>
        <p className="slip__sub">{seat(m)}</p>
        {featuredCase && <CaseSentence c={featuredCase} />}
        <p className="slip__meta">
          <span className="mono">{shown}</span> {shown === 1 ? "string" : "strings"}
          {more > 0 && (
            <>
              , plus <span className="mono">{more.toLocaleString("en-US")}</span> more {more === 1 ? "tie" : "ties"} in the full list
            </>
          )}{" "}
          · <Link href={memberHref(m.id)}>Open case file</Link>
          {featuredCase || featuredMember ? (
            <>
              {" · "}
              <button type="button" className="linkbtn" onClick={() => onState(m.state)}>
                Browse {stateName(m.state)}
              </button>
            </>
          ) : null}
        </p>
      </div>
    );
  }
  if (center?.kind === "org") {
    const o = center.org;
    return (
      <div className="slip">
        <h2 className="slip__title">{o.name}</h2>
        <p className="slip__sub">
          Tied to {plural(o.degree, "member")}. The {shown} largest {shown === 1 ? "tie is" : "ties are"} drawn
          {more > 0 ? `, plus ${more.toLocaleString("en-US")} more in the full list` : ""}.
        </p>
        <p className="slip__meta">
          <Link href={orgHref(o.id)}>Every tie to {o.name}</Link> ·{" "}
          <button type="button" className="linkbtn" onClick={onClear}>
            Back to the map
          </button>
        </p>
      </div>
    );
  }
  if (sel.s) {
    return (
      <div className="slip">
        <h2 className="slip__title">{stateName(sel.s)}</h2>
        <p className="slip__sub">Pick a member from the delegation to pull their strings.</p>
      </div>
    );
  }
  if (sel.m || sel.o) {
    return (
      <div className="slip">
        <p className="slip__sub">Pulling the records…</p>
      </div>
    );
  }
  return (
    <div className="slip">
      <h2 className="slip__title">Pick a state</h2>
      <p className="slip__sub">
        Each number is the state&rsquo;s current delegation. Pick a state, then a member, to see who they are tied to and the filings behind each tie.
      </p>
    </div>
  );
}

/** A case, described exactly as the rule defines it. */
export function CaseSentence({ c }: { c: CaseLite }) {
  const traded = c.types.includes("traded");
  const pac = c.types.includes("pac_money");
  const yrs = c.years[0] === c.years[1] ? `in ${c.years[0]}` : `in ${c.years[0]}–${c.years[1]}`;
  if (traded && pac)
    return (
      <p className="slip__case">
        The household traded <b>{c.orgName}</b> stock{c.trades ? ` (${c.trades.toLocaleString("en-US")} ${c.trades === 1 ? "trade" : "trades"})` : ""} {yrs}, and its PAC gave the member money in that period
        {c.money ? ` ($${Math.round(c.money).toLocaleString("en-US")} across all years on record)` : ""}.
      </p>
    );
  return (
    <p className="slip__case">
      Tied to <b>{c.orgName}</b> by {c.types.map((t) => TYPE_LABEL[t].toLowerCase()).join(" and ")} {yrs}.
    </p>
  );
}

function Delegation({ st, members, selected, onPick }: { st: string; members: BoardMember[]; selected: string | null; onPick: (id: string) => void }) {
  const sens = members.filter((m) => m.chamber === "sen");
  const reps = members.filter((m) => m.chamber === "rep");
  return (
    <div className="delegation" data-testid="delegation">
      <h2 className="side__h">
        {stateName(st)} <span className="mono">{members.length}</span>
      </h2>
      {sens.length > 0 && (
        <>
          <h3 className="side__sub">Senate</h3>
          <ul className="senators">
            {sens.map((m) => (
              <li key={m.id}>
                <button type="button" className={`pick pick--sen${selected === m.id ? " is-selected" : ""}`} aria-pressed={selected === m.id} onClick={() => onPick(m.id)} data-member={m.id}>
                  <Print id={m.id} name={m.name} photo={m.photo} size="lg" />
                  <span className="pick__name">{m.name}</span>
                  <span className="pick__meta">
                    <PartyTag party={m.party} /> Senator
                    {m.cases > 0 && <span className="tag tag--inline">{m.cases === 1 ? "Case" : `${m.cases} cases`}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {reps.length > 0 && (
        <>
          <h3 className="side__sub">
            House <span className="mono">{reps.length}</span>
          </h3>
          <ul className="reps">
            {reps.map((m) => (
              <li key={m.id}>
                <button type="button" className={`pick pick--rep${selected === m.id ? " is-selected" : ""}`} aria-pressed={selected === m.id} onClick={() => onPick(m.id)} data-member={m.id}>
                  <Print id={m.id} name={m.name} photo={m.photo} size="sm" />
                  <span className="pick__text">
                    <span className="pick__name">{m.name}</span>
                    <span className="pick__meta">
                      <PartyTag party={m.party} /> {seat(m, false).replace("Rep. · ", "")}
                      {m.cases > 0 && <span className="tag tag--inline">Case</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StateList({ states, onPick }: { states: Record<string, string[]>; onPick: (s: string) => void }) {
  const list = Object.keys(states).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  return (
    <div>
      <h2 className="side__h">States</h2>
      <p className="side__note">Every state and territory with a current member. The map works the same way.</p>
      <ul className="statelist">
        {list.map((s) => (
          <li key={s}>
            <button type="button" className="statebtn" onClick={() => onPick(s)}>
              <span>{stateName(s)}</span>
              <span className="mono">{states[s].length}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateTable({ states, onPick }: { states: Record<string, string[]>; onPick: (s: string) => void }) {
  const list = Object.keys(states).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  const territories = list.filter((s) => TERRITORIES.includes(s));
  return (
    <div className="tablewrap">
      <table className="ties">
        <caption className="visually-hidden">States and their current delegations</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col" className="num">Members</th>
            <th scope="col"><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s}>
              <td data-label="State">
                {stateName(s)}
                {territories.includes(s) && <span className="ties__sub"> territory</span>}
              </td>
              <td data-label="Members" className="num mono">{states[s].length}</td>
              <td className="ties__act">
                <button type="button" className="btn btn--small" onClick={() => onPick(s)}>
                  Delegation
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgSide({ org, total, shown }: { org: OrgSummary; total: number; shown: number }) {
  return (
    <div>
      <h2 className="side__h">{org.name}</h2>
      <dl className="facts facts--side">
        <div>
          <dt>Kind</dt>
          <dd>{org.kind.replace("_", " ")}</dd>
        </div>
        {org.ticker && (
          <div>
            <dt>Ticker</dt>
            <dd className="mono">{org.ticker}</dd>
          </div>
        )}
        {org.sector && (
          <div>
            <dt>Sector</dt>
            <dd>{org.sector}</dd>
          </div>
        )}
        <div>
          <dt>Members tied</dt>
          <dd className="mono">{org.degree}</dd>
        </div>
      </dl>
      <p className="side__note">
        The board shows the {shown} largest of {total} ties. <Link href={orgHref(org.id)}>See every tie</Link>.
      </p>
    </div>
  );
}

function CaseList({ cases, total, book, onOpen }: { cases: CaseLite[]; total: number; book: NameBook; onOpen: (c: CaseLite) => void }) {
  if (!cases.length) return <p className="side__note">No member and organisation pair has three or more kinds of filed tie in this build.</p>;
  return (
    <div>
      <h2 className="side__h">Open cases</h2>
      <p className="side__note">
        A case is a member whose household traded a company&rsquo;s stock and who received money from that company&rsquo;s PAC in the same years. It is a reason to read the filings, not a finding.
      </p>
      <ol className="caselist">
        {cases.map((c) => {
          const m = book.members[c.member];
          return (
            <li key={c.id}>
              <button type="button" className="casebtn" onClick={() => onOpen(c)}>
                <span className="casebtn__who">
                  {m?.name ?? c.member} {m && <PartyTag party={m.party} />}
                </span>
                <span className="casebtn__org">{c.orgName}</span>
                <span className="casebtn__meta mono">
                  {c.trades ? `${c.trades} trades · ` : ""}
                  {c.money ? `$${Math.round(c.money).toLocaleString("en-US")} PAC · ` : ""}
                  {c.years[0]}–{c.years[1]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="side__note">
        <Link href="/cases">All {total} cases, ranked</Link>
      </p>
    </div>
  );
}
