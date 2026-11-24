"use client";
// The neutral notice under the header when the published data is more than 48 hours old. Decided in the browser from
// the build time (the server cannot know how long a cached page will be kept), so it appears after hydration. A
// rarely visited page can be served once from an old cache entry whose build time is days old although newer data is
// live, so before warning it reads the build time published now and judges by the later of the two.
// Not shown on the sample site (its data is invented and never updated). Wording is in lib/copy.ts (FRESH).
import Link from "next/link";
import { useEffect, useState } from "react";
import { FRESH } from "@/lib/copy";
import { isStale, staleBannerText } from "@/lib/domain/freshness";
import { laterBuilt, publishedBuilt } from "@/lib/data/latest";
import { dataUrl, statusHref } from "@/lib/urls";
import { Notice } from "./Notice";
import { useNow } from "./useNow";

export function StaleBanner({ built, sample, release }: { built: string | null; sample: boolean; release?: string | null }) {
  const now = useNow();
  // undefined: not checked yet; null: the published build time could not be read.
  const [published, setPublished] = useState<string | null | undefined>(undefined);
  const staleHere = !sample && now !== null && isStale(built, now);
  useEffect(() => {
    if (!staleHere || published !== undefined) return;
    let live = true;
    // One check, made only while the page is visible (a hidden tab sends no requests, as with the newer-data note).
    const check = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", check);
      publishedBuilt(Boolean(release), dataUrl("meta.json"), (u) => fetch(u, { cache: "no-store" }))
        .then((b) => { if (live) setPublished(b); });
    };
    document.addEventListener("visibilitychange", check);
    check();
    return () => { live = false; document.removeEventListener("visibilitychange", check); };
  }, [staleHere, published, release]);
  if (!staleHere || published === undefined) return null;
  const text = staleBannerText(laterBuilt(built, published), now as number);
  if (!text) return null;
  return (
    <Notice tone="info" band className="stale-banner no-print" data-testid="stale-banner">
      <p>
        {text} <Link href={statusHref()}>{FRESH.staleLink}</Link>
      </p>
    </Notice>
  );
}
