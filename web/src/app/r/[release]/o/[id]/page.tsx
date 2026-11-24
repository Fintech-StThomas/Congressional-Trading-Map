// Permalink of an organisation page in one data release: /r/<release id>/o/<id>. Pinned mode only (404 otherwise).
// The release is checked against the release list on the server (same allow-list as the member permalink); the ties
// themselves are read in the browser from that release's organisation shard (the page pins the browser to it). An
// unavailable release or an organisation the release does not hold is a 404, never the latest data. Not indexed.
import { BuildFlagsProvider } from "@/components/shared/CiteEnv";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permalinkOrgData } from "@/lib/data/permalink";
import { conduitsExcluded, sourceNames, metaBuilt } from "@/lib/data/meta";
import { PERMALINK } from "@/lib/copy-permalink";
import { orgHref } from "@/lib/urls";
import { OrgView } from "@/components/org/OrgView";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ReleaseBanner } from "@/components/shared/ReleaseBanner";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

type Props = { params: Promise<{ release: string; id: string }> };

export const dynamicParams = true;
// Re-run the availability check (the release list) at most every five minutes, so a withdrawn release stops being served.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

/** The id as the browser sent it: Next may hand the segment over still percent-encoded (co%3A320193). */
function orgIdOf(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { release, id: raw } = await params;
  const id = orgIdOf(raw);
  const data = await permalinkOrgData(release, id);
  const o = data && (await data.getOrgIndex()).get(id);
  return o ? { title: PERMALINK.org.titleOf(o.name), robots: { index: false }, alternates: { canonical: orgHref(id) } } : {};
}

export default async function ReleaseOrgPage({ params }: Props) {
  const { release, id: raw } = await params;
  const id = orgIdOf(raw);
  const data = await permalinkOrgData(release, id);
  if (!data) notFound();
  const meta = await data.getMeta();
  return (
    <>
      <ReleasePin release={data.release} />
      <div className="page page--narrow">
        <ReleaseBanner release={release} built={metaBuilt(meta)} latestHref={orgHref(id)} body={PERMALINK.orgBannerBody} />
      </div>
      <ErrorBoundary label="organisation page">
        <BuildFlagsProvider conduitsExcluded={conduitsExcluded(meta)}><OrgView sources={sourceNames(meta)} id={id} release={release} /></BuildFlagsProvider>
      </ErrorBoundary>
    </>
  );
}
