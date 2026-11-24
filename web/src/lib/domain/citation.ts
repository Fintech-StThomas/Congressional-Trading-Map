// Citation packets: a plain JSON record of what a reader is looking at (one tie with its evidence, a member's case
// file, the full file or one of its tables) with enough to find it again: stable ids, official source links, dates
// as filed, the amounts exactly as displayed with the disclosed range behind them, the data release and build,
// filters and assumptions in effect, the method version and the coverage limits. Built in the browser from data
// already on the page; nothing is sent anywhere. `permanent` is a link only when a data release is known.
// Pure (the retrieval time is passed in); tests/citation.test.mjs loads it directly.
import type { Amount, Edge } from "../types.ts";
import { CITE, SITE } from "../copy.ts";
import { amountText, date, NOT_DISCLOSED, releaseShort } from "../format.ts";
import { METHOD_VERSION } from "../method.ts";
import { isReleaseId } from "../data/release.ts";
import { memberHref, recordsHref, releaseMemberHref, releaseRecordsHref, safeHttpUrl, siteUrl } from "../urls.ts";
import { YEAR_MAX, YEAR_MIN } from "../years.ts";
import { encodeAssumptions, isDefault, type Assumptions } from "./assume.ts";
import { filteredAmount, typeLabel } from "./edges.ts";
import { NO_OFFICIAL, officialFromEvidence, officialFromIds, officialLine, type Official } from "./citation-official.ts";

export const CITATION_SCHEMA = "paper-trail.citation/1";
/** Record ids listed in a table citation; beyond this the packet says it is truncated. */
export const MAX_IDS = 500;

export type SourceRef = { id: string; name: string; url?: string | null; revision?: string | null; retrieved?: string | null };

/** What every citation needs from the page: the release (null when unknown), the build time, the retrieval time. */
export type CiteEnv = {
  release: string | null;
  built: string | null;
  /** ISO timestamp of when the citation was made; passed in so the builders stay pure. */
  retrieved: string;
  sources?: SourceRef[];
};

export type AmountBlock = { displayed: string; low: number | null; high: number | null; exact: number | null; open_ended: boolean; disclosed: boolean };

export type Citation = {
  schema: typeof CITATION_SCHEMA;
  title: string;
  kind: "tie" | "member" | "records" | "table" | "org" | "delays";
  subject: { members: { id: string; name: string }[]; orgs: { id: string; name: string }[] };
  /** The official record ids and addresses, listed first: the sources below are the datasets that extracted the rows. */
  official: Official;
  identifiers: { edge_ids: string[]; evidence_records: string[]; trade_ids: string[]; filing_docs: string[]; evidence_total: number | null; truncated: boolean };
  evidence: { record: string | null; label: string; date: string | null; source: string; source_name: string; url: string | null }[];
  sources: { id: string; name: string; url: string | null; revision: string | null; retrieved: string | null }[];
  dates: { first: string | null; last: string | null; evidence: string[] };
  amount: (AmountBlock & { by_year: { y: number; n: number; low: number | null; high: number | null; exact: number | null }[] }) | null;
  amount_in_years: (AmountBlock & { records: number }) | null;
  counts: Record<string, number | null>;
  data: { release: string | null; built: string | null };
  retrieved: string;
  filters: {
    years: [number, number] | null;
    assumptions: { param: string; default: boolean; settings: Assumptions } | null;
    table: { column: string; value: string }[];
    rows_shown: number | null;
    rows_total: number | null;
  };
  method_version: string;
  limitations: string[];
  ledger_only: boolean;
  ledger_note: string | null;
  links: { permanent: string | null; latest: string };
  permanence_note: string | null;
  disclaimer: string;
};

// ---------------------------------------------------------------- pieces

/** An amount as displayed, with the disclosed numbers behind it. Never a midpoint; missing stays null and reads "not disclosed". */
export function amountBlock(a: Amount): AmountBlock {
  const text = amountText(a);
  return {
    displayed: text ?? NOT_DISCLOSED,
    low: a.low ?? null, high: a.high ?? null, exact: a.exact ?? null,
    open_ended: a.exact == null && a.low != null && a.high == null,
    disclosed: text !== null,
  };
}

