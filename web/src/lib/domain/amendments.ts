// Later filings of a trade (trades/<id>.json `amendments`): read the map tolerantly (files built before it existed have
// none, and permalinks to those releases must keep working), then describe one trade's later filings in plain words.
// Pure; tests/amendments.test.mjs loads it directly. A later filing that marks a transaction Deleted does not remove
// the trade; not_counted marks it listed-only (counted nowhere).
import type { TradeFile } from "../types.ts";
import { AMEND } from "../copy-amend.ts";
import { safeHttpUrl } from "../urls.ts";

export type LaterFiling = { id: string; doc: string; status: "Amended" | "Deleted" | "Reprinted" | "Version"; available: string | null };
export type AmendmentMap = { [tradeId: string]: LaterFiling[] };

const STATUSES = new Set(["Amended", "Deleted", "Reprinted", "Version"]);

/** The `amendments` map of a trade file; {} when it is absent or not the contract's shape. Malformed entries are dropped. */
export function readAmendments(file: { amendments?: unknown } | null | undefined): AmendmentMap {
  const raw = file?.amendments;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AmendmentMap = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const ok = list.filter(
      (x): x is LaterFiling =>
        Boolean(x) && typeof x === "object" && typeof (x as LaterFiling).doc === "string" && STATUSES.has((x as LaterFiling).status),
    ).map((x) => ({ id: String(x.id), doc: x.doc, status: x.status, available: typeof x.available === "string" ? x.available : null }));
    if (ok.length) out[id] = ok;
  }
  return out;
}

/** A later filing with its official address (from `filings`, http or https only) when the file has one. */
export type LaterLink = { doc: string; status: LaterFiling["status"]; available: string | null; url: string | null };

export type AmendmentView = {
  /** One entry per later filing document, oldest first (a filing that appears twice is listed once). */
  later: LaterLink[];
  /** A later filing marks the transaction Deleted. The trade stays published. */
  deleted: boolean;
  /** Both dates are present and no elapsed days are given: a later filing corrected the transaction date. */
  dateCorrected: boolean;
  /** The trade is flagged amended (by the dataset's versions or a marked House reprint). */
  amended: boolean;
};

type TradeLike = { id: string; amended: boolean; date: string | null; available: string | null; lag_days: number | null };

/** What a row's later filings say. `filings` is the file's filing id to URL map. */
export function amendmentView(t: TradeLike, map: AmendmentMap, filings: { [doc: string]: string } | undefined): AmendmentView {
  const seen = new Set<string>();
  const later: LaterLink[] = [];
  for (const a of map[t.id] ?? []) {
    if (seen.has(`${a.doc}|${a.status}`)) continue;
    seen.add(`${a.doc}|${a.status}`);
    later.push({ doc: a.doc, status: a.status, available: a.available, url: safeHttpUrl(filings?.[a.doc]) });
  }
  const deleted = (map[t.id] ?? []).some((a) => a.status === "Deleted");
  return { later, deleted, dateCorrected: t.lag_days === null && Boolean(t.date) && Boolean(t.available) && t.amended, amended: t.amended };
}

/** CSV cell: "Amended 2024-03-02 (doc 123); Deleted 2024-04-01 (doc 456)"; null when the trade has no later filing. */
export function laterFilingsText(list: readonly LaterFiling[] | undefined): string | null {
  if (!list?.length) return null;
  return list.map((a) => `${AMEND.statusWord[a.status]}${a.available ? ` ${a.available.slice(0, 10)}` : ""} (filing ${a.doc})`).join("; ");
}

/** Space-separated official addresses of the later filings (http or https only); null when there are none. */
export function laterFilingUrls(list: readonly LaterFiling[] | undefined, filings: TradeFile["filings"] | undefined): string | null {
  const urls = [...new Set((list ?? []).map((a) => safeHttpUrl(filings?.[a.doc])).filter((u): u is string => Boolean(u)))];
  return urls.length ? urls.join(" ") : null;
}

/** The part of a trade file's amendments map that the given trades use, with the filing addresses of those later filings. */
export function amendmentsFor(file: { amendments?: unknown; filings?: { [doc: string]: string }; not_counted?: unknown } | null | undefined, ids: readonly string[]): { map: AmendmentMap; filings: { [doc: string]: string }; marked: boolean } {
  const all = readAmendments(file);
  const map: AmendmentMap = {};
  const filings: { [doc: string]: string } = {};
  for (const id of ids) {
    if (!all[id]) continue;
    map[id] = all[id];
    for (const a of all[id]) if (file?.filings?.[a.doc]) filings[a.doc] = file.filings[a.doc];
  }
  // `marked`: the file says which rows are not counted (builds after 2026-11-25), so a Deleted printing alone does not mean the trade is deleted.
  return { map, filings, marked: file?.not_counted !== undefined };
}

/** The member has trade rows to list: `listed` (counted + not counted) when the build says it, else `count`. Gates every read of trades/<id>.json. */
export function hasListedTrades(ts: { count?: number; listed?: number } | null | undefined): boolean {
  return (ts?.listed ?? ts?.count ?? 0) > 0;
}
