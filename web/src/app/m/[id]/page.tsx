// The member page ("case file") for the latest data. Built statically per member locally; the body is
// components/member/MemberPageView.tsx, shared with the live twin and the release permalink.
import type { Metadata } from "next";
import { IS_REMOTE, latestData } from "@/lib/data/server";
import { MemberPageView, memberMetadata } from "@/components/member/MemberPageView";

// Every path is prerendered from local data and other paths are 404s. In the remote modes (DATA_BASE_URL or
// RELEASE_BASE_URL) nothing is prerendered here: next.config.ts rewrites this URL to the on-demand twin under
// app/live/m/[id] (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  return (await (await latestData()).getMembers()).map((m) => ({ id: m.id }));
}

export async function generateMetadata({ params }: PageProps<"/m/[id]">): Promise<Metadata> {
  const { id } = await params;
  return memberMetadata(await latestData(), id, false);
}

export default async function MemberPage({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  return <MemberPageView data={await latestData()} id={id} pinned={false} />;
}
