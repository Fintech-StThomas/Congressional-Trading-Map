// The static shell behind every /o/<id> (see the rewrite in next.config.ts).
import { BuildFlagsProvider } from "@/components/shared/CiteEnv";
import type { Metadata } from "next";
import { latestData } from "@/lib/data/server";
import { conduitsExcluded, sourceNames } from "@/lib/data/meta";
import { OrgView } from "@/components/org/OrgView";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

// Served for every /o/<id> through a rewrite in next.config.ts: one static
// shell, filled in the browser from the organisation's shard.
export const metadata: Metadata = { title: "Organisation" };

export default async function OrgPage() {
  const data = await latestData();
  const meta = await data.getMeta();
  return (
    <>
      <ReleasePin release={data.release} />
      <ErrorBoundary label="organisation page">
        <BuildFlagsProvider conduitsExcluded={conduitsExcluded(meta)}><OrgView sources={sourceNames(meta)} /></BuildFlagsProvider>
      </ErrorBoundary>
    </>
  );
}
