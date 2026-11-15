// The shapes of the ids that appear in URLs (member, state, organisation), checked before any data is read so a
// junk or oversized id is a cheap 404 that never reaches the bucket. Formats are those in docs/data-dictionary.md.
// Pure (no Node or Next imports): next.config.ts builds its rewrite patterns from the same rules, and node --test
// loads this file directly.

/** Bioguide ids: one capital letter and six digits (K000389). */
export const MEMBER_ID = /^[A-Z]\d{6}$/;

/** Every state, district and territory code the board can show (board.json's `states` keys are a subset). */
export const STATE_CODES = [
  "AK", "AL", "AR", "AS", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "GU", "HI", "IA", "ID", "IL", "IN", "KS",
  "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MP", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY",
  "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VI", "VT", "WA", "WI", "WV", "WY",
] as const;
const STATES = new Set<string>(STATE_CODES);

/**
 * Organisation ids (data dictionary, "Ids"): co:<CIK>, tk:<ticker>, pac:<FEC committee id>, cmte:<thomas id>,
 * lda:<registrant|client|lobbyist>-<LDA id>. Length-capped at 48 characters.
 */
export const ORG_ID = /^(?:co:[1-9]\d{0,9}|tk:[A-Z0-9.^-]{1,24}|pac:C\d{8}|cmte:[A-Z0-9]{2,10}|lda:(?:registrant|client|lobbyist)-\d{1,12})$/;

export function isMemberId(id: unknown): id is string {
  return typeof id === "string" && MEMBER_ID.test(id);
}

export function isStateCode(code: unknown): code is string {
  return typeof code === "string" && STATES.has(code);
}

export function isOrgId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 48 && ORG_ID.test(id);
}

// ---------------------------------------------------------------- next.config rewrite patterns
// path-to-regexp parameter patterns (the part inside `:name(...)`), so a malformed id never matches the rewrite
// to an on-demand route: it falls through to the static route, whose dynamicParams = false answers 404 without
// rendering or reading any data.

/** `:id(<this>)` for member ids. */
export const MEMBER_ID_PATTERN = "[A-Z]\\d{6}";
/** `:state(<this>)` for state codes. */
export const STATE_PATTERN = STATE_CODES.join("|");
/**
 * `:id(<this>)` for /o/<id>. Links percent-encode the id (`/o/co%3A320193`, `^` as `%5E`), so the separator and
 * the body accept their encoded forms too; the browser then looks the decoded id up exactly in the org shard.
 */
export const ORG_PATTERN = "(?:co|tk|pac|cmte|lda)(?::|%3[Aa])[A-Za-z0-9.^%-]{1,40}";
