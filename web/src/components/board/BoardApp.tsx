"use client";
// The board (home page): owns the selection (state, member or organisation, mirrored in the URL),
// loads each view's strings on demand, applies the family / year / assumption filters, and lays out
// the canvas, the table view, the side panel and the evidence drawer.
// Data in: the props built by app/page.tsx; then /board-data/<state>, /board-member/<id> and org shards.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, NodeRef } from "@/lib/types";
import type { MapGeometry } from "@/lib/board/geo";
import { inYears, sortEdges, type Family } from "@/lib/domain/edges";
import { stateName } from "@/lib/format";
import { resolveTie } from "@/lib/data/fetch";
import type { BoardMember } from "@/lib/domain/names";
import type { TieEdge } from "@/lib/data/decode";
import { YEAR_MAX, YEAR_MIN } from "@/lib/years";
import { AGAINST_SHOWN, isAgainst } from "@/lib/domain/pick";
import { TieTable } from "@/components/shared/TieTable";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { AssumptionBar, useAssumptions } from "@/components/shared/Assume";
import { BoardCanvas, type Center } from "./BoardCanvas";
import { Toolbar } from "./Toolbar";
import { Legend } from "./Legend";
import { AgainstZone } from "./AgainstZone";
import { Slip } from "./Slip";
import { CaseList, Delegation, OrgSide, StateList } from "./SidePanel";
import { StateTable } from "./StateTable";
import { useBoardData } from "./useBoardData";
import { EMPTY, type CaseLite, type Featured, type Sel, type StateChunk } from "./types";

export type { CaseLite, Featured, StateChunk } from "./types";

