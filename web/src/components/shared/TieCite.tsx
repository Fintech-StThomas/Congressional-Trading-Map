"use client";
// "Cite this" for one tie in the evidence drawer: the tie, its filed records and links, the year window in view,
// and the limits that apply to it. The release and build time come from the page's CiteEnvProvider when it has one.
import { useState } from "react";
import type { Edge } from "@/lib/types";
import { buildTieCitation } from "@/lib/domain/citation";
import { edgeFacts } from "@/lib/domain/coverage";
import { CiteButton } from "./CiteButton";
import { useCiteEnv } from "./CiteEnv";

export function TieCite({ edge, names, sources, range, ledgerOnly }: {
  edge: Edge; names: { from: string; to: string }; sources: Record<string, string>; range?: [number, number]; ledgerOnly: boolean;
}) {
  const [active, setActive] = useState(false);
  const env = useCiteEnv(active, sources);
  const limitations = edgeFacts(edge, ledgerOnly).map((f) => f.text);
  return (
    <CiteButton
      block
      testId="cite-tie"
      onOpenChange={setActive}
      build={(retrieved) => buildTieCitation({ edge, names, range, ledgerOnly, limitations, env: { ...env, retrieved } })}
    />
  );
}
