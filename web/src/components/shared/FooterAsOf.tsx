"use client";
// The footer's "Data as of <date>" line. The date is that of the latest release, so on a permalink path
// (/r/<release>/...) it reads "Latest data as of" instead of implying the page shows that data. The server renders the
// absolute date; the relative age ("updated 6 hours ago") is added in the browser after hydration.
import { usePathname } from "next/navigation";
import { RELEASE } from "@/lib/copy";
import { isReleasePath } from "@/lib/data/release";
import { relativeAgeText } from "@/lib/domain/freshness";
import { useNow } from "./useNow";

/** `asOf` is the formatted date ("unknown" when there is none), `built` the ISO build time; `sample` adds the sample marker. */
export function FooterAsOf({ asOf, built, sample }: { asOf: string; built: string | null; sample: boolean }) {
  const label = isReleasePath(usePathname()) ? RELEASE.footerLatest : RELEASE.footerAsOf;
  const now = useNow();
  const age = now === null ? null : relativeAgeText(built, now);
  return (
    <span>
      {label} <span className="mono">{asOf}</span>
      {sample ? " (sample)" : ""}
      {age ? <span data-testid="footer-age"> · {age}</span> : null}
    </span>
  );
}
