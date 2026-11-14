// Remote data mode only: /m/<id>/records is rewritten here (see app/live/m/[id]/page.tsx).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE } from "@/lib/data/server";
import RecordsPage, { generateMetadata as recordsMetadata } from "../../../../m/[id]/records/page";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return IS_REMOTE ? recordsMetadata(props as PageProps<"/m/[id]/records">) : {};
}

export default function LiveRecordsPage(props: Props) {
  if (!IS_REMOTE) notFound();
  return <RecordsPage {...(props as PageProps<"/m/[id]/records">)} />;
}
