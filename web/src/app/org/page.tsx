// The static shell behind every /o/<id> (see the rewrite in next.config.ts).
import type { Metadata } from "next";
import { getMeta } from "@/lib/data/server";
import { sourceNames } from "@/lib/data/meta";
import { OrgView } from "@/components/org/OrgView";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

// Served for every /o/<id> through a rewrite in next.config.ts: one static
// shell, filled in the browser from the organisation's shard.
export const metadata: Metadata = { title: "Organisation" };

export default async function OrgPage() {
  return (
    <ErrorBoundary label="organisation page">
      <OrgView sources={sourceNames(await getMeta())} />
    </ErrorBoundary>
  );
}
