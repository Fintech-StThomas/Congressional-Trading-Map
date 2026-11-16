// /export: the research export tool. One static shell; the member and kinds are chosen in the browser. Not indexed.
import type { Metadata } from "next";
import { EXPORT } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { metaBuilt, metaSources } from "@/lib/data/meta";
import { ExportView } from "@/components/export/ExportView";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export const metadata: Metadata = {
  title: EXPORT.title,
  description: EXPORT.lede,
  robots: { index: false, follow: true },
};

export default async function ExportPage() {
  const data = await latestData();
  const meta = await data.getMeta();
  const sources = metaSources(meta).map((s) => ({ id: s.id, name: s.name ?? s.id, url: s.url ?? null, revision: s.revision ?? null, retrieved: s.retrieved ?? null }));
  return (
    <>
      <ReleasePin release={data.release} />
      <ErrorBoundary label="research export">
        <ExportView release={data.release} built={metaBuilt(meta)} sources={sources} />
      </ErrorBoundary>
    </>
  );
}
