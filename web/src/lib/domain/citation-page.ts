// Citation packets for the two pages that are not about one member: an organisation's ties and the disclosure-timing
// page. Same packet shape as citation.ts (so the same text, JSON and Cite control); the permanent link is offered only
// when the page was served from an archived release, exactly as for members. Pure; tests/citation-page.test.mjs loads it.
import { PERMALINK } from "../copy-permalink.ts";
import { delaysHref, orgHref, releaseDelaysHref, releaseOrgHref } from "../urls.ts";
import { officialFromEvidence } from "./citation-official.ts";
import { base, CITATION_SCHEMA, links, NO_IDS, sourceRefs, validRelease, type Citation, type CiteEnv } from "./citation.ts";

const none = (): Citation["filters"] => ({ years: null, assumptions: null, table: [], rows_shown: null, rows_total: null });

/** An organisation's page: who it is, how many members are tied, and the member filter and rows in view. */
export function buildOrgCitation(p: {
  org: { id: string; name: string };
  env: CiteEnv;
  counts: Record<string, number | null>;
  dates: { first: string | null; last: string | null };
  /** The member search in effect, and the rows it leaves of the rows the file lists. */
  view?: { query: string; shown: number; total: number };
}): Citation {
  const { org, env } = p;
  const q = p.view?.query.trim() ?? "";
  const filtered = p.view && (q !== "" || p.view.shown !== p.view.total);
  return {
    schema: CITATION_SCHEMA,
    title: PERMALINK.org.citeTitle(org.name),
    kind: "org",
    subject: { members: [], orgs: [org] },
    official: officialFromEvidence([], [org.id]),
    identifiers: NO_IDS,
    evidence: [],
    sources: sourceRefs(env, null),
    dates: { first: p.dates.first, last: p.dates.last, evidence: [] },
    amount: null,
    amount_in_years: null,
    counts: p.counts,
    ...base(env),
    filters: filtered && p.view
      ? { ...none(), table: q ? [{ column: "Member", value: q }] : [], rows_shown: p.view.shown, rows_total: p.view.total }
      : none(),
    limitations: [...PERMALINK.org.limits],
    ledger_only: false,
    ledger_note: null,
    ...links(validRelease(env.release), { latest: orgHref(org.id), pinned: (r) => releaseOrgHref(r, org.id) }, ""),
  };
}

/** The disclosure-timing page: the site-wide counts it is built from. */
export function buildDelaysCitation(p: { env: CiteEnv; counts: Record<string, number | null> }): Citation {
  const { env } = p;
  return {
    schema: CITATION_SCHEMA,
    title: PERMALINK.delays.citeTitle,
    kind: "delays",
    subject: { members: [], orgs: [] },
    official: officialFromEvidence([], []),
    identifiers: NO_IDS,
    evidence: [],
    sources: sourceRefs(env, null),
    dates: { first: null, last: null, evidence: [] },
    amount: null,
    amount_in_years: null,
    counts: p.counts,
    ...base(env),
    filters: none(),
    limitations: [...PERMALINK.delays.limits],
    ledger_only: false,
    ledger_note: null,
    ...links(validRelease(env.release), { latest: delaysHref(), pinned: releaseDelaysHref }, ""),
  };
}

