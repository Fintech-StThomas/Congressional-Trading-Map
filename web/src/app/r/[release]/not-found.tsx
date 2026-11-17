// Shown for any /r/<release>/... that cannot be served: a release that was never published or has been withdrawn,
// a malformed release id, or a member the release does not hold; or, on a deployment without RELEASE_BASE_URL, any
// release at all (said as such, so a valid citation is not reported as withdrawn). It never stands in for the latest data.
import Link from "next/link";
import { RELEASE } from "@/lib/copy";
import { IS_PINNED } from "@/lib/data/mode";

export default function ReleaseNotFound() {
  const nf = RELEASE.notFound;
  return (
    <div className="page page--narrow notfound" data-testid="release-not-found" data-pinned={IS_PINNED ? "1" : "0"}>
      <h1>{IS_PINNED ? nf.title : nf.offTitle}</h1>
      <p className="lede">{IS_PINNED ? nf.body : nf.offBody}</p>
      <p className="lede">
        <Link href="/">{RELEASE.notFound.latestLink}</Link>
      </p>
    </div>
  );
}
