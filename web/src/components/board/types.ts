// Shapes shared by the board's parts: what the home page passes in, and the current selection.
import type { Edge, EdgeType, OrgSummary } from "@/lib/types";
import type { BoardMember } from "@/lib/domain/names";

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

/** Featured examples, most varied first: `reason` is the one sentence shown on the slip. */
export type Featured = { picks: { member: string; reason: string; kinds: number }[] } | null;

export type StateChunk = {
  strings: Record<string, Edge[]>;
  nodes: Record<string, OrgSummary>;
  members: Record<string, BoardMember>;
  /** Ties per member beyond the drawn strings. */
  more: Record<string, number>;
  /** Spenders against each member beyond the three shown in the "Spent against" zone. */
  againstMore?: Record<string, number>;
};

/** What the board shows, mirrored in the URL: ?s=<state>&m=<member>&o=<org>&focus=<card id>. */
export type Sel = { s: string | null; m: string | null; o: string | null; focus: string | null };
export const EMPTY: Sel = { s: null, m: null, o: null, focus: null };
