// Guards for the release permalink routes (/r/<release>/...): every id is checked by shape before any I/O, nothing
// is served outside pinned mode, and an unavailable release is a miss, never the latest data.
import { IS_PINNED } from "./mode.ts";
import { releaseData, type Data } from "./server.ts";
import { isReleaseId } from "./release.ts";
import { isMemberId } from "./ids.ts";

/** The reader for `release` when the release exists and (if given) `memberId` is one of its members; else null. */
export async function permalinkData(release: string, memberId?: string): Promise<Data | null> {
  if (!IS_PINNED || !isReleaseId(release) || (memberId !== undefined && !isMemberId(memberId))) return null;
  const data = await releaseData(release);
  if (!data || (memberId !== undefined && !(await data.isKnownMember(memberId)))) return null;
  return data;
}

/** A permalink JSON route: 404 unless `valid` (the other ids' shapes) and the release is available, else `fn` on its reader. */
export async function releaseResponse(release: string, valid: boolean, fn: (data: Data) => Promise<Response>): Promise<Response> {
  const data = valid ? await permalinkData(release) : null;
  return data ? fn(data) : new Response("Not found", { status: 404 });
}
