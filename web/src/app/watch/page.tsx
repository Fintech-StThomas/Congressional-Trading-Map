// /watch: what this browser follows and the personal feed link. One static shell; the list is read from this browser's
// storage only. Not indexed: it has no public content of its own.
import type { Metadata } from "next";
import { WATCH } from "@/lib/copy-discovery";
import { latestData } from "@/lib/data/server";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { WatchView } from "@/components/watch/WatchView";

export const metadata: Metadata = { title: WATCH.title, description: WATCH.description, robots: { index: false, follow: false } };

export default async function WatchPage() {
  const data = await latestData();
  return (
    <>
      <ReleasePin release={data.release} />
      <WatchView />
    </>
  );
}
