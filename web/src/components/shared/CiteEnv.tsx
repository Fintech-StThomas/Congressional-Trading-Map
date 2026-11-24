"use client";
// What a citation needs to know about the page: the data release it was rendered from, the build time and the source
// list. Pages pass these explicitly through CiteEnvProvider (the release comes from the server, `data.release`); a
// component outside a provider (the board, an organisation page) falls back to the pinned release of this tab and
// reads the build time from meta.json when a citation is first opened.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Meta } from "@/lib/types";
import { clientRelease } from "@/lib/data/pin";
import { getJSON } from "@/lib/data/fetch";
import { metaBuilt } from "@/lib/data/meta";
import { dataUrl } from "@/lib/urls";
import type { SourceRef } from "@/lib/domain/citation";

// Also here: what the build behind the page did that changes how a sentence reads (so far whether it left conduit-forwarded
// earmarked money out of PAC money). Pages pass it from their own meta.json, so a page read from an older release never
// claims a rule that build lacked; without a provider it is false.
const FlagsCtx = createContext({ conduitsExcluded: false });
export function BuildFlagsProvider({ conduitsExcluded, children }: { conduitsExcluded: boolean; children: ReactNode }) {
  return <FlagsCtx.Provider value={{ conduitsExcluded }}>{children}</FlagsCtx.Provider>;
}
export function useBuildFlags(): { conduitsExcluded: boolean } {
  return useContext(FlagsCtx);
}

export type CiteEnvValue = { release: string | null; built: string | null; sources: SourceRef[] };
const Ctx = createContext<CiteEnvValue | null>(null);

export function CiteEnvProvider({ release, built, sources, children }: CiteEnvValue & { children: ReactNode }) {
  return <Ctx.Provider value={{ release, built, sources }}>{children}</Ctx.Provider>;
}

/** The page's citation environment. `active` is true once a citation is open (the fallback fetches meta.json only then). */
export function useCiteEnv(active: boolean, names?: Record<string, string>): CiteEnvValue {
  const ctx = useContext(Ctx);
  const [built, setBuilt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (ctx || !active || built !== undefined) return;
    let live = true;
    getJSON<Meta>(dataUrl("meta.json")).then((m) => live && setBuilt(metaBuilt(m))).catch(() => live && setBuilt(null));
    return () => {
      live = false;
    };
  }, [ctx, active, built]);
  if (ctx) return ctx;
  return { release: clientRelease(), built: built ?? null, sources: Object.entries(names ?? {}).map(([id, name]) => ({ id, name })) };
}
