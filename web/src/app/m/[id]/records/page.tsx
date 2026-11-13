import type { Metadata } from "next";
import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { DATA_DIR, getMemberFile, getMemberIndex, getMembers, getMeta, getOrgIndex, metaBuilt } from "@/lib/data";
import { metaSources } from "@/lib/meta";
import { date, seat } from "@/lib/format";
import { memberHref } from "@/lib/client";
import { SITE } from "@/lib/site";
import { USE_NOTICE } from "@/lib/records";
import { RecordsView } from "@/components/records/RecordsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "../../../records.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return getMembers().map((m) => ({ id: m.id }));
}

export async function generateMetadata({ params }: PageProps<"/m/[id]/records">): Promise<Metadata> {
  const { id } = await params;
  const m = getMemberIndex().get(id);
  if (!m) return {};
  return { title: `${m.name}: the full file`, description: `Every record ${SITE.name} holds for ${m.name}, unfiltered, with CSV and JSON downloads.`, robots: { index: false } };
}

/** The full file: a deliberately plain, technical view of every record held for one member. */
export default async function RecordsPage({ params }: PageProps<"/m/[id]/records">) {
  const { id } = await params;
  const file = getMemberFile(id);
  if (!file) notFound();
  const m = file.member;
  const meta = getMeta();
  const orgs = getOrgIndex();
  const members = getMemberIndex();

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
  const hasHoldings = existsSync(/*turbopackIgnore: true*/ join(DATA_DIR, "holdings", `${id}.json`));

  return (
    <article className="page records" data-testid="records-page">
      <nav className="crumbs crumbs--page" aria-label="Breadcrumb">
        <Link href={memberHref(m.id)}>{m.name}</Link> <span aria-hidden="true">/</span> <span aria-current="page">The full file</span>
      </nav>
      <h1>The full file: {m.name}</h1>
      <p className="records__seat mono">{seat(m)} · bioguide {m.id}{built ? ` · data built ${date(built)}` : ""}</p>
      <div className="records__what">
        <p><strong>What this is:</strong> every record {SITE.name} holds for this member, as filed and as published by its pipeline, in sortable tables with links to the official records. Nothing is summarised away and nothing is ranked.</p>
        <p><strong>What it is not:</strong> conclusions. A row is a filing, not a finding. For the readable version, go back to the <Link href={memberHref(m.id)}>case file</Link>.</p>
      </div>
      <ErrorBoundary label="records">
        <RecordsView
          id={m.id}
          hasTrades={(file.trade_summary?.count ?? 0) > 0}
          hasHoldings={hasHoldings}
          names={names}
          sources={sources}
          built={built}
          pageUrl={`/m/${m.id}/records`}
          siteName={SITE.name}
        />
      </ErrorBoundary>
      <footer className="provenance">
        <p>Sources: {sources.map((s) => `${s.name}${s.revision ? ` (revision ${s.revision.slice(0, 24)})` : ""}${s.retrieved ? `, retrieved ${date(s.retrieved)}` : ""}`).join("; ")}.</p>
        <p>{USE_NOTICE} Not investment advice.</p>
      </footer>
    </article>
  );
}
