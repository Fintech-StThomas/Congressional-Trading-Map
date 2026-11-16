"use client";
// The neutral notice under the header when the published data is more than 48 hours old. Decided in the browser from
// the build time (the server cannot know how long a cached page will be kept), so it appears after hydration.
// Not shown on the sample site (its data is invented and never updated). Wording is in lib/copy.ts (FRESH).
import Link from "next/link";
import { FRESH } from "@/lib/copy";
import { staleBannerText } from "@/lib/domain/freshness";
import { statusHref } from "@/lib/urls";
import { useNow } from "./useNow";

export function StaleBanner({ built, sample }: { built: string | null; sample: boolean }) {
  const now = useNow();
  if (sample || now === null) return null;
  const text = staleBannerText(built, now);
  if (!text) return null;
  return (
    <aside className="stale-banner no-print" role="note" data-testid="stale-banner">
      <p>
        {text} <Link href={statusHref()}>{FRESH.staleLink}</Link>
      </p>
    </aside>
  );
}
