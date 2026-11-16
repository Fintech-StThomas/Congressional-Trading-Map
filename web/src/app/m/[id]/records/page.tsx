// /m/<id>/records, "the full file", for the latest data. The body is components/records/RecordsPageView.tsx,
// shared with the live twin and the release permalink.
import type { Metadata } from "next";
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { RecordsPageView, recordsMetadata } from "@/components/records/RecordsPageView";

// Every path is prerendered from local data and other paths are 404s. In the remote modes (DATA_BASE_URL or
// RELEASE_BASE_URL) nothing is prerendered here: next.config.ts rewrites this URL to the on-demand twin under
// app/live/m/[id]/records (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return (await (await latestData()).getMembers()).map((m) => ({ id: m.id }));
}

export async function generateMetadata({ params }: PageProps<"/m/[id]/records">): Promise<Metadata> {
  const { id } = await params;
  return recordsMetadata(await latestData(), id, false);
}

export default async function RecordsPage({ params }: PageProps<"/m/[id]/records">) {
  const { id } = await params;
  return <RecordsPageView data={await latestData()} id={id} pinned={false} />;
}
