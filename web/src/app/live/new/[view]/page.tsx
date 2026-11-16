// Remote data modes only: /new is rewritten here so the page is built on first request and revalidated hourly (ISR),
// with no build-time bucket reads (see app/live/m/[id]/page.tsx for why a twin exists).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE } from "@/lib/data/server";
import { metadata as newMetadata } from "../../../new/page";
import { NewPageBody } from "@/components/new/NewPageBody";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export const metadata: Metadata = newMetadata;

export default async function LiveNewPage({ params }: { params: Promise<{ view: string }> }) {
  if (!IS_REMOTE || (await params).view !== "week") notFound();
  return <NewPageBody />;
}
