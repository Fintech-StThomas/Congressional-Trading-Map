// /cases pagination and filters, as static paths so every page can be prerendered and cached:
//   /cases                                  page 1, every case
//   /cases/page/3                           page 3
//   /cases/ties/trade-pac/chamber/senate/party/r/page/2
// Filters: the tie combination (the distinct `types` sets), the member's chamber and party letter.
// Pure; tests/casepages.test.mjs loads it directly.

export const CASES_PER_PAGE = 50;

/** The tie combinations, keyed by URL slug, with the sorted `types` set each stands for. */
export const COMBOS = {
  "holding-trade-pac": { types: ["owns", "pac_money", "traded"], label: "Holding + trade + PAC money" },
  "trade-pac": { types: ["pac_money", "traded"], label: "Trade + PAC money" },
  "holding-pac": { types: ["owns", "pac_money"], label: "Holding + PAC money" },
} as const;
export type ComboSlug = keyof typeof COMBOS;

export const CHAMBERS = { house: { chamber: "rep", label: "House" }, senate: { chamber: "sen", label: "Senate" } } as const;
export type ChamberSlug = keyof typeof CHAMBERS;

export const PARTIES = { d: { party: "D", label: "D" }, r: { party: "R", label: "R" }, i: { party: "I", label: "I" } } as const;
export type PartySlug = keyof typeof PARTIES;

export type CaseFilter = { ties?: ComboSlug; chamber?: ChamberSlug; party?: PartySlug };
export type CasesQuery = CaseFilter & { page: number };

/** The combination slug of one case's `types`, or null for a set the filter does not name. */
export function comboOf(types: readonly string[]): ComboSlug | null {
  const key = [...types].sort().join("+");
  for (const [slug, c] of Object.entries(COMBOS)) if (c.types.join("+") === key) return slug as ComboSlug;
  return null;
}

/** "/cases", "/cases/page/3", "/cases/ties/trade-pac/party/r" … Canonical order: ties, chamber, party, page. */
export function casesHref(q: Partial<CasesQuery>): string {
  const parts: string[] = [];
  if (q.ties) parts.push("ties", q.ties);
  if (q.chamber) parts.push("chamber", q.chamber);
  if (q.party) parts.push("party", q.party);
  if (q.page && q.page > 1) parts.push("page", String(q.page));
  return parts.length ? `/cases/${parts.join("/")}` : "/cases";
}

/** The catch-all segments after /cases, or null when they are not a canonical cases path. */
export function parseCasesPath(slug: readonly string[] | undefined): CasesQuery | null {
  const s = slug ?? [];
  if (s.length % 2) return null;
  const q: CasesQuery = { page: 1 };
  const order = ["ties", "chamber", "party", "page"];
  let last = -1;
  for (let i = 0; i < s.length; i += 2) {
    const k = s[i], v = s[i + 1];
    const at = order.indexOf(k);
    if (at <= last) return null;
    last = at;
    if (k === "ties") { if (!(v in COMBOS)) return null; q.ties = v as ComboSlug; }
    else if (k === "chamber") { if (!(v in CHAMBERS)) return null; q.chamber = v as ChamberSlug; }
    else if (k === "party") { if (!(v in PARTIES)) return null; q.party = v as PartySlug; }
    else if (k === "page") { if (!/^[1-9]\d*$/.test(v) || v === "1") return null; q.page = Number(v); }
  }
  return q;
}

type CaseLike = { types: readonly string[]; member: string };
type MemberLike = { chamber: string; party: string };

/** Does a case pass the filter? `member` is the case's member summary (unknown members pass only an empty filter). */
export function caseMatches(c: CaseLike, member: MemberLike | undefined, f: CaseFilter): boolean {
  if (f.ties && comboOf(c.types) !== f.ties) return false;
  if (f.chamber && member?.chamber !== CHAMBERS[f.chamber].chamber) return false;
  if (f.party && member?.party !== PARTIES[f.party].party) return false;
  return true;
}

export type CasesPage<C> = {
  /** The page's cases with their rank in the full ranking (1-based). */
  rows: { c: C; rank: number }[];
  page: number; pages: number; total: number;
  /** 1-based positions within the filtered list: "Cases 101–150 of 2,450". */
  first: number; last: number;
};

/** One page of the filtered ranking. `page` beyond the last page gives no rows. */
export function pageOf<C extends CaseLike>(cases: readonly C[], members: Map<string, MemberLike>, q: CasesQuery): CasesPage<C> {
  const hits: { c: C; rank: number }[] = [];
  cases.forEach((c, i) => {
    if (caseMatches(c, members.get(c.member), q)) hits.push({ c, rank: i + 1 });
  });
  const pages = Math.max(1, Math.ceil(hits.length / CASES_PER_PAGE));
  const start = (q.page - 1) * CASES_PER_PAGE;
  const rows = hits.slice(start, start + CASES_PER_PAGE);
  return { rows, page: q.page, pages, total: hits.length, first: rows.length ? start + 1 : 0, last: start + rows.length };
}

/** Every filter combination with at least one case, and its page count: the static paths to prerender. */
export function allCasePaths(cases: readonly CaseLike[], members: Map<string, MemberLike>): CasesQuery[] {
  const out: CasesQuery[] = [];
  const ties: (ComboSlug | undefined)[] = [undefined, ...(Object.keys(COMBOS) as ComboSlug[])];
  const chambers: (ChamberSlug | undefined)[] = [undefined, ...(Object.keys(CHAMBERS) as ChamberSlug[])];
  const parties: (PartySlug | undefined)[] = [undefined, ...(Object.keys(PARTIES) as PartySlug[])];
  for (const t of ties)
    for (const ch of chambers)
      for (const p of parties) {
        const f: CaseFilter = { ties: t, chamber: ch, party: p };
        const n = cases.reduce((k, c) => k + (caseMatches(c, members.get(c.member), f) ? 1 : 0), 0);
        if (!n) continue;
        const pages = Math.ceil(n / CASES_PER_PAGE);
        for (let page = 1; page <= pages; page++) out.push({ ...f, page });
      }
  return out;
}

/** The catch-all segments for a query (the inverse of parseCasesPath); [] is /cases itself. */
export function casesSlug(q: CasesQuery): string[] {
  const href = casesHref(q);
  return href === "/cases" ? [] : href.slice("/cases/".length).split("/");
}

/** Page numbers to show around the current page: 1 … 4 5 [6] 7 8 … 50 (null is a gap). */
export function pageWindow(page: number, pages: number, around = 2): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= around) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
