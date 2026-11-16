"use client";
// Pins the browser's data fetches to the release the page was rendered from (lib/data/pin.ts). Every page renders it
// first, so fetches made after render, including after client-side navigation, use the same release as the HTML.
// Renders nothing. Setting module state during render is idempotent; it is skipped on the server, where that state
// would be shared between requests.
import { setClientRelease } from "@/lib/data/pin";

export function ReleasePin({ release }: { release: string | null }) {
  if (typeof window !== "undefined") setClientRelease(release);
  return null;
}
