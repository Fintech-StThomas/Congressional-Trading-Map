"use client";
// The footer's "Data as of <date>" line. The date is that of the latest release, so on a permalink path
// (/r/<release>/...) it reads "Latest data as of" instead of implying the page shows that data.
import { usePathname } from "next/navigation";
import { RELEASE } from "@/lib/copy";
import { isReleasePath } from "@/lib/data/release";

/** `asOf` is the formatted date ("unknown" when there is none); `sample` adds the sample marker. */
export function FooterAsOf({ asOf, sample }: { asOf: string; sample: boolean }) {
  const label = isReleasePath(usePathname()) ? RELEASE.footerLatest : RELEASE.footerAsOf;
  return (
    <span>
      {label} <span className="mono">{asOf}</span>
      {sample ? " (sample)" : ""}
    </span>
  );
}
