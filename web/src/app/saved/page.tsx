// /saved: the reader's saved boards. One static shell; everything on it is read from this browser's storage (or from the
// share fragment in the address, which the server never sees). Not indexed: it has no public content of its own.
import type { Metadata } from "next";
import { SAVED } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { SavedView } from "@/components/saved/SavedView";

export const metadata: Metadata = {
  title: SAVED.title,
  description: SAVED.description,
  robots: { index: false, follow: false },
};

export default async function SavedPage() {
  const data = await latestData();
  return (
    <>
      <ReleasePin release={data.release} />
      <SavedView pinned={data.release !== null} />
    </>
  );
}
