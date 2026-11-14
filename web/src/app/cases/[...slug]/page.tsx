// /cases/page/<n> and the filtered lists (/cases/ties/trade-pac/chamber/senate/party/r/page/2): one static
// page per filter and page number (lib/domain/casepages.ts), so each stays small and cacheable.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_REMOTE, getCases, getMemberIndex } from "@/lib/data/server";
import { allCasePaths, casesSlug, parseCasesPath, pageOf } from "@/lib/domain/casepages";
import { CasesView } from "@/components/cases/CasesView";

// Every path is prerendered from local data and other paths are 404s. With DATA_BASE_URL nothing is
// prerendered here: next.config.ts rewrites this URL to the on-demand twin under app/live/cases/[...slug] (ISR).
export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_REMOTE) return [];
  const [cases, members] = await Promise.all([getCases(), getMemberIndex()]);
  return allCasePaths(cases, members)
    .map(casesSlug)
    .filter((slug) => slug.length > 0)
    .map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const q = parseCasesPath((await params).slug);
  return { title: q && q.page > 1 ? `Open cases, page ${q.page}` : "Open cases", robots: q && (q.ties || q.chamber || q.party) ? { index: false } : undefined };
}

export default async function CasesPagePath({ params }: { params: Promise<{ slug: string[] }> }) {
  const q = parseCasesPath((await params).slug);
  if (!q) notFound();
  if (q.page > 1) {
    const [cases, members] = await Promise.all([getCases(), getMemberIndex()]);
    if (q.page > pageOf(cases, members, q).pages) notFound();
  }
  return <CasesView q={q} />;
}