const asQuery = (a: Assumptions | null | undefined) => (a && !isDefault(a) ? `?as=${encodeAssumptions(a)}` : "");

/** The permanent link exists only when a data release is known; the latest link always does. */
export function links(release: string | null, path: { latest: string; pinned: ((r: string) => string) | null }, query: string): Pick<Citation, "links" | "permanence_note"> {
  const permanent = release && path.pinned ? siteUrl(path.pinned(release) + query) : null;
  return { links: { permanent, latest: siteUrl(path.latest + query) }, permanence_note: permanent ? null : CITE.noPermanent };
}

export const validRelease = (r: string | null | undefined): string | null => (isReleaseId(r) ? r : null);

function uniqueSorted(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();
}

export function sourceRefs(env: CiteEnv, ids: string[] | null): Citation["sources"] {
  const all = env.sources ?? [];
  const pick = ids ? ids.map((id) => all.find((s) => s.id === id) ?? { id, name: id }) : all;
  return pick.map((s) => ({ id: s.id, name: s.name, url: safeHttpUrl(s.url ?? null), revision: s.revision ?? null, retrieved: s.retrieved ?? null }));
}

export const base = (env: CiteEnv) => ({
  data: { release: validRelease(env.release), built: env.built },
  retrieved: env.retrieved,
  method_version: METHOD_VERSION,
  disclaimer: SITE.disclaimer,
});

export const NO_IDS: Citation["identifiers"] = { edge_ids: [], evidence_records: [], trade_ids: [], filing_docs: [], evidence_total: null, truncated: false };

// ---------------------------------------------------------------- a tie and its evidence

export function buildTieCitation(p: {
  edge: Edge; names: { from: string; to: string }; env: CiteEnv; range?: [number, number] | null; limitations: string[]; ledgerOnly: boolean;
}): Citation {
  const { edge, env } = p;
  const ends = [{ n: edge.from, name: p.names.from }, { n: edge.to, name: p.names.to }];
  const members = ends.filter((e) => e.n.kind === "member").map((e) => ({ id: e.n.id, name: e.name }));
  const orgs = ends.filter((e) => e.n.kind === "org").map((e) => ({ id: e.n.id, name: e.name }));
  const names = Object.fromEntries((env.sources ?? []).map((s) => [s.id, s.name]));
  const range = p.range && (p.range[0] > YEAR_MIN || p.range[1] < YEAR_MAX) ? p.range : null;
  const inRange = range ? filteredAmount(edge, range) : null;
  const release = validRelease(env.release);
  const member = members[0]?.id ?? null;
  const evidence = edge.evidence.map((ev) => ({
    record: ev.record ?? null, label: ev.label, date: ev.date ?? null, source: ev.source,
    source_name: names[ev.source] ?? ev.source, url: safeHttpUrl(ev.url),
  }));
  return {
    schema: CITATION_SCHEMA,
    title: `${typeLabel(edge)}: ${p.names.from} ${edge.directed ? "to" : "and"} ${p.names.to}`,
    kind: "tie",
    subject: { members, orgs },
    official: officialFromEvidence(edge.evidence, [edge.via?.id, edge.from.id, edge.to.id]),
    identifiers: { ...NO_IDS, edge_ids: [edge.id], evidence_records: uniqueSorted(edge.evidence.map((e) => e.record)), evidence_total: edge.evidence_total },
    evidence,
    sources: sourceRefs(env, uniqueSorted(edge.evidence.map((e) => e.source))),
    dates: { first: edge.first ?? null, last: edge.last ?? null, evidence: uniqueSorted(edge.evidence.map((e) => e.date)) },
    amount: { ...amountBlock(edge.amount), by_year: edge.by_year.map((b) => ({ y: b.y, n: b.n, low: b.low ?? null, high: b.high ?? null, exact: b.exact ?? null })) },
    amount_in_years: inRange ? { ...amountBlock(inRange), records: inRange.n } : null,
    counts: { records: edge.count },
    ...base(env),
    filters: { years: range, assumptions: null, table: [], rows_shown: null, rows_total: null },
    limitations: p.limitations,
    ledger_only: p.ledgerOnly,
    ledger_note: p.ledgerOnly ? CITE.ledgerOnlyNote : null,
    ...links(release, { latest: member ? memberHref(member) : "/", pinned: member ? (r) => releaseMemberHref(r, member) : null }, ""),
  };
}

