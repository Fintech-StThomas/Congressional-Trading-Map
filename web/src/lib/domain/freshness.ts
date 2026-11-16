// How old the published data is: the relative age for the footer, the 48-hour staleness rule and the banner text.
// Pure and clock-free (callers pass `now`), so tests load it directly. Wording is in lib/copy.ts (FRESH).
import { FRESH } from "../copy.ts";
import { date, plural } from "../format.ts";

/** Data older than this many hours gets the banner on every page. */
export const STALE_AFTER_HOURS = 48;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Milliseconds from the build time to `now`, never negative (a clock a little behind the build counts as zero); null when the time cannot be read. */
export function ageMs(builtIso: string | null | undefined, now: number): number | null {
  if (!builtIso) return null;
  const t = Date.parse(builtIso);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** "updated just now", "updated 6 hours ago", "updated 3 days ago"; null when the build time is unknown (never a made-up age). */
export function relativeAgeText(builtIso: string | null | undefined, now: number): string | null {
  const age = ageMs(builtIso, now);
  if (age === null) return null;
  if (age < 60_000) return FRESH.justNow;
  if (age < HOUR) return `${FRESH.updated} ${plural(Math.floor(age / 60_000), "minute")} ago`;
  if (age < 2 * DAY) return `${FRESH.updated} ${plural(Math.floor(age / HOUR), "hour")} ago`;
  return `${FRESH.updated} ${plural(Math.floor(age / DAY), "day")} ago`;
}

/** True only when the age is known and over 48 hours: an unknown build time is not claimed to be stale. */
export function isStale(builtIso: string | null | undefined, now: number): boolean {
  const age = ageMs(builtIso, now);
  return age !== null && age > STALE_AFTER_HOURS * HOUR;
}

/** The banner sentence, or null when the data is fresh or its age is unknown. */
export function staleBannerText(builtIso: string | null | undefined, now: number): string | null {
  const age = ageMs(builtIso, now);
  if (age === null || !isStale(builtIso, now)) return null;
  return FRESH.stale(date(builtIso), plural(Math.floor(age / DAY), "day"));
}
