// Browser-side loading for the release comparison (/changes): one member's files from ONE named archived release,
// fetched by the release id the caller names (never "the latest", never another release). Ids are checked before any
// fetch. A 404 for meta.json or the member file means that release is unavailable for this member; a 404 for trades
// or holdings means the member has none there. Any other failure throws. `fetchFn` is injectable for tests.
import type { MemberFileWire } from "../types.ts";
import { decodeTradeFile } from "./decode.ts";
import { isMemberId } from "./ids.ts";
import { isReleaseId, RELEASE_INDEX_PATH } from "./release.ts";
import { releaseDataUrl } from "../urls.ts";
import { validateReleaseIndex, type MemberSide, type ReleaseIndexEntry } from "../domain/compare.ts";
import { readCounts, type HeaderCounts } from "../domain/snapshot.ts";

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** JSON, or null for a 404; anything else that is not 2xx throws. */
async function getOrNull(fetchFn: Fetch, url: string): Promise<unknown | null> {
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** The release list: [] when the file is absent (404); throws when it cannot be read or is malformed. */
export async function loadReleaseIndex(fetchFn: Fetch = (u) => fetch(u)): Promise<ReleaseIndexEntry[]> {
  const json = await getOrNull(fetchFn, RELEASE_INDEX_PATH);
  return json === null ? [] : validateReleaseIndex(json);
}

export type SideResult = { status: "unavailable" } | { status: "ok"; side: MemberSide; memberName: string; built: string | null; counts: HeaderCounts | null };

function builtOf(meta: unknown): string | null {
  const m = meta as { build?: { time?: unknown }; built?: unknown; build_time?: unknown } | null;
  const v = m?.build?.time ?? m?.built ?? m?.build_time;
  return typeof v === "string" && v ? v : null;
}

/** One member's data from one release. `buildTime` (from the release list) wins over meta.json's when both exist. */
export async function loadMemberSide(release: string, member: string, buildTime: string | null, fetchFn: Fetch = (u) => fetch(u)): Promise<SideResult> {
  if (!isReleaseId(release) || !isMemberId(member)) return { status: "unavailable" };
  const get = (rel: string) => getOrNull(fetchFn, releaseDataUrl(release, rel));
  const meta = await get("meta.json");
  if (meta === null) return { status: "unavailable" };
  const file = (await get(`members/${member}.json`)) as MemberFileWire | null;
  if (file === null) return { status: "unavailable" };
  const [trades, holdings] = await Promise.all([get(`trades/${member}.json`), get(`holdings/${member}.json`)]);
  const built = buildTime ?? builtOf(meta);
  return {
    status: "ok",
    built,
    memberName: file.member?.name ?? member,
    counts: readCounts(file.member),
    side: {
      buildTime: built,
      edges: Array.isArray(file.edges) ? file.edges : [],
      trades: trades ? decodeTradeFile(trades as Parameters<typeof decodeTradeFile>[0]) : [],
      holdings: holdings as MemberSide["holdings"],
    },
  };
}
