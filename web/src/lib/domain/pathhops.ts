// Turns the published files (a member file, an organisation shard entry) into the hops the connection finder chains,
// and a hop back into an Edge the evidence drawer can show. Pure; tests/paths.test.mjs loads it directly.
// Nothing here guesses a tie: a row becomes a hop only as the file lists it, with the direction the contract gives.
import type { Edge, EdgeType, MemberFileWire, NodeRef, OrgFileWire } from "../types.ts";
import { decodeLedger, FAMILY_OF, fromColumns } from "../data/decode.ts";
import { typeLabel } from "./edges.ts";
import { hopYears, type Hop } from "./paths.ts";
import { spendingSide } from "./pick.ts";

/** Types whose ties are always statistical (derived), whatever file they are read from. */
const DERIVED_TYPES = new Set<EdgeType>(["shared_donors", "traded_together"]);
const MEMBER_TO_ORG = new Set<EdgeType>(["traded", "owns", "position"]);
const ORG_TO_MEMBER = new Set<EdgeType>(["pac_money", "employee_money", "lobbyist_money", "outside_spending", "paid_travel"]);

const M = (id: string): NodeRef => ({ kind: "member", id });
const O = (id: string): NodeRef => ({ kind: "org", id });
const sortedPair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function fromEdge(e: Edge, file: string, source: Hop["source"] = "edge"): Hop {
  const y = hopYears(e);
  return {
    key: e.id, edge: e.id, file, full: true, source, type: e.type, label: typeLabel(e), family: e.family, basis: e.basis,
    directed: e.directed, from: e.from, to: e.to, amount: e.amount, count: e.count, first: e.first || null, last: e.last || null,
    years: y?.years ?? null, yearsBasis: y?.basis ?? null, side: spendingSide(e), via: e.via?.name ?? null,
  };
}

/** Every full edge and ledger row of a member file. A row's `dir` is relative to this member (in: the member is the payee). */
export function hopsFromMemberFile(file: MemberFileWire): Hop[] {
  const self = file.member.id;
  const out: Hop[] = (file.edges ?? []).map((e) => fromEdge(e, self));
  for (const r of decodeLedger(file)) {
    const other = r.otherKind === "member" ? M(r.other) : O(r.other);
    const directed = r.dir !== "both";
    const from = r.dir === "in" ? other : M(self);
    const to = r.dir === "in" ? M(self) : other;
    const y = hopYears({ first: r.first, last: r.last });
    const side = spendingSide({ note: r.note, via: r.via });
    const ends = directed ? `${from.id}>${to.id}` : sortedPair(from.id, to.id);
    out.push({
      key: `L|${r.type}|${ends}|${r.via?.id ?? ""}`, edge: null, file: self, full: false, source: "ledger", type: r.type,
      label: typeLabel({ type: r.type, note: r.note, via: r.via }), family: FAMILY_OF[r.type] ?? "money",
      basis: DERIVED_TYPES.has(r.type) ? "derived" : "filed", directed, from, to,
      amount: { low: r.low, high: r.high, exact: r.exact }, count: r.count, first: r.first, last: r.last,
      years: y?.years ?? null, yearsBasis: y?.basis ?? null, side, via: r.via?.name ?? null,
    });
  }
  return out;
}

/**
 * Every row of an organisation's `ties` table. Rows carry no side for outside spending, so unless the row points at a full
 * edge (which the member's file then supplies) its side stays unknown and the finder does not use it.
 */
export function hopsFromOrgFile(file: OrgFileWire): Hop[] {
  const org = file.org.id;
  const t = file.ties;
  if (!t || !Array.isArray(t.cols)) {
    return (file.edges ?? []).map((e) => fromEdge(e, (e.from.kind === "member" ? e.from.id : e.to.id), "orgrow"));
  }
  return fromColumns<Record<string, unknown>>(t).map((r) => {
    const type = r.type as EdgeType;
    const member = String(r.member);
    const edge = (r.edge as string | null) ?? null;
    const m = M(member), o = O(org);
    const toOrg = MEMBER_TO_ORG.has(type);
    const toMember = ORG_TO_MEMBER.has(type);
    const directed = toOrg || toMember;
    const from = toMember ? o : m;
    const to = toMember ? m : o;
    const first = (r.first as string | null) || null;
    const last = (r.last as string | null) || null;
    const y = hopYears({ first, last });
    const note = (r.note as string | null) ?? null;
    return {
      key: edge ?? `O|${type}|${directed ? `${from.id}>${to.id}` : sortedPair(member, org)}`, edge, file: edge ? member : null,
      full: edge !== null, source: "orgrow", type, label: typeLabel({ type, note, via: null }), family: FAMILY_OF[type] ?? "money",
      basis: DERIVED_TYPES.has(type) ? "derived" : "filed", directed, from, to,
      amount: { low: (r.low as number | null) ?? null, high: (r.high as number | null) ?? null, exact: (r.exact as number | null) ?? null },
      count: Number(r.count ?? 0), first, last, years: y?.years ?? null, yearsBasis: y?.basis ?? null,
      side: spendingSide({ note, via: null }), via: null,
    } satisfies Hop;
  });
}

/** Names the file knows: the member itself, the organisations and members its full edges reference. */
export function namesFromMemberFile(file: MemberFileWire): Record<string, { name: string; kind: "member" | "org" }> {
  const out: Record<string, { name: string; kind: "member" | "org" }> = { [file.member.id]: { name: file.member.name, kind: "member" } };
  for (const [id, n] of Object.entries(file.nodes ?? {})) out[id] = { name: n.name, kind: n.kind === "member" ? "member" : "org" };
  return out;
}

/** A stand-in Edge for a hop whose full record is not available (a summary row): the drawer then says no filings are listed. */
export function edgeFromHop(h: Hop): Edge {
  return {
    id: h.key, type: h.type, family: h.family, basis: h.basis, from: h.from, to: h.to, directed: h.directed,
    via: h.via ? { id: h.via, name: h.via } : null, amount: h.amount, count: h.count, first: h.first ?? "", last: h.last ?? "",
    by_year: [], evidence: [], evidence_total: h.count, stat: null, weak: false, note: h.side,
  };
}
