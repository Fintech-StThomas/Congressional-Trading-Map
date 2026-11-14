// The featured example on the home board: the current member whose drawn board
// shows the widest mix of tie kinds. Pure; tests load it directly.
import type { Edge } from "./types";

// Same rule as pick.ts spendingSide (duplicated: this file has no runtime imports).
function spendingSide(e: Pick<Edge, "note" | "via">): "support" | "oppose" | null {
  if (e.note === "oppose" || e.via?.id.endsWith(":oppose")) return "oppose";
  if (e.note === "support" || e.via?.id.endsWith(":support")) return "support";
  return null;
}

export type TieKind = "case" | "support" | "oppose" | "funds_in" | "funds_out" | "traded_together" | "pac";
export const TIE_KINDS: TieKind[] = ["case", "support", "oppose", "funds_in", "funds_out", "traded_together", "pac"];
export const TIE_KIND_PHRASE: Record<TieKind, string> = {
  case: "a company that is both traded and gives PAC money",
  support: "outside spending for them",
  oppose: "outside spending against them",
  funds_in: "money from a colleague",
  funds_out: "money to a colleague",
  traded_together: "a statistical co-trading tie",
  pac: "PAC money from a company they did not trade",
};

/** The kinds of tie present in one member's picked board. */
export function boardKinds(self: string, picked: Edge[]): TieKind[] {
  const end = (e: Edge) => (e.from.id === self ? e.to : e.from);
  const traded = new Set(picked.filter((e) => e.type === "traded").map((e) => end(e).id));
  const got = new Set<TieKind>();
  for (const e of picked) {
    if (e.type === "pac_money") got.add(traded.has(end(e).id) ? "case" : "pac");
    else if (e.type === "outside_spending") {
      const s = spendingSide(e);
      if (s) got.add(s);
    } else if (e.type === "funds") got.add(e.to.id === self ? "funds_in" : "funds_out");
    else if (e.type === "traded_together") got.add("traded_together");
  }
  return TIE_KINDS.filter((k) => got.has(k));
}

export type FeaturedPick = { member: string; kinds: TieKind[]; records: number };

/** Most kinds first, then more records on the board, then id. */
export function rankFeatured(boards: { member: string; picked: Edge[] }[], n = 6): FeaturedPick[] {
  return boards
    .map(({ member, picked }) => ({ member, kinds: boardKinds(member, picked), records: picked.reduce((s, e) => s + (e.count ?? 0), 0) }))
    .filter((f) => f.kinds.length > 0)
    .sort((a, b) => b.kinds.length - a.kinds.length || b.records - a.records || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0))
    .slice(0, n);
}

/** One sentence: why this board is the example. */
export function featuredReason(kinds: TieKind[], top = true): string {
  if (kinds.length === TIE_KINDS.length) return "Shown because this member’s filings include every kind of tie the site tracks.";
  const has = new Set(kinds);
  const ps: string[] = [];
  for (const k of kinds) {
    if (k === "support" && has.has("oppose")) ps.push("outside spending for and against them");
    else if (k === "oppose" && has.has("support")) continue;
    else if (k === "funds_in" && has.has("funds_out")) ps.push("money to and from colleagues");
    else if (k === "funds_out" && has.has("funds_in")) continue;
    else ps.push(TIE_KIND_PHRASE[k]);
  }
  const list = ps.length <= 1 ? ps.join("") : `${ps.slice(0, -1).join(", ")} and ${ps[ps.length - 1]}`;
  return `Shown because this member’s filings include ${list}: ${kinds.length} of the ${TIE_KINDS.length} kinds of tie the site tracks, ${top ? "the widest mix of any current member" : "one of the widest mixes among current members"}.`;
}
