// Remote data mode only: /m/<id>/records is rewritten here (see app/live/m/[id]/page.tsx).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE } from "@/lib/data/server";
import { isMemberId } from "@/lib/data/ids";
import RecordsPage, { generateMetadata as recordsMetadata } from "../../../../m/[id]/records/page";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  // A malformed id is a 404 before anything is fetched (next.config.ts only rewrites well-formed ids here).
  if (!IS_REMOTE || !isMemberId((await props.params).id)) return {};
  return recordsMetadata(props as PageProps<"/m/[id]/records">);
}

export default async function LiveRecordsPage(props: Props) {
  if (!IS_REMOTE || !isMemberId((await props.params).id)) notFound();
  return <RecordsPage {...(props as PageProps<"/m/[id]/records">)} />;
}