type Props = {
  geo: MapGeometry;
  states: Record<string, string[]>;
  members: Record<string, BoardMember>;
  featured: Featured;
  initialChunks: Record<string, StateChunk>;
  cases: CaseLite[];
  caseTotal: number;
  /** The Case rule's minimum number of tie types (meta.json), for the wording of the cases list. */
  caseMinTypes: number;
  caseIndex: Record<string, string[]>;
  sources: Record<string, string>;
  asOf: string | null;
};

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
  // Assumption switches travel with every board URL.
  const as = new URLSearchParams(window.location.search).get("as");
  if (as) q.set("as", as);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export function BoardApp(props: Props) {
  const { geo, states, featured, cases, caseTotal, caseMinTypes, caseIndex, sources, asOf } = props;

  const [featIdx, setFeatIdx] = useState(0);
  const featPick = featured?.picks[featIdx] ?? null;
  const featuredSel: Sel = useMemo(() => {
    if (featPick) return { s: props.members[featPick.member]?.state ?? null, m: featPick.member, o: null, focus: null };
    return EMPTY;
  }, [featPick, props.members]);

  const [sel, setSel] = useState<Sel>(featuredSel);
  const [isFeatured, setIsFeatured] = useState(Boolean(featured));
  const [families, setFamilies] = useState<Set<Family>>(() => new Set<Family>(["money", "holding", "people"]));
  const [range, setRange] = useState<[number, number]>([YEAR_MIN, YEAR_MAX]);
  const [view, setView] = useState<"board" | "table">("board");
  const [panel, setPanel] = useState<"delegation" | "cases">("delegation");
  const [open, setOpen] = useState<Edge | null>(null);
  const [openGroup, setOpenGroup] = useState<Edge[] | null>(null);
  const trigger = useRef<Element | null>(null);

  const counts = useMemo(() => Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.length])), [states]);
  const current = useMemo(() => new Set(Object.values(states).flat()), [states]);
  const { chunks, memberBook, orgBook, orgFiles, memberFiles, loading, error, book } = useBoardData(sel, props.initialChunks, props.members, current);

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

  // Spending against (member board) or outside spending of unrecorded side (org board) is never yarn.
  const inZone = useCallback(
    (e: Edge) => (center?.kind === "org" ? e.type === "outside_spending" && e.note !== "support" : isAgainst(e)),
    [center?.kind],
  );
  const zoneAll = useMemo(() => sortEdges(allStrings.filter(inZone)), [allStrings, inZone]);
  const zoneMore = useMemo(() => {
    if (!center) return 0;
    if (center.kind === "org") return Math.max(0, zoneAll.length - AGAINST_SHOWN);
    const id = center.member.id;
    return (current.has(id) ? chunks[center.member.state]?.againstMore?.[id] : memberFiles[id]?.againstMore) ?? 0;
  }, [center, zoneAll.length, current, chunks, memberFiles]);

  const visible = useMemo(() => {
    const filtered = allStrings.filter((e) => !inZone(e) && families.has(e.family) && inYears(e, range));
    return center?.kind === "org" ? sortEdges(filtered).slice(0, MAX_STRINGS) : sortEdges(filtered);
  }, [allStrings, families, range, center, inZone]);

  // Assumption switches (owner, asset class, size, lateness) for a member's board.
  const assumeMember = center?.kind === "member" ? center.member.id : null;
  const assumeEdges = useMemo(() => (assumeMember ? allStrings.filter((e) => e.type === "traded") : []), [assumeMember, allStrings]);
  const assumeCases = useMemo(() => (assumeMember ? caseIndex[assumeMember] ?? [] : []), [assumeMember, caseIndex]);
  const assumption = useAssumptions(assumeMember, true, assumeEdges, assumeCases);
  const excluded = assumption.effect?.excluded;

  const familyCounts = useMemo(() => {
    const c: Record<Family, number> = { money: 0, holding: 0, people: 0, context: 0 };
    for (const e of allStrings) if (inYears(e, range) && !excluded?.has(e.id) && !inZone(e)) c[e.family]++;
    return c;
  }, [allStrings, range, excluded, inZone]);

  const caseNodes = useMemo(() => {
    if (!center) return new Set<string>();
    if (center.kind === "member") return assumption.effect ? new Set(assumption.effect.cases) : new Set(caseIndex[center.member.id] ?? []);
    const s = new Set<string>();
    for (const [m, orgs] of Object.entries(caseIndex)) if (orgs.includes(center.org.id)) s.add(m);
    return s;
  }, [center, caseIndex, assumption.effect]);

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
  const showEdge = useCallback((e: Edge) => {
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
  const openEdge = useCallback(
    (e: Edge, el: Element, group?: Edge[]) => {
      trigger.current = el;
      setOpenGroup(group && group.length > 1 ? group : null);
      showEdge(e);
    },
    [showEdge],
  );
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
  const nextFeatured = featured && featured.picks.length > 1
    ? () => {
        const i = (featIdx + 1) % featured.picks.length;
        const m = featured.picks[i].member;
        setFeatIdx(i);
        setSel({ s: memberBook[m]?.state ?? null, m, o: null, focus: null });
        setIsFeatured(true);
        setOpen(null);
      }
    : null;
  const slip = (
    <Slip
      sel={sel}
      center={center}
      featured={isFeatured && featured && featPick && featPick.member === sel.m ? { ...featPick, n: featIdx + 1, of: featured.picks.length } : null}
      onNextFeatured={nextFeatured}
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
      <Toolbar
        sel={sel}
        viewState={viewState}
        memberName={centerMember?.name ?? null}
        orgName={sel.o ? orgBook[sel.o]?.name ?? null : null}
        states={states}
        families={families}
        familyCounts={center ? familyCounts : null}
        range={range}
        view={view}
        go={go}
        selectState={selectState}
        onToggleFamily={(f) =>
          setFamilies((prev) => {
            const next = new Set(prev);
            if (next.has(f)) next.delete(f);
            else next.add(f);
            return next;
          })
        }
        onRange={setRange}
        onToggleView={() => setView((v) => (v === "board" ? "table" : "board"))}
      />

      <div className="board__main">
        {center?.kind === "member" && (
          <div className="board__assume">
            <AssumptionBar state={assumption} scope={center.member.name} />
          </div>
        )}
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
                excluded={excluded}
                focusNode={sel.focus}
                drawKey={drawKey}
                range={range}
                activeEdge={open?.id ?? null}
                onOpenEdge={openEdge}
                onRecenter={recenter}
                slip={slip}
                loading={loading}
              />
              {center && (
                <AgainstZone
                  edges={zoneAll.slice(0, AGAINST_SHOWN)}
                  more={zoneMore}
                  selfId={selfId}
                  book={book}
                  title={center.kind === "member" ? "Spent against this member" : "Outside spending on members (side not recorded in this file)"}
                  line={center.kind === "member" ? "Independent spending by groups opposing this member. Not a relationship with the member." : "Independent spending for or against members. Not a relationship with them; open a card for the record."}
                  onOpen={(e, el) => openEdge(e, el)}
                  onRecenter={recenter}
                />
              )}
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
                  excluded={excluded}
                  caseEdges={new Set(visible.filter((e) => caseNodes.has(e.from.id) || caseNodes.has(e.to.id)).map((e) => e.id))}
                  groupBy="family"
                  emptyText={loading ? "Pulling the records…" : "No strings match the current filters. Turn on more families or widen the years."}
                />
              ) : null}
              {center && zoneAll.length > 0 ? (
                <div className="tablezone">
                  <h3>{center.kind === "member" ? "Spent against this member" : "Outside spending, side not recorded"}</h3>
                  <p className="section__note">Independent spending{center.kind === "member" ? " by groups opposing this member" : ""}. Not a relationship.</p>
                  <TieTable edges={zoneAll} selfId={selfId} book={book} range={range} onOpen={openEdge} activeId={open?.id} caption="Spent against" />
                </div>
              ) : center ? null : viewState ? (
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
            <CaseList cases={cases} total={caseTotal} minTypes={caseMinTypes} book={book} onOpen={(c) => go({ s: memberBook[c.member]?.state ?? null, m: c.member, o: null, focus: c.org })} />
          </div>
        </aside>
      </div>

      <EvidenceDrawer edge={open} book={book} sources={sources} range={range} onClose={closeEdge} loading={resolving} siblings={openGroup ?? undefined} onPick={showEdge} />
    </div>
  );
}
