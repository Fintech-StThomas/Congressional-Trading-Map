// Shown for any /r/<release>/... that cannot be served: a release that was never published or has been withdrawn,
// a malformed release id, or a member the release does not hold. It never stands in for the latest data.
import Link from "next/link";
import { RELEASE } from "@/lib/copy";

export default function ReleaseNotFound() {
  return (
    <div className="page page--narrow notfound" data-testid="release-not-found">
      <h1>{RELEASE.notFound.title}</h1>
      <p className="lede">{RELEASE.notFound.body}</p>
      <p className="lede">
        <Link href="/">{RELEASE.notFound.latestLink}</Link>
      </p>
    </div>
  );
}
