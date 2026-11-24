// Permalink of a member's case file in one data release: /r/<release id>/m/<id>. Pinned mode only (404 otherwise).
// The release is immutable, so the page is rendered on first request and kept; an unavailable release is a 404
// (app/r/[release]/not-found.tsx), never the latest data. Not indexed; the canonical link is the latest page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permalinkData } from "@/lib/data/permalink";
import { MemberPageView, memberMetadata } from "@/components/member/MemberPageView";

type Props = { params: Promise<{ release: string; id: string }> };

export const dynamicParams = true;
// Re-run the availability check (the release list) at most every five minutes, so a withdrawn release stops being served.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { release, id } = await params;
  const data = await permalinkData(release, id);
  return data ? memberMetadata(data, id, true) : {};
}

export default async function ReleaseMemberPage({ params }: Props) {
  const { release, id } = await params;
  const data = await permalinkData(release, id);
  if (!data) notFound();
  return <MemberPageView data={data} id={id} pinned />;
}
