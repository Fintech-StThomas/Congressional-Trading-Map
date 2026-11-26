// The member page's trade rows: the table lists every row, including those a later filing marks Deleted (marked, counted
// nowhere), while every figure and the printed list use the counted rows only (files without a not_counted map: all rows
// count). Listed rows can exist when no trade is counted, so the table is fed whenever the file has rows.
// `flagInfo` gathers what the review-flag badges and the "Around this trade" panel need from the server: flags of the
// first rows (the table loads the rest with the file), names of the members and committees the flags name, and the
// member's PAC money ties from the companies traded (full edges and ledger rows). It is null for a build whose trade
// file has no `flags` (older releases), so the Around column and panel are not shown at all; `sec` is false for a
// build without the SEC 8-K stage, which hides only the panel's 8-K block. Absent fields stay absent, never zero.
import { countedWire, decodeLedger, decodeTradeFile, type LedgerRow, type TradeMarks, type TradeRow } from "@/lib/data/decode";
import { metaSources } from "@/lib/data/meta";
import { hasFlags } from "@/lib/domain/around";
import type { Edge, FlagDetail, Meta, MemberFile, MemberSummary } from "@/lib/types";
import { statementOf } from "@/lib/domain/flags";

type Wire = ({ cols: string[]; rows: unknown[][]; filings?: Record<string, string> } & TradeMarks) | null;

export function memberTrades(tradeFile: Wire, nTrades: number, first = 60): { listedN: number; initialTrades: TradeRow[]; countedInitial: TradeRow[]; countedFile: ReturnType<typeof countedWire> } {
  const listedN = tradeFile?.rows.length ?? 0;
  const initialTrades = nTrades || listedN ? decodeTradeFile(tradeFile, first, { listed: true }) : [];
  return { listedN, initialTrades, countedInitial: initialTrades.filter((t) => !t.notCounted), countedFile: countedWire(tradeFile) };
}

export type FlagMap = Record<string, Record<string, FlagDetail>>;
export type PacTie = Pick<Edge, "id" | "by_year" | "evidence" | "via">;
export type TradeFlagInfo = {
  member: string;
  sec: boolean;                        // the build ran the SEC 8-K stage (meta.json sources)
  fec: boolean;                        // the member has an FEC candidate id (money_both_ways can be checked)
  current: boolean;                    // a current member (sector_overseen can be checked)
  byTrade: FlagMap;                    // flags of the first rows; the table replaces it with the file's map
  summary: Record<string, number> | null; // trade_summary.flags; null in older builds
  statement: string;
  names: Record<string, string>;       // members named by pile_on details
  committees: Record<string, string>;  // committee id -> name
  orgs: Record<string, string>;        // traded org id -> name
  pac: Record<string, PacTie[]>;       // org id -> the member's pac_money full edges from it (traded orgs only)
  ledger: Record<string, LedgerRow[]>; // org id -> the member's pac_money ledger rows from it (traded orgs only)
  ledgerTrimmed: boolean;              // ledger_totals counts more pac_money ties than the file lists (former members)
};

export function flagInfo(
  tradeFile: (Wire & { flags?: FlagMap }) | null, file: Pick<MemberFile, "member" | "edges" | "trade_summary"> & Partial<Pick<MemberFile, "ledger" | "ledger_totals">>,
  members: Map<string, MemberSummary>, orgName: (id: string) => string, initial: TradeRow[], meta: Meta,
): TradeFlagInfo | null {
  const all = tradeFile?.flags;
  if (!all || !hasFlags(tradeFile)) return null;
  const byTrade: FlagMap = {};
  const names: Record<string, string> = {};
  for (const t of initial) if (all[t.id]) byTrade[t.id] = all[t.id];
  for (const d of Object.values(all)) {
    const p = d.pile_on as { members?: string[] } | undefined;
    for (const id of p?.members ?? []) if (!names[id]) names[id] = members.get(id)?.name ?? id;
  }
  const orgs: Record<string, string> = {};
  const at = tradeFile?.cols.indexOf("org") ?? -1;
  if (at >= 0) for (const r of tradeFile!.rows) { const o = r[at]; if (typeof o === "string" && !orgs[o]) orgs[o] = orgName(o); }
  const pac: Record<string, PacTie[]> = {};
  for (const e of file.edges) {
    if (e.type === "pac_money" && e.from.kind === "org" && orgs[e.from.id]) (pac[e.from.id] ??= []).push({ id: e.id, by_year: e.by_year, evidence: e.evidence, via: e.via });
  }
  const ledger: Record<string, LedgerRow[]> = {};
  let ledgerPac = 0;
  for (const r of decodeLedger(file as { ledger?: MemberFile["ledger"] })) {
    if (r.type !== "pac_money" || r.otherKind !== "org" || r.dir !== "in") continue;
    ledgerPac++;
    if (orgs[r.other]) (ledger[r.other] ??= []).push(r);
  }
  const committees = Object.fromEntries((file.member.committees ?? []).map((c) => [c.id, c.name]));
  const mf = (meta as { flags?: { statement?: unknown } }).flags;
  return {
    member: file.member.id, byTrade, summary: file.trade_summary?.flags ?? null,
    statement: statementOf(mf), names, committees, orgs, pac, ledger,
    ledgerTrimmed: (file.ledger_totals?.pac_money?.edges ?? 0) > ledgerPac,
    sec: metaSources(meta).some((s) => s.id === "sec_edgar_submissions"),
    fec: (file.member.fec_ids ?? []).length > 0, current: Boolean(file.member.current),
  };
}
