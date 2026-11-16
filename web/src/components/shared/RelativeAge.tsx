"use client";
// "updated 6 hours ago" for a build time, added in the browser after hydration (the server renders nothing here, so the
// absolute date beside it never disagrees with a cached page). Wording: lib/domain/freshness.ts and lib/copy.ts.
import { relativeAgeText } from "@/lib/domain/freshness";
import { useNow } from "./useNow";

export function RelativeAge({ built }: { built: string | null }) {
  const now = useNow();
  const text = now === null ? null : relativeAgeText(built, now);
  return text ? <span data-testid="relative-age"> · {text}</span> : null;
}
