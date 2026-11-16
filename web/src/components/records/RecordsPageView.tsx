// "The full file" for one data reader: a plain technical view of every record held for one member. Shared by
// /m/<id>/records (latest, with its live twin) and the permalink /r/<release>/m/<id>/records.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { metaBuilt, type Data } from "@/lib/data/server";
import { metaSources } from "@/lib/data/meta";
import { date, seat } from "@/lib/format";
import { memberHref, recordsHref, releaseMemberHref, releaseRecordsHref } from "@/lib/urls";
import { CORRECTIONS, RELEASE, SITE, USE_NOTICE } from "@/lib/copy";
import { RecordsView } from "@/components/records/RecordsView";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { CorrectionLink, CorrectionProvider } from "@/components/shared/CorrectionLink";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ReleaseBanner } from "@/components/shared/ReleaseBanner";
import "@/styles/records.css";

/** Page metadata; the full file is never indexed, and a permalink names the latest page as canonical. */
export async function recordsMetadata(data: Data, id: string, pinned: boolean): Promise<Metadata> {
  const m = (await data.getMemberIndex()).get(id);
  if (!m) return {};
  return {
    title: `${m.name}: the full file`,
    description: `Every record ${SITE.name} holds for ${m.name}, unfiltered, with CSV and JSON downloads.`,
    robots: { index: false },
    ...(pinned ? { alternates: { canonical: recordsHref(id) } } : {}),
  };
}

/** The full file: a deliberately plain, technical view of every record held for one member. */
export async function RecordsPageView({ data, id, pinned }: { data: Data; id: string; pinned: boolean }) {
  const file = await data.getMemberFile(id);
  if (!file) notFound();
  const m = file.member;
  const [meta, orgs, members, holdings] = await Promise.all([data.getMeta(), data.getOrgIndex(), data.getMemberIndex(), data.getHoldings(id)]);

  // Names for every ledger counterparty and via id (full-edge names come with the file).
  const names: Record<string, string> = {};
  const l = file.ledger as { cols?: string[]; rows?: unknown[][] } | undefined;
  if (l?.cols && l.rows) {
    const io = l.cols.indexOf("other"), iv = l.cols.indexOf("via");
    for (const r of l.rows) {
      for (const x of [r[io] as string, ((r[iv] as string | null) ?? "").replace(/:(support|oppose)$/, "")]) {
        if (!x || names[x] || file.nodes?.[x]) continue;
        const n = members.get(x)?.name ?? orgs.get(x)?.name;
        if (n) names[x] = n;
      }
    }
  }
  const sources = metaSources(meta).map((s) => ({
    id: s.id, name: typeof s.name === "string" ? s.name : s.id, revision: s.revision ? String(s.revision) : null,
    retrieved: s.retrieved ? String(s.retrieved) : null, url: typeof s.url === "string" ? s.url : null,
  }));
  const built = metaBuilt(meta);
  const hasHoldings = holdings !== null;
  const everHouse = m.terms.some((t) => t.chamber === "rep");

  const release = pinned ? data.release : null;

  const page = (
    <article className="page records" data-testid="records-page">
      <ReleasePin release={data.release} />
      {release && <ReleaseBanner release={release} built={built} latestHref={recordsHref(m.id)} />}
      <nav className="crumbs crumbs--page" aria-label="Breadcrumb">
        <Link href={release ? releaseMemberHref(release, m.id) : memberHref(m.id)}>{m.name}</Link> <span aria-hidden="true">/</span> <span aria-current="page">The full file</span>
      </nav>
      <h1>The full file: {m.name}</h1>
      <p className="records__seat mono">{seat(m)} · bioguide {m.id}{built ? ` · data built ${date(built)}` : ""}</p>
      <div className="records__what">
        <p><strong>What this is:</strong> every record {SITE.name} holds for this member, as filed and as published by its pipeline, in sortable tables with links to the official records. Nothing is summarised away and nothing is ranked.</p>
        <p><strong>What it is not:</strong> conclusions. A row is a filing, not a finding. For the readable version, go back to the <Link href={release ? releaseMemberHref(release, m.id) : memberHref(m.id)}>case file</Link>.</p>
      </div>
      <ErrorBoundary label="records">
        <RecordsView
          id={m.id}
          hasTrades={(file.trade_summary?.count ?? 0) > 0}
          hasHoldings={hasHoldings}
          everHouse={everHouse}
          names={names}
          sources={sources}
          built={built}
          pageUrl={release ? releaseRecordsHref(release, m.id) : recordsHref(m.id)}
          siteName={SITE.name}
        />
      </ErrorBoundary>
      <footer className="provenance">
        <p>Sources: {sources.map((s) => `${s.name}${s.revision ? ` (revision ${s.revision.slice(0, 24)})` : ""}${s.retrieved ? `, retrieved ${date(s.retrieved)}` : ""}`).join("; ")}.</p>
        <p>
          <CorrectionLink what={`the full file of ${m.name} (${m.id})`} details={[`Member: ${m.name} (bioguide ${m.id})`, "Record ids (from the table rows): "]} /> <span className="sub">· {CORRECTIONS.note}</span>
        </p>
        {release && <p className="mono">{RELEASE.provenance(release)}</p>}
        <p>{USE_NOTICE} Not investment advice.</p>
      </footer>
    </article>
  );
  return release ? <CorrectionProvider built={built}>{page}</CorrectionProvider> : page;
}
