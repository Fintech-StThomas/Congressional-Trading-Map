// /changes: compare one member's records between two archived data releases (?m=<member>&from=<release>&to=<release>).
// A static shell filled in the browser (like /org). Not indexed: the content depends on the query. The server only says
// whether this site is in pinned mode (archived releases exist to read); everything else happens in ChangesView.
import type { Metadata } from "next";
import { COMPARE } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { ChangesView } from "@/components/changes/ChangesView";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export const metadata: Metadata = {
  title: COMPARE.title,
  description: COMPARE.description,
  robots: { index: false },
};

export default async function ChangesPage() {
  const data = await latestData();
  return (
    <>
      <ReleasePin release={data.release} />
      <ErrorBoundary label="release comparison">
        <ChangesView pinned={data.release !== null} />
      </ErrorBoundary>
    </>
  );
}
