// The home page: builds everything the board needs at build time (current members, the featured example and
// its strings, cases) and hands it to BoardApp.
import { getBoard, getCases, getMemberIndex, getMeta, getOrgIndex, mapLimit, memberBoard, metaBuilt } from "@/lib/data/server";
import { getMapGeometry } from "@/lib/board/geo";
import { caseMinTypes, sourceNames } from "@/lib/data/meta";
import { toBoardMember, type BoardMember } from "@/lib/domain/names";
import { BoardApp, type CaseLite, type Featured, type StateChunk } from "@/components/board/BoardApp";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { featuredReason, rankFeatured } from "@/lib/domain/featured";

export default async function BoardPage() {
  const [board, members, orgs, meta, allCases] = await Promise.all([getBoard(), getMemberIndex(), getOrgIndex(), getMeta(), getCases()]);
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
  const candidates = [...current].filter((id) => book[id]).sort();
  const boards = new Map(await mapLimit(candidates, 16, async (id) => [id, await memberBoard(id)] as const));
  const ranked = rankFeatured(candidates.map((id) => ({ member: id, picked: boards.get(id)!.edges })));
  const featured: Featured = ranked.length
    ? { picks: ranked.map((f, i) => ({ member: f.member, reason: featuredReason(f.kinds, i === 0), kinds: f.kinds.length })) }
    : null;

  const initialChunks: Record<string, StateChunk> = {};
  const fm = featured?.picks[0].member ?? null;
  if (fm && book[fm]) {
    const b = boards.get(fm) ?? (await memberBoard(fm));
    Object.assign(book, b.members);
    initialChunks[book[fm].state] = { strings: { [fm]: b.edges }, nodes: b.nodes, members: b.members, more: { [fm]: b.more }, againstMore: { [fm]: b.againstMore } };
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
          caseMinTypes={caseMinTypes(meta)}
          asOf={metaBuilt(meta)}
        />
      </ErrorBoundary>
    </div>
  );
}
