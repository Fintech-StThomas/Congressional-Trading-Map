// "The full file": every record the site holds for one member, flattened into
// tables, plus CSV. Pure and free of runtime imports so tests can load it directly.
import type { Edge, MemberFileWire } from "./types";

export type Cell = string | number | boolean | null;
export type Col = { key: string; label: string; kind: "text" | "num" | "date" | "bool" | "links"; width?: number };
export type RecTable = { id: string; title: string; cols: Col[]; rows: Cell[][] };

export const USE_NOTICE =
  "Use is restricted by 5 U.S.C. 13107(c): it is unlawful to obtain or use a financial disclosure report for any unlawful purpose, for any commercial purpose other than by news and communications media for dissemination to the general public, for determining or establishing the credit rating of any individual, or for use, directly or indirectly, in the solicitation of money for any political, charitable or other purpose.";

/** A link to the official record that can be built from an id alone (as decode.ts recordUrlFor). */
export function idUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /^pac:(C\d{8})/.exec(id);
  if (m) return `https://www.fec.gov/data/committee/${m[1]}/`;
  const c = /^co:(\d+)$/.exec(id);
  if (c) return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c[1]}`;
  return null;
}

type Names = (id: string) => string;
type Wire = Pick<MemberFileWire, "member" | "edges" | "ledger" | "cases" | "coverage"> & { ledger_totals?: MemberFileWire["ledger_totals"] };
type TradeWire = { cols: string[]; rows: unknown[][]; filings: Record<string, string> } | null;

export const TIE_COLS: Col[] = [
  { key: "published", label: "Published as", kind: "text", width: 96 },
  { key: "type", label: "Type", kind: "text", width: 130 },
  { key: "basis", label: "Basis", kind: "text", width: 70 },
  { key: "counterparty", label: "Counterparty", kind: "text", width: 220 },
  { key: "counterparty_id", label: "Counterparty id", kind: "text", width: 130 },
  { key: "direction", label: "Direction", kind: "text", width: 80 },
  { key: "via", label: "Via", kind: "text", width: 150 },
  { key: "exact", label: "Exact $", kind: "num", width: 100 },
  { key: "low", label: "Low $", kind: "num", width: 100 },
  { key: "high", label: "High $", kind: "num", width: 100 },
  { key: "records", label: "Records", kind: "num", width: 76 },
  { key: "first", label: "First", kind: "date", width: 96 },
  { key: "last", label: "Last", kind: "date", width: 96 },
  { key: "weak", label: "Weak", kind: "bool", width: 60 },
  { key: "evidence", label: "Evidence attached", kind: "text", width: 90 },
  { key: "note", label: "Note", kind: "text", width: 160 },
  { key: "links", label: "Official record", kind: "links", width: 160 },
  { key: "edge_id", label: "Edge id", kind: "text", width: 110 },
];

function dir(self: string, from: string, to: string, directed: boolean): string {
  if (!directed) return "both";
  return to === self ? "in" : from === self ? "out" : "both";
}

/** Every tie: full edges (with their evidence links) and every ledger row. */
export function tieRows(file: Wire, name: Names): Cell[][] {
  const self = file.member.id;
  const rows: Cell[][] = [];
  for (const e of file.edges as Edge[]) {
    const o = e.from.id === self ? e.to : e.from;
    const links = [...new Set([...e.evidence.map((v) => v.url).filter(Boolean), idUrl(o.id), idUrl(e.via?.id)].filter(Boolean) as string[])];
    rows.push(["full edge", e.type, e.basis, name(o.id), o.id, dir(self, e.from.id, e.to.id, e.directed), e.via?.name ?? null,
      e.amount.exact, e.amount.low, e.amount.high, e.count, e.first, e.last, e.weak,
      `yes (${e.evidence.length} of ${e.evidence_total})`, e.note, links.join(" "), e.id]);
  }
  const l = file.ledger;
  if (l && Array.isArray(l.cols)) {
    const at = Object.fromEntries((l.cols as string[]).map((c, i) => [c, i]));
    for (const r of l.rows as unknown[][]) {
      const other = String(r[at.other]);
      const via = (r[at.via] as string | null) ?? null;
      const links = [idUrl(other), idUrl(via)].filter(Boolean) as string[];
      rows.push(["ledger row", r[at.type] as string, "filed", name(other), other, (r[at.dir] as string) ?? null, via ? name(via.replace(/:(support|oppose)$/, "")) : null,
        (r[at.exact] as number | null) ?? null, (r[at.low] as number | null) ?? null, (r[at.high] as number | null) ?? null,
        Number(r[at.count] ?? 0), (r[at.first] as string) ?? null, (r[at.last] as string) ?? null, false, "no",
        (r[at.note] as string | null) ?? null, [...new Set(links)].join(" "), null]);
    }
  }
  return rows;
}

export const TRADE_COLS_ALL: Col[] = [
  ["id", "Event id", "text", 110], ["version", "Version", "num", 70], ["amended", "Amended", "bool", 76], ["date", "Transaction date", "date", 100],
  ["available", "Public from", "date", 100], ["lag_days", "Lag days", "num", 70], ["late", "Late", "bool", 56], ["owner", "Owner", "text", 90],
  ["action", "Action", "text", 76], ["partial", "Partial", "bool", 64], ["ticker", "Ticker", "text", 76], ["ticker_source", "Ticker source", "text", 90],
  ["asset", "Asset as filed", "text", 260], ["asset_class", "Asset class", "text", 84], ["low", "Low $", "num", 90], ["high", "High $", "num", 90],
  ["org", "Org id", "text", 100], ["doc", "Filing id", "text", 110], ["url", "Filing", "links", 120],
].map(([key, label, kind, width]) => ({ key, label, kind, width }) as Col);

export function tradeRows(t: TradeWire): Cell[][] {
  if (!t) return [];
  const at = Object.fromEntries(t.cols.map((c, i) => [c, i]));
  const keys = TRADE_COLS_ALL.map((c) => c.key);
  return t.rows.map((r) => keys.map((k) => (k === "url" ? t.filings[String(r[at.doc])] ?? null : ((r[at[k]] ?? null) as Cell))));
}

export const DOC_COLS: Col[] = [
  { key: "url", label: "Document", kind: "links", width: 300 },
  { key: "type", label: "Type", kind: "text", width: 200 },
  { key: "date", label: "Date", kind: "date", width: 100 },
  { key: "rows", label: "Rows citing it", kind: "num", width: 100 },
  { key: "id", label: "Record id", kind: "text", width: 150 },
];

/** Every source document referenced anywhere in the member's data, de-duplicated by URL. */
export function documentRows(file: Wire, trades: TradeWire, sourceName: (id: string) => string): Cell[][] {
  const docs = new Map<string, { type: string; date: string | null; n: number; id: string | null }>();
  const add = (url: string | null | undefined, type: string, d: string | null, id: string | null) => {
    if (!url) return;
    const x = docs.get(url);
    if (x) {
      x.n++;
      if (d && (!x.date || d < x.date)) x.date = d;
    } else docs.set(url, { type, date: d, n: 1, id });
  };
  if (trades) {
    const at = Object.fromEntries(trades.cols.map((c, i) => [c, i]));
    for (const r of trades.rows) {
      const doc = String(r[at.doc]);
      add(trades.filings[doc], "Periodic transaction report", (r[at.available] as string | null) ?? null, doc);
    }
  }
  for (const e of file.edges as Edge[]) {
    for (const v of e.evidence) add(v.url, sourceName(v.source), v.date, v.record);
    for (const id of [e.from.id, e.to.id, e.via?.id]) add(idUrl(id), id?.startsWith("co:") ? "SEC company filings" : "FEC committee page", null, id ?? null);
  }
  const l = file.ledger;
  if (l && Array.isArray(l.cols)) {
    const at = Object.fromEntries((l.cols as string[]).map((c, i) => [c, i]));
    for (const r of l.rows as unknown[][])
      for (const id of [r[at.other] as string, r[at.via] as string | null]) add(idUrl(id), id?.startsWith("co:") ? "SEC company filings" : "FEC committee page", null, id ?? null);
  }
  return [...docs.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1)).map(([url, d]) => [url, d.type, d.date, d.n, d.id]);
}

/** Official pages for the member, built from ids. */
export function identifierLinks(m: Wire["member"]): { label: string; value: string; url: string | null }[] {
  const slug = `${m.first} ${m.last}`.toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-") || "member";
  const out = [
    { label: "Bioguide id", value: m.id, url: `https://bioguide.congress.gov/search/bio/${m.id}` },
    { label: "Congress.gov member page", value: m.id, url: `https://www.congress.gov/member/${slug}/${m.id}` },
  ];
  for (const f of m.fec_ids) out.push({ label: "FEC candidate", value: f, url: `https://www.fec.gov/data/candidate/${f}/` });
  const chambers = new Set(m.terms.map((t) => t.chamber));
  if (chambers.has("rep")) out.push({ label: "House Clerk financial disclosure search", value: "disclosures-clerk.house.gov", url: "https://disclosures-clerk.house.gov/FinancialDisclosure" });
  if (chambers.has("sen")) out.push({ label: "Senate eFD search", value: "efdsearch.senate.gov", url: "https://efdsearch.senate.gov/search/" });
  return out;
}

