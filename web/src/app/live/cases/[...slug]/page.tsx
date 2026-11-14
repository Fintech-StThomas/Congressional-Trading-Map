// Remote data mode only: /cases/<...> (pages 2+ and filters) is rewritten here (see app/live/m/[id]/page.tsx).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE } from "@/lib/data/server";
import CasesPagePath, { generateMetadata as casesMetadata } from "../../../cases/[...slug]/page";

type Props = { params: Promise<{ slug: string[] }> };

export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return IS_REMOTE ? casesMetadata(props) : {};
}

export default function LiveCasesPage(props: Props) {
  if (!IS_REMOTE) notFound();
  return <CasesPagePath {...props} />;
}
