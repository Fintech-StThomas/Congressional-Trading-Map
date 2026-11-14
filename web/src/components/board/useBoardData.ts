"use client";
// Loads what the board needs for the current selection, once per member or organisation:
//   current member  -> /board-data/<state> (every current member of that state, cut at build time)
//   former member   -> /board-member/<id>
//   organisation    -> data/orgs/<shard>.json (its ties), plus member names from the search index
// Results are kept in state so going back is instant; a stale response (fast navigation) is dropped.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Edge, OrgFileWire, OrgSummary } from "@/lib/types";
import { dataUrl } from "@/lib/urls";
import { getJSON, loadSearchIndex } from "@/lib/data/fetch";
import type { BoardMember, NameBook } from "@/lib/domain/names";
import { decodeOrgTies, orgTieTotal, type TieEdge } from "@/lib/data/decode";
import { orgShard } from "@/lib/hash";
import type { Sel, StateChunk } from "./types";

export type OrgBoard = { org: OrgSummary; ties: TieEdge[]; total: number };
export type FormerBoard = { edges: Edge[]; more: number; againstMore?: number };

export function useBoardData(sel: Sel, initialChunks: Record<string, StateChunk>, initialMembers: Record<string, BoardMember>, current: Set<string>) {
  const [chunks, setChunks] = useState<Record<string, StateChunk>>(initialChunks);
  const [memberBook, setMemberBook] = useState<Record<string, BoardMember>>(initialMembers);
  const [orgBook, setOrgBook] = useState<Record<string, OrgSummary>>(() => Object.assign({}, ...Object.values(initialChunks).map((c) => c.nodes)));
  const [orgFiles, setOrgFiles] = useState<Record<string, OrgBoard>>({});
  const [memberFiles, setMemberFiles] = useState<Record<string, FormerBoard>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const book: NameBook = useMemo(() => ({ members: memberBook, orgs: orgBook }), [memberBook, orgBook]);

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
                againstMore: { ...c[st]?.againstMore, ...chunk.againstMore },
              },
            }));
            setOrgBook((b) => ({ ...b, ...chunk.nodes }));
            setMemberBook((b) => ({ ...chunk.members, ...b }));
          } else if (!current.has(sel.m) && memberBook[sel.m] && !memberFiles[sel.m]) {
            // Former members are not on board.json: their strings are cut from
            // the case file at build time.
            setLoading(true);
            const body = await getJSON<{ edges: Edge[]; nodes: Record<string, OrgSummary>; members: Record<string, BoardMember>; more: number; againstMore?: number }>(`/board-member/${sel.m}`);
            if (!live) return;
            setOrgBook((b) => ({ ...b, ...body.nodes }));
            setMemberBook((b) => ({ ...body.members, ...b }));
            const memberId = sel.m;
            setMemberFiles((f) => ({ ...f, [memberId]: { edges: body.edges, more: body.more, againstMore: body.againstMore } }));
          }
        } else if (sel.o && !orgFiles[sel.o]) {
          setLoading(true);
          const shard = await orgShard(sel.o);
          const body = await getJSON<Record<string, OrgFileWire>>(dataUrl(`orgs/${shard}.json`));
          const file = body[sel.o];
          if (!live) return;
          if (!file) throw new Error("not-found");
          const ties = decodeOrgTies(file);
          // Listed ties plus the money ties only ledger_totals counts (they are disjoint by contract).
          const orgId = sel.o;
          setOrgFiles((f) => ({ ...f, [orgId]: { org: file.org, ties, total: orgTieTotal(file) } }));
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

  return { chunks, memberBook, orgBook, orgFiles, memberFiles, loading, error, book };
}