/** Every caveat that applies to this member's records, in plain words. */
export function caveats(file: Wire, trades: TradeWire): string[] {
  const out: string[] = ["Trade amounts are the disclosed ranges (low to high). No midpoint is stored or implied; a null high means “over” the low."];
  const lt = file.ledger_totals ?? {};
  const listed = Array.isArray(file.ledger?.rows) ? file.ledger.rows.length : 0;
  const total = Object.values(lt).reduce((n, t) => n + (t?.edges ?? 0), 0);
  if (!file.member.current && total > listed)
    out.push(`Former member: the ledger lists the ${listed.toLocaleString("en-US")} largest of ${total.toLocaleString("en-US")} further ties; ledger totals cover all of them.`);
  if (trades) {
    const at = Object.fromEntries(trades.cols.map((c, i) => [c, i]));
    const n = (f: (r: unknown[]) => boolean) => trades.rows.reduce<number>((s, r) => s + (f(r) ? 1 : 0), 0);
    const unspecified = n((r) => r[at.owner] === "unspecified");
    const noTicker = n((r) => r[at.ticker] == null);
    const noDate = n((r) => r[at.date] == null);
    const unknownClass = n((r) => r[at.asset_class] === "unknown");
    const amended = n((r) => r[at.amended] === true);
    if (unspecified) out.push(`${unspecified.toLocaleString("en-US")} trades have no owner stated on the filing; they are labelled “unspecified”, never assumed to be the member’s own.`);
    if (noTicker) out.push(`${noTicker.toLocaleString("en-US")} trades have no ticker; none is guessed.`);
    if (noDate) out.push(`${noDate.toLocaleString("en-US")} trades have no transaction date; their year comes from the date the report became public.`);
    if (unknownClass) out.push(`${unknownClass.toLocaleString("en-US")} trades have no asset type on the filing (“unknown”).`);
    if (amended) out.push(`${amended.toLocaleString("en-US")} trades were amended; only the current version is listed, with its version number.`);
  }
  const cov = file.coverage ?? [];
  if (cov.some((c) => c.trades === "none")) out.push("Some years served have no trade coverage (House filings in the trade dataset begin in 2014; nothing exists before July 2012).");
  if (cov.some((c) => c.trades === "partial")) out.push("Some years have partial trade coverage (a first part-year, the current year, or a filing that failed extraction).");
  if (cov.some((c) => c.money === "partial")) out.push("Some years have partial money coverage (Senate paper filings before 2019).");
  if (cov.some((c) => c.money === "none")) out.push("Some years have no money coverage (no FEC candidate id, or no loaded cycle).");
  if ((file.edges as Edge[]).some((e) => e.basis === "derived")) out.push("Statistical (derived) ties are not filed records: they meet a published rule against a shuffled baseline.");
  out.push("Committee assignments (shared committees) are the current Congress only.");
  return out;
}

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a header row. */
export function toCSV(cols: Col[], rows: Cell[][]): string {
  return [cols.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** Sort rows by column `i`: nulls last either way, numbers numerically. */
export function sortRows(rows: Cell[][], i: number, desc: boolean): Cell[][] {
  const s = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[i], y = b[i];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * s;
    return String(x) < String(y) ? -s : String(x) > String(y) ? s : 0;
  });
}

/**
 * Column filter: text contains (case-insensitive); for numbers also ">1000",
 * "<=50", "=0"; for booleans "yes"/"no".
 */
export function matches(v: Cell, q: string, kind: Col["kind"]): boolean {
  const s = q.trim();
  if (!s) return true;
  if (kind === "num") {
    const m = /^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/.exec(s);
    if (m) {
      if (typeof v !== "number") return false;
      const n = Number(m[2].replace(/,/g, ""));
      return m[1] === ">" ? v > n : m[1] === "<" ? v < n : m[1] === ">=" ? v >= n : m[1] === "<=" ? v <= n : v === n;
    }
  }
  if (kind === "bool") return (v === true ? "yes" : v === false ? "no" : "").startsWith(s.toLowerCase());
  if (v === null) return s === "-" || s.toLowerCase() === "null";
  return String(v).toLowerCase().includes(s.toLowerCase());
}

export function filterRows(rows: Cell[][], cols: Col[], filters: Record<number, string>): Cell[][] {
  const active = Object.entries(filters).filter(([, q]) => q.trim());
  if (!active.length) return rows;
  return rows.filter((r) => active.every(([i, q]) => matches(r[Number(i)], q, cols[Number(i)].kind)));
}
