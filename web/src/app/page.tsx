import { getBoard, getCases, getMemberIndex, getMeta, getOrgIndex, metaBuilt } from "@/lib/data";
import { getMapGeometry } from "@/lib/geo";
import { sourceNames } from "@/lib/meta";
import { toBoardMember, type BoardMember } from "@/lib/client";
import type { OrgSummary } from "@/lib/types";
import { BoardApp, type CaseLite, type Featured, type StateChunk } from "@/components/board/BoardApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function BoardPage() {
  const board = getBoard();
  const members = getMemberIndex();
  const orgs = getOrgIndex();
  const meta = getMeta();
  const allCases = getCases();
  const current = new Set(Object.values(board.states).flat());

  // Names the board can show without another request: every current member,
  // plus any former member a current member's strings point at.
  const book: Record<string, BoardMember> = {};
  for (const id of current) {
    const m = members.get(id);
    if (m) book[id] = toBoardMember(m);
  }
  for (const list of Object.values(board.strings))
    for (const e of list)
      for (const n of [e.from, e.to]) if (n.kind === "member" && !book[n.id]) {
        const m = members.get(n.id);
        if (m) book[n.id] = toBoardMember(m);
      }

  const orgName = (id: string) => orgs.get(id)?.name ?? board.nodes[id]?.name ?? id;
  const lite = (c: (typeof allCases)[number]): CaseLite => ({ id: c.id, member: c.member, org: c.org, orgName: orgName(c.org), types: c.types, years: c.years });

  // Featured example: the strongest case whose member is on the board, else
  // the current member with the most strings.
  const top = allCases.find((c) => current.has(c.member) && book[c.member]);
  let featured: Featured = null;
  if (top) featured = { kind: "case", c: lite(top) };
  else {
    let best: string | null = null;
    for (const id of current) if (!best || (board.strings[id]?.length ?? 0) > (board.strings[best]?.length ?? 0)) best = id;
    if (best) featured = { kind: "member", member: best };
  }

  const initialChunks: Record<string, StateChunk> = {};
  const fm = featured ? (featured.kind === "case" ? featured.c.member : featured.member) : null;
  if (fm && book[fm]) {
    const st = book[fm].state;
    const strings: StateChunk["strings"] = {};
    const nodes: Record<string, OrgSummary> = {};
    // Ship only the featured member's strings with the page; the rest of the
    // state arrives when someone asks for it.
    strings[fm] = board.strings[fm] ?? [];
    for (const e of strings[fm]) for (const n of [e.from, e.to]) if (n.kind === "org" && board.nodes[n.id]) nodes[n.id] = board.nodes[n.id];
    initialChunks[st] = { strings, nodes };
    // Mark the chunk partial by leaving other members out: BoardApp refetches
    // the state when another member of it is picked.
  }

  const caseIndex: Record<string, string[]> = {};
  for (const c of allCases) if (current.has(c.member)) (caseIndex[c.member] ??= []).push(c.org);

  return (
    <div className="page page--board">
      <h1 className="visually-hidden">The board: members of Congress and the organisations tied to them</h1>
      <ErrorBoundary label="board">
        <BoardApp
          geo={getMapGeometry()}
          states={board.states}
          members={book}
          featured={featured}
          initialChunks={initialChunks}
          cases={allCases.filter((c) => book[c.member]).slice(0, 40).map(lite)}
          caseTotal={allCases.length}
          caseIndex={caseIndex}
          sources={sourceNames(meta)}
          asOf={metaBuilt(meta)}
        />
      </ErrorBoundary>
    </div>
  );
}