// ---------------------------------------------------------------- a member's case file, the full file, one table

export type ViewInput = {
  kind: "member" | "records" | "table";
  member: { id: string; name: string };
  env: CiteEnv;
  limitations: string[];
  /** The `?as=` switches in effect (case file only). */
  assumptions?: Assumptions | null;
  counts?: Record<string, number | null>;
  /** The member's FEC candidate ids (member file `fec_ids`), cited as official ids. */
  fec_candidate_ids?: string[];
  official?: Official;
  dates?: { first: string | null; last: string | null };
  table?: { title: string; filters: { column: string; value: string }[]; shown: number; total: number; ids?: { edge_ids?: string[]; trade_ids?: string[]; filing_docs?: string[] } };
};

export function buildViewCitation(v: ViewInput): Citation {
  const { member, env } = v;
  const a = v.assumptions ?? null;
  const release = validRelease(env.release);
  const cap = (xs: string[] | undefined) => (xs ?? []).slice(0, MAX_IDS);
  const ids = v.table?.ids;
  const truncated = [ids?.edge_ids, ids?.trade_ids, ids?.filing_docs].some((xs) => (xs?.length ?? 0) > MAX_IDS);
  const title = v.kind === "member" ? `${member.name}: case file` : v.kind === "records" ? `${member.name}: the full file` : `${member.name}: ${v.table?.title ?? "table"} (full file)`;
  const onCaseFile = v.kind === "member";
  return {
    schema: CITATION_SCHEMA,
    title,
    kind: v.kind,
    subject: { members: [member], orgs: [] },
    official: v.official ?? officialFromIds(ids?.filing_docs ?? [], v.fec_candidate_ids),
    identifiers: { ...NO_IDS, edge_ids: cap(ids?.edge_ids), trade_ids: cap(ids?.trade_ids), filing_docs: cap(ids?.filing_docs), truncated },
    evidence: [],
    sources: sourceRefs(env, null),
    dates: { first: v.dates?.first ?? null, last: v.dates?.last ?? null, evidence: [] },
    amount: null,
    amount_in_years: null,
    counts: v.counts ?? {},
    ...base(env),
    filters: {
      years: null,
      assumptions: a ? { param: encodeAssumptions(a), default: isDefault(a), settings: a } : null,
      table: v.table?.filters ?? [],
      rows_shown: v.table?.shown ?? null,
      rows_total: v.table?.total ?? null,
    },
    limitations: v.limitations,
    ledger_only: false,
    ledger_note: null,
    ...links(release, onCaseFile ? { latest: memberHref(member.id), pinned: (r) => releaseMemberHref(r, member.id) } : { latest: recordsHref(member.id), pinned: (r) => releaseRecordsHref(r, member.id) }, onCaseFile ? asQuery(a) : ""),
  };
}

// ---------------------------------------------------------------- renderings

const list = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

