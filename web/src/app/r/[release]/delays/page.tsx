// Permalink of the disclosure-timing page in one data release: /r/<release id>/delays. Pinned mode only (404 otherwise).
// Built exactly like the latest page from that release's delays.json; same release-list check as the member permalink;
// an unavailable release is a 404, never the latest data. Not indexed; the canonical page is /delays.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permalinkData } from "@/lib/data/permalink";
import { DELAYS } from "@/lib/copy";
import { delaysHref } from "@/lib/urls";
import { DelaysView } from "@/components/delays/DelaysView";

type Props = { params: Promise<{ release: string }> };

export const dynamicParams = true;
// Re-run the availability check (the release list) at most every five minutes, so a withdrawn release stops being served.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { release } = await params;
  const data = await permalinkData(release);
  return data ? { title: DELAYS.title, description: DELAYS.description, robots: { index: false }, alternates: { canonical: delaysHref() } } : {};
}

export default async function ReleaseDelaysPage({ params }: Props) {
  const { release } = await params;
  const data = await permalinkData(release);
  if (!data) notFound();
  return <DelaysView data={data} pinned />;
}
