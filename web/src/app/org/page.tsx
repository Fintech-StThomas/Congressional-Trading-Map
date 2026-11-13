import type { Metadata } from "next";
import { getMeta } from "@/lib/data";
import { sourceNames } from "@/lib/meta";
import { OrgView } from "@/components/OrgView";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Served for every /o/<id> through a rewrite in next.config.ts: one static
// shell, filled in the browser from the organisation's shard.
export const metadata: Metadata = { title: "Organisation" };

export default function OrgPage() {
  return (
    <ErrorBoundary label="organisation page">
      <OrgView sources={sourceNames(getMeta())} />
    </ErrorBoundary>
  );
}
