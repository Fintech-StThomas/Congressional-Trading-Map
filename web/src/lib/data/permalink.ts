// Guards for the release permalink routes (/r/<release>/...): every id is checked by shape before any I/O, nothing
// is served outside pinned mode, and an unavailable release is a miss, never the latest data.
import { IS_PINNED } from "./mode.ts";
import { releaseData, type Data } from "./server.ts";
import { isReleaseId } from "./release.ts";
import { isMemberId, isOrgId } from "./ids.ts";

/** The reader for `release` when the release exists and (if given) `memberId` is one of its members; else null. */
export async function permalinkData(release: string, memberId?: string): Promise<Data | null> {
  if (!IS_PINNED || !isReleaseId(release) || (memberId !== undefined && !isMemberId(memberId))) return null;
  const data = await releaseData(release);
  if (!data || (memberId !== undefined && !(await data.isKnownMember(memberId)))) return null;
  return data;
}

/** The reader for `release` when the release exists and `orgId` is an organisation in it; else null (never the latest data). */
export async function permalinkOrgData(release: string, orgId: string): Promise<Data | null> {
  if (!isOrgId(orgId)) return null;
  const data = await permalinkData(release);
  return data && (await data.getOrgIndex()).has(orgId) ? data : null;
}

/** What a 200 permalink JSON answer carries: the release never changes. Errors never get it (see next.config.ts). */
export const IMMUTABLE_CACHE = "public, max-age=86400, s-maxage=31536000, immutable";

/** A permalink JSON route: 404 unless `valid` (the other ids' shapes) and the release is available, else `fn` on its reader; only a 200 is marked immutable. */
export async function releaseResponse(release: string, valid: boolean, fn: (data: Data) => Promise<Response>): Promise<Response> {
  const data = valid ? await permalinkData(release) : null;
  if (!data) return new Response("Not found", { status: 404 });
  const res = await fn(data);
  if (res.status === 200) res.headers.set("Cache-Control", IMMUTABLE_CACHE);
  return res;
}
