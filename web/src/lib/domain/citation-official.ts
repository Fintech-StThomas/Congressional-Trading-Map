// The official record a citation leads with: the House Clerk filing DocID, the FEC committee or candidate id, read from
// the record links and ids the packet already holds (nothing is fetched, nothing guessed from names). The dataset that
// extracted the rows is named second ("as extracted by ..."). Pure; tests/citation.test.mjs loads it directly.
import { safeHttpUrl } from "../urls.ts";

export type Official = { house_clerk_doc_ids: string[]; fec_committee_ids: string[]; fec_candidate_ids: string[]; urls: string[] };

export const NO_OFFICIAL: Official = { house_clerk_doc_ids: [], fec_committee_ids: [], fec_candidate_ids: [], urls: [] };

const HOUSE_DOC = /^https?:\/\/disclosures-clerk\.house\.gov\/.*?(\d{5,})\.pdf(?:[?#].*)?$/i;
const COMMITTEE = /\bC\d{8}\b/;
const COMMITTEE_ALL = /\bC\d{8}\b/g;
const CANDIDATE = /\b[HSP]\d[A-Z]{2}\d{5}\b|\bP\d{8}\b/; // House, Senate or presidential candidate id

const uniq = (xs: string[]) => [...new Set(xs)].sort();

/** Official ids found in evidence links (a Clerk PDF's DocID; a committee or candidate id in an fec.gov address) and `ids`: the tie's via and end ids, where a committee shows as pac:C00123456 (a PAC that is the giver has no via). */
export function officialFromEvidence(evidence: readonly { url: string | null }[], ids: readonly (string | null | undefined)[] = []): Official {
  const docs: string[] = [], committees: string[] = [], candidates: string[] = [], urls: string[] = [];
  for (const e of evidence) {
    const u = safeHttpUrl(e.url);
    if (!u) continue;
    const d = HOUSE_DOC.exec(u);
    if (d) docs.push(d[1]);
    if (/^https?:\/\/([a-z0-9-]+\.)*fec\.gov\//i.test(u)) {
      const c = COMMITTEE.exec(u), k = CANDIDATE.exec(u);
      if (c) committees.push(c[0]);
      if (k) candidates.push(k[0]);
    }
    urls.push(u);
  }
  for (const id of ids) if (id) committees.push(...(id.match(COMMITTEE_ALL) ?? []));
  return { house_clerk_doc_ids: uniq(docs), fec_committee_ids: uniq(committees), fec_candidate_ids: uniq(candidates), urls: uniq(urls) };
}

/** Official ids of a page or table: numeric filing ids are House Clerk DocIDs (Senate filings carry other ids and are not claimed); the member's FEC candidate ids. */
export function officialFromIds(filingDocs: readonly string[], fecCandidateIds: readonly string[] = []): Official {
  return { ...NO_OFFICIAL, house_clerk_doc_ids: uniq(filingDocs.filter((d) => /^\d{5,}$/.test(d))), fec_candidate_ids: uniq(fecCandidateIds.filter((k) => CANDIDATE.test(k))) };
}

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

export type SourceName = { id: string; name: string };

/** Which official body a dataset extracts from: the trades dataset reads House Clerk filings, the FEC datasets read FEC filings. */
const isFecSource = (s: SourceName) => /fec/i.test(`${s.id} ${s.name}`);
const isTradeSource = (s: SourceName) => /ptr|trade|periodic/i.test(`${s.id} ${s.name}`) && !isFecSource(s);

/** "House Clerk DocID 8217394, as extracted by <trades dataset>; FEC committee C00123456, as extracted by <FEC dataset>"; null when no official id is known. Each id is attributed to its own source. */
export function officialLine(o: Official, sources: readonly SourceName[]): string | null {
  const by = (pick: (s: SourceName) => boolean) => {
    const names = [...new Set(sources.filter(pick).map((s) => s.name))];
    return names.length ? `, as extracted by ${names.join("; ")}` : "";
  };
  const parts = [
    o.house_clerk_doc_ids.length ? `House Clerk ${o.house_clerk_doc_ids.length === 1 ? "DocID" : "DocIDs"} ${list(o.house_clerk_doc_ids)}${by(isTradeSource)}` : "",
    o.fec_committee_ids.length ? `FEC ${o.fec_committee_ids.length === 1 ? "committee" : "committees"} ${list(o.fec_committee_ids)}${by(isFecSource)}` : "",
    o.fec_candidate_ids.length ? `FEC ${o.fec_candidate_ids.length === 1 ? "candidate" : "candidates"} ${list(o.fec_candidate_ids)}${by(isFecSource)}` : "",
  ].filter(Boolean);
  return parts.length ? `Official record: ${parts.join("; ")}` : null;
}
