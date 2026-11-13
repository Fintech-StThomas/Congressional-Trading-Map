// Which strings the board draws for one member, chosen from the member file's
// full edge list. Pure and deterministic: same edges in, same board out.
// Kept free of runtime imports so tests/pick.test.mjs can load it directly.
import type { Edge } from "./types";

export const PICK_LIMITS = { cards: 12, strings: 14, cases: 5 } as const;

function dollars(e: Edge): number {
  return e.amount.exact ?? e.amount.high ?? e.amount.low ?? 0;
}

/** Larger money first, then more records, then id: a total order. */
function byWeight(a: Edge, b: Edge): number {
  return dollars(b) - dollars(a) || b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function other(e: Edge, self: string): string {
  const n = e.from.id === self ? e.to : e.from;
  return `${n.kind}:${n.id}`;
}

export function spendingSide(e: Pick<Edge, "note" | "via">): "support" | "oppose" | null {
  if (e.note === "oppose" || e.via?.id.endsWith(":oppose")) return "oppose";
  if (e.note === "support" || e.via?.id.endsWith(":support")) return "support";
  return null;
}

/**
 * Up to 5 case companies (a traded string and a PAC-money string to the same
 * company, both kept), then one string of each kind the record holds: largest
 * outside spending supporting and opposing, the top two member-to-member gifts
 * (one received and one given when both exist), one statistical co-trading
 * tie; then the largest remaining money strings, then any other filed strings.
 * At most 12 cards and 14 strings; context strings are never picked.
 */
export function pickBoard(self: string, edges: Edge[], limits: { cards: number; strings: number; cases: number } = PICK_LIMITS): Edge[] {
  const pool = edges.filter((e) => e.family !== "context").sort(byWeight);
  const picked: Edge[] = [];
  const taken = new Set<string>();
  const cards = new Set<string>();
  const add = (e: Edge | undefined): boolean => {
    if (!e || taken.has(e.id)) return false;
    const k = other(e, self);
    if (!cards.has(k) && cards.size >= limits.cards) return false;
    if (picked.length >= limits.strings) return false;
    picked.push(e);
    taken.add(e.id);
    cards.add(k);
    return true;
  };

  // Variety first, so the case pairs cannot crowd it out.
  const ofType = (t: Edge["type"]) => pool.filter((e) => e.type === t);
  const spend = ofType("outside_spending");
  const funds = ofType("funds");
  const incoming = funds.filter((e) => e.to.id === self);
  const outgoing = funds.filter((e) => e.from.id === self);
  const fundPicks = incoming.length && outgoing.length ? [incoming[0], outgoing[0]] : funds.slice(0, 2);
  const variety = [
    spend.find((e) => spendingSide(e) === "support"),
    spend.find((e) => spendingSide(e) === "oppose"),
    ...fundPicks,
    ofType("traded_together")[0],
  ].filter((e): e is Edge => Boolean(e));
  const varietyCards = new Set(variety.map((e) => other(e, self))).size;

  // Case companies: an org with both a traded and a pac_money string.
  const byOrg = new Map<string, { traded?: Edge; pac?: Edge }>();
  for (const e of pool) {
    if (e.type !== "traded" && e.type !== "pac_money") continue;
    const k = other(e, self);
    if (!k.startsWith("org:")) continue;
    const c = byOrg.get(k) ?? {};
    if (e.type === "traded" && !c.traded) c.traded = e;
    if (e.type === "pac_money" && !c.pac) c.pac = e;
    byOrg.set(k, c);
  }
  const cases = [...byOrg.entries()]
    .filter(([, c]) => c.traded && c.pac)
    .map(([k, c]) => ({ k, pair: [c.pac!, c.traded!], w: dollars(c.pac!) + dollars(c.traded!) }))
    .sort((a, b) => b.w - a.w || (a.k < b.k ? -1 : 1));
  const caseRoom = Math.max(0, Math.min(limits.cases, limits.cards - varietyCards, Math.floor((limits.strings - variety.length) / 2)));
  for (const c of cases.slice(0, caseRoom)) c.pair.forEach(add);
  variety.forEach(add);

  // Fill: money first, then anything else filed, one string per new card.
  const rest = [...pool.filter((e) => e.family === "money"), ...pool.filter((e) => e.family !== "money")];
  for (const e of rest) {
    if (cards.size >= limits.cards || picked.length >= limits.strings) break;
    if (cards.has(other(e, self))) continue;
    add(e);
  }
  return picked;
}
