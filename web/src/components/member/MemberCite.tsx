"use client";
// "Cite this" for the member's case file as it is on screen now (including the `?as=` assumptions), and the same
// citation as a plain block in the printed case file. The release and build time come from the page's CiteEnvProvider.
import { useCallback } from "react";
import { buildViewCitation, type Citation } from "@/lib/domain/citation";
import { useAssumptionContext } from "@/components/shared/Assume";
import { useCiteEnv } from "@/components/shared/CiteEnv";
import { CiteButton } from "@/components/shared/CiteButton";
import { CitePrint } from "@/components/shared/CitePrint";

export type MemberCiteProps = {
  member: { id: string; name: string };
  counts: Record<string, number | null>;
  dates: { first: string | null; last: string | null };
  /** The coverage facts' text, recorded as the citation's limitations. */
  limitations: string[];
  /** The assumption switches apply (the member has trades). */
  hasTrades: boolean;
};

function useBuild(p: MemberCiteProps, active: boolean) {
  const as = useAssumptionContext();
  const env = useCiteEnv(active);
  const assume = p.hasTrades ? as?.assume ?? null : null;
  const kept = p.hasTrades ? as?.effect?.kept : undefined;
  const { member, counts, dates, limitations } = p;
  return useCallback((retrieved: string): Citation => buildViewCitation({
    kind: "member", member, limitations, assumptions: assume, dates,
    counts: kept === undefined ? counts : { ...counts, trades_counted_under_assumptions: kept },
    env: { ...env, retrieved },
  }), [member, counts, dates, limitations, assume, kept, env]);
}

export function MemberCite(p: MemberCiteProps) {
  const build = useBuild(p, true);
  return <CiteButton build={build} testId="cite-member" />;
}

export function MemberCitePrint(p: MemberCiteProps) {
  const build = useBuild(p, true);
  return <CitePrint build={build} casefile />;
}