/** The text a reporter can paste: who and what, amount as displayed, dates, sources, release, links, method, limits. */
export function citationText(c: Citation): string {
  const lines: string[] = [c.title];
  const subj = [...c.subject.members.map((m) => `${m.name} (member ${m.id})`), ...c.subject.orgs.map((o) => `${o.name} (organisation ${o.id})`)];
  if (subj.length) lines.push(`Subject: ${subj.join("; ")}`);
  if (c.amount) {
    const a = c.amount;
    const basis = !a.disclosed ? "no amount disclosed, not zero" : a.exact != null ? "whole dollars as filed; cents are not kept" : a.open_ended ? "open-ended disclosed range, no top stated" : "disclosed range, not a midpoint";
    lines.push(`Amount as displayed: ${a.displayed} (${basis})`);
    if (c.amount_in_years) lines.push(`Within ${c.filters.years?.[0]}–${c.filters.years?.[1]} only: ${c.amount_in_years.displayed}, ${c.amount_in_years.records} ${c.amount_in_years.records === 1 ? "record" : "records"}`);
  }
  const counts = Object.entries(c.counts).map(([k, v]) => `${v === null ? NOT_DISCLOSED : v.toLocaleString("en-US")} ${k.replace(/_/g, " ")}`);
  if (counts.length) lines.push(`Counts: ${counts.join(", ")}`);
  if (c.dates.first || c.dates.last) lines.push(`Dates as filed: first ${date(c.dates.first)}, latest ${date(c.dates.last)}`);
  const ids = [
    c.identifiers.edge_ids.length ? `tie ${list(c.identifiers.edge_ids)}` : "",
    c.identifiers.evidence_records.length ? `filed records ${list(c.identifiers.evidence_records)}${c.identifiers.evidence_total != null && c.identifiers.evidence_total > c.identifiers.evidence_records.length ? ` (${c.identifiers.evidence_records.length} of ${c.identifiers.evidence_total} listed)` : ""}` : "",
    c.identifiers.trade_ids.length ? `trades ${list(c.identifiers.trade_ids, 4)}` : "",
    c.identifiers.filing_docs.length ? `filings ${list(c.identifiers.filing_docs, 4)}` : "",
  ].filter(Boolean);
  if (ids.length) lines.push(`Identifiers: ${ids.join("; ")}${c.identifiers.truncated ? ` (first ${MAX_IDS} of each; the JSON packet is truncated the same way)` : ""}`);
  const names = c.sources.map((s) => s.name);
  // The official record leads; the dataset that extracted the rows comes second.
  const official = officialLine(c.official ?? NO_OFFICIAL, c.sources);
  if (official) lines.push(official);
  else if (names.length) lines.push(`Extracted by: ${[...new Set(names)].join("; ")}`);
  const urls = [...new Set(c.evidence.map((e) => e.url).filter((u): u is string => Boolean(u)))];
  if (urls.length) lines.push(`Official records: ${urls.join(" ")}`);
  else if (c.kind === "tie" && !c.ledger_only) lines.push("Official records: no public link for the listed records");
  const f = c.filters;
  const flt: string[] = [];
  if (f.years) flt.push(`years ${f.years[0]}–${f.years[1]}`);
  if (f.assumptions) flt.push(f.assumptions.default ? "assumptions: defaults (household, every trade)" : `assumptions: ${f.assumptions.param}`);
  for (const t of f.table) flt.push(`${t.column} contains “${t.value}”`);
  if (f.rows_total !== null) flt.push(`${f.rows_shown} of ${f.rows_total} rows`);
  if (flt.length) lines.push(`Filters: ${flt.join("; ")}`);
  const rel = c.data.release ? CITE.releaseText(releaseShort(c.data.release)) : CITE.noReleaseText;
  lines.push(CITE.attribution(rel, date(c.data.built), date(c.retrieved)));
  lines.push(c.links.permanent ? `Permanent link (fixed to this data release): ${c.links.permanent}` : c.permanence_note ?? "");
  lines.push(`Latest data (changes over time): ${c.links.latest}`);
  lines.push(`Method version: ${c.method_version}`);
  if (c.ledger_note) lines.push(c.ledger_note);
  for (const l of c.limitations) lines.push(`Limit: ${l}`);
  lines.push(c.disclaimer);
  return lines.filter((l) => l !== "").join("\n");
}

/** The structured packet as JSON, keys in the packet's fixed order. */
export function citationJson(c: Citation): string {
  return JSON.stringify(c, null, 2) + "\n";
}

/** A file name for the JSON download, from the ids in the packet: paper-trail-citation-<ids>.json. */
export function citationFilename(c: Citation): string {
  const part = c.kind === "tie" ? c.identifiers.edge_ids[0] : c.kind === "org" ? c.subject.orgs[0]?.id : c.kind === "delays" ? "delays" : c.subject.members[0]?.id;
  const extra = c.kind === "table" ? c.title.replace(/^.*?: /, "").replace(/ \(full file\)$/, "") : c.kind === "records" ? "full-file" : "";
  const raw = ["paper-trail-citation", c.kind === "tie" ? "tie" : "", part ?? "page", extra].filter(Boolean).join("-");
  return `${raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "")}.json`;
}
