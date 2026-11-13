import { getBoard, getCases, getMemberIndex, getMeta, getOrgIndex, memberBoard, metaBuilt } from "@/lib/data";
import { getMapGeometry } from "@/lib/geo";
import { sourceNames } from "@/lib/meta";
import { toBoardMember, type BoardMember } from "@/lib/client";
import { BoardApp, type CaseLite, type Featured, type StateChunk } from "@/components/board/BoardApp";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { featuredReason, rankFeatured } from "@/lib/featured";

export default function BoardPage() {
  const board = getBoard();
  const members = getMemberIndex();
  const orgs = getOrgIndex();
  const meta = getMeta();
  const allCases = getCases();
  const current = new Set(Object.values(board.states).flat());

  // Every current member ships with the page; other names arrive with each state.
  const book: Record<string, BoardMember> = {};
  for (const id of current) {
    const m = members.get(id);
    if (m) book[id] = toBoardMember(m);
  }

  const orgName = (id: string) => orgs.get(id)?.name ?? id;
  const lite = (c: (typeof allCases)[number]): CaseLite => ({
    id: c.id, member: c.member, org: c.org, orgName: orgName(c.org), types: c.types, years: c.years, money: c.money ?? 0, trades: c.trades ?? 0,
  });

  // Featured example: the current member whose drawn board has the widest mix
  // of tie kinds (ties: more records, then id), plus the next few for "Show another".
  const ranked = rankFeatured([...current].filter((id) => book[id]).sort().map((id) => ({ member: id, picked: memberBoard(id).edges })));
  const featured: Featured = ranked.length
    ? { picks: ranked.map((f, i) => ({ member: f.member, reason: featuredReason(f.kinds, i === 0), kinds: f.kinds.length })) }
    : null;

  const initialChunks: Record<string, StateChunk> = {};
  const fm = featured?.picks[0].member ?? null;
  if (fm && book[fm]) {
    const b = memberBoard(fm);
    Object.assign(book, b.members);
    initialChunks[book[fm].state] = { strings: { [fm]: b.edges }, nodes: b.nodes, members: b.members, more: { [fm]: b.more } };
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
