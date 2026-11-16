// The notice at the top of a permalink page (/r/<release>/...): which release it shows and that it will not change.
// Visible in print. Wording is in lib/copy.ts (RELEASE).
import Link from "next/link";
import { RELEASE } from "@/lib/copy";
import { date, releaseShort } from "@/lib/format";

export function ReleaseBanner({ release, built, latestHref }: { release: string; built: string | null; latestHref: string }) {
  return (
    <aside className="release-banner" role="note" data-testid="release-banner" data-release={release}>
      <p>
        <strong>{RELEASE.banner(releaseShort(release), built ? date(built) : null)}</strong> {RELEASE.bannerBody}
      </p>
      <p className="release-banner__latest no-print">
        <Link href={latestHref}>{RELEASE.latestLink}</Link>
      </p>
    </aside>
  );
}
