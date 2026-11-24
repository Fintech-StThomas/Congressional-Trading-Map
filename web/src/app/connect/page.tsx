// /connect: documented connections between two members or organisations. One static shell, filled in the browser;
// the query (?a=&b=) is read there. Not indexed: the page is a tool, and each result depends on the query.
import { BuildFlagsProvider } from "@/components/shared/CiteEnv";
import type { Metadata } from "next";
import { CONNECT } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { conduitsExcluded, sourceNames } from "@/lib/data/meta";
import { ConnectView } from "@/components/connect/ConnectView";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";

export const metadata: Metadata = {
  title: CONNECT.title,
  description: CONNECT.description,
  robots: { index: false, follow: true },
};

export default async function ConnectPage() {
  const data = await latestData();
  const meta = await data.getMeta();
  return (
    <>
      <ReleasePin release={data.release} />
      <ErrorBoundary label="connection finder">
        <BuildFlagsProvider conduitsExcluded={conduitsExcluded(meta)}><ConnectView sources={sourceNames(meta)} /></BuildFlagsProvider>
      </ErrorBoundary>
    </>
  );
}
