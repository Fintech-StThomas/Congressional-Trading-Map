// Remote data mode only (DATA_BASE_URL): next.config.ts rewrites /m/<id> here, so member pages render on
// first request and are revalidated with the data (ISR) instead of being prerendered for every member.
// Route segment config must be a literal, hence a twin route rather than a switch in app/m/[id].
// Without DATA_BASE_URL nothing links here and every path is a 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE } from "@/lib/data/server";
import MemberPage, { generateMetadata as memberMetadata } from "../../../m/[id]/page";

type Props = { params: Promise<{ id: string }> };

export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return IS_REMOTE ? memberMetadata(props as PageProps<"/m/[id]">) : {};
}

export default function LiveMemberPage(props: Props) {
  if (!IS_REMOTE) notFound();
  return <MemberPage {...(props as PageProps<"/m/[id]">)} />;
}
