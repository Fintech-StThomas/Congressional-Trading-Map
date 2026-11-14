// Party-neutral helpers for the wall, the organisation reach view and /orgs.
// Party is a letter plus a neutral pattern; it is never a colour. Browser-safe.
import type { MemberSummary, OrgSummary, PartySplit } from "./types";
import { compactMoney, count } from "./format";

export type Party = MemberSummary["party"];
/** Display order everywhere: D, I, R (independents sit between the two large sections). */
export const PARTY_ORDER: Party[] = ["D", "I", "R"];
export const PARTY_FULL: Record<Party, string> = { D: "Democratic", I: "Independent", R: "Republican" };
const NOUN: Record<Party, [string, string]> = {
  D: ["Democrat", "Democrats"],
  I: ["independent", "independents"],
  R: ["Republican", "Republicans"],
};

export function partyNoun(p: Party, n: number): string {
  return `${count(n)} ${NOUN[p][n === 1 ? 0 : 1]}`;
}

/** "a, b and c" */
export function andList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------- wall.json

export type WallRow = {
  id: string; name: string; last: string; party: Party; state: string; chamber: "sen" | "rep";
  district: number | null; current: boolean; photo: boolean;
  cases: number; trades: number; pac: number; support: number; oppose: number; orgs: number;
};

export function decodeWall(raw: { cols: string[]; rows: unknown[][] } | null): WallRow[] {
  if (!raw?.cols || !Array.isArray(raw.rows)) return [];
  const at = Object.fromEntries(raw.cols.map((c, i) => [c, i]));
  const n = (r: unknown[], k: string) => (typeof r[at[k]] === "number" ? (r[at[k]] as number) : 0);
  return raw.rows.map((r) => ({
    id: String(r[at.id]), name: String(r[at.name]), last: String(r[at.last] ?? ""), party: (r[at.party] as Party) ?? "I",
    state: String(r[at.state]), chamber: r[at.chamber] === "sen" ? "sen" : "rep",
    district: typeof r[at.district] === "number" ? (r[at.district] as number) : null,
    current: r[at.current] === 1 || r[at.current] === true, photo: r[at.photo] === 1 || r[at.photo] === true,
    cases: n(r, "cases"), trades: n(r, "trades"), pac: n(r, "pac"), support: n(r, "support"), oppose: n(r, "oppose"), orgs: n(r, "orgs"),
  }));
}

// ---------------------------------------------------------------- org-index.json

export type IndexOrg = {
  id: string; name: string; kind: OrgSummary["kind"]; ticker: string | null; degree: number;
  members: Record<Party, number>; dollars: Record<Party, number>;
};
export type OrgIndexData = { byMembers: IndexOrg[]; byDollars: IndexOrg[] };

export function decodeOrgIndex(raw: { cols: string[]; rows: unknown[][]; by_members: number[]; by_dollars: number[] } | null): OrgIndexData {
  if (!raw?.cols || !Array.isArray(raw.rows)) return { byMembers: [], byDollars: [] };
  const at = Object.fromEntries(raw.cols.map((c, i) => [c, i]));
  const rows: IndexOrg[] = raw.rows.map((r) => ({
    id: String(r[at.id]), name: String(r[at.name]), kind: r[at.kind] as OrgSummary["kind"],
    ticker: (r[at.ticker] as string | null) ?? null, degree: Number(r[at.degree] ?? 0),
    members: { D: Number(r[at.members_D] ?? 0), I: Number(r[at.members_I] ?? 0), R: Number(r[at.members_R] ?? 0) },
    dollars: { D: Number(r[at.dollars_D] ?? 0), I: Number(r[at.dollars_I] ?? 0), R: Number(r[at.dollars_R] ?? 0) },
  }));
  const pick = (ix: number[] | undefined) => (ix ?? []).map((i) => rows[i]).filter(Boolean);
  return { byMembers: pick(raw.by_members), byDollars: pick(raw.by_dollars) };
}

// ---------------------------------------------------------------- split sentences

export type Measure = keyof PartySplit;
export type Parts = Record<Party, number>;

export function partsOf(split: PartySplit | undefined, m: Measure, i: 0 | 1): Parts | null {
  const s = split?.[m];
  if (!s) return null;
  return { D: s.D[i] ?? 0, I: s.I[i] ?? 0, R: s.R[i] ?? 0 };
}

const VERB: Record<Measure, string> = {
  given: "Gave to",
  support: "Spent supporting",
  oppose: "Spent opposing",
  traded: "Stock traded by the households of",
};

/**
 * Literal wording, largest party first, zero parties left out:
 * "Gave to 212 Republicans, 198 Democrats and 2 independents: $4.1M, $3.7M and $20K since 2000."
 */
export function splitSentence(m: Measure, members: Parts, dollars: Parts | null, since: number | null): string {
  const order = PARTY_ORDER.filter((p) => members[p] > 0).sort((a, b) => members[b] - members[a] || PARTY_ORDER.indexOf(a) - PARTY_ORDER.indexOf(b));
  if (!order.length) return "";
  const who = andList(order.map((p) => partyNoun(p, members[p])));
  const tail = since ? ` since ${since}` : "";
  if (!dollars) return `${VERB[m]} ${who}${tail}.`;
  return `${VERB[m]} ${who}: ${andList(order.map((p) => shortMoney(dollars[p])))}${tail}.`;
}

/** "$4.1M", "$118K", "$9.5K", "$750": always short, for labels beside prints and bars. */
export function shortMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return compactMoney(n);
  if (a >= 1e4) return `$${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n)}`;
}

export function total(p: Parts): number {
  return p.D + p.I + p.R;
}
