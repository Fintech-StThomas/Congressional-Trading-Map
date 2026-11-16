// /new: trades made public in the 7 days to the data build date. Local mode: prerendered at build. Remote modes:
// next.config.ts rewrites /new to app/live/new/[view] (ISR, hourly) so the build reads nothing from the bucket here.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NEW } from "@/lib/copy-discovery";
import { IS_REMOTE } from "@/lib/data/server";
import { NewPageBody } from "@/components/new/NewPageBody";

export const metadata: Metadata = {
  title: NEW.title,
  description: NEW.description,
  alternates: { types: { "application/rss+xml": [{ url: "/feed/trades.xml", title: NEW.title }] } },
};

export default async function NewPage() {
  if (IS_REMOTE) notFound(); // never reached in remote modes (rewritten); answering without reads keeps the build from fetching
  return <NewPageBody />;
}
