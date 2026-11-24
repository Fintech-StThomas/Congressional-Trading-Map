// Permalink of a member's full file in one data release: /r/<release id>/m/<id>/records (see ../page.tsx).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permalinkData } from "@/lib/data/permalink";
import { RecordsPageView, recordsMetadata } from "@/components/records/RecordsPageView";

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
  return data ? recordsMetadata(data, id, true) : {};
}

export default async function ReleaseRecordsPage({ params }: Props) {
  const { release, id } = await params;
  const data = await permalinkData(release, id);
  if (!data) notFound();
  return <RecordsPageView data={data} id={id} pinned />;
}
