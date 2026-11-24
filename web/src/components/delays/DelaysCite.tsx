"use client";
// "Cite this" for the disclosure-timing page. The release and build time come from the page's CiteEnvProvider, so a
// permanent link exists only when the page was served from an archived release (a latest page rendered from release R
// names R's permanent page). The member table's CSV is beside the table (MembersTable) and holds the same release's rows.
import { CiteButton } from "@/components/shared/CiteButton";
import { useCiteEnv } from "@/components/shared/CiteEnv";
import { buildDelaysCitation } from "@/lib/domain/citation-page";

export function DelaysCite({ counts }: { counts: Record<string, number | null> }) {
  const env = useCiteEnv(true);
  return <CiteButton testId="cite-delays" build={(retrieved) => buildDelaysCitation({ env: { ...env, retrieved }, counts })} />;
}
