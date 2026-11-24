// The notice at the top of a permalink page (/r/<release>/...): which release it shows and that it will not change.
// Visible in print. Wording is in lib/copy.ts (RELEASE).
import Link from "next/link";
import { RELEASE } from "@/lib/copy";
import { date, releaseShort } from "@/lib/format";
import { Notice } from "./Notice";

/** `body` replaces the member-page sentence on pages that are not a member's (organisation, disclosure timing). */
export function ReleaseBanner({ release, built, latestHref, body }: { release: string; built: string | null; latestHref: string; body?: string }) {
  return (
    <Notice tone="snapshot" className="release-banner" data-testid="release-banner" data-release={release}>
      <p>
        <strong>{RELEASE.banner(releaseShort(release), built ? date(built) : null)}</strong> {body ?? RELEASE.bannerBody}
      </p>
      <p className="release-banner__latest no-print">
        <Link href={latestHref}>{RELEASE.latestLink}</Link>
      </p>
    </Notice>
  );
}
