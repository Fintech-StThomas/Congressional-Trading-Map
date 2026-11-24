// How a /connect step names its actor. The record names a household, a spouse or a committee, not always the member, so
// the sentence says so: "<member>'s household reported trading stock in ...", "a committee of <member> (<committee>) gave
// money to ...". Owners come from the tie's own note ("owners: spouse 3, self 2"); without a note the trades are the
// household's, as everywhere on the site. Pure; tests/paths.test.mjs loads it directly.
import { CONNECT_WORDS } from "../copy-precision.ts";
import type { Hop } from "./paths.ts";

/** The owner counts a traded tie's note carries, or null when it carries none. */
export function ownersOf(note: string | null | undefined): { owner: string; n: number }[] | null {
  // A traded tie's note starts "owners: spouse 3, self 2"; a holding's carries "...; owners spouse 2" (no colon).
  const m = /(?:^|;\s*)owners:?\s+([^;]+)/i.exec(note ?? "");
  if (!m) return null;
  const out = m[1].split(",").map((p) => /^\s*(\w+)\s+(\d+)\s*$/.exec(p)).filter((x): x is RegExpExecArray => Boolean(x)).map((x) => ({ owner: x[1], n: Number(x[2]) }));
  return out.length ? out : null;
}

export type HopWords = {
  /** Text before the subject's name ("a committee of "). */
  before: string;
  /** Text after the subject's name ("’s household", " (Example Leadership PAC)"). */
  after: string;
  /** The owners as filed, when the tie says (shown beside the step). */
  owners: string | null;
};

/** Who the subject of this step really is, when it is a member and the record names someone else. */
export function hopWords(h: Hop, subjectIsMember: boolean): HopWords {
  const plain: HopWords = { before: "", after: "", owners: null };
  if (!subjectIsMember) return plain;
  // A ledger row carries the committee's id ("pac:C00123456") rather than a name: say what the id is.
  if (h.type === "funds") return { before: `${CONNECT_WORDS.committeeOf} `, after: h.via ? ` (${/^pac:/.test(h.via) ? `FEC committee ${h.via.slice(4)}` : h.via})` : "", owners: null };
  if (h.type !== "traded" && h.type !== "owns") return plain;
  const owners = ownersOf(h.note);
  const kinds = new Set((owners ?? []).map((o) => o.owner));
  const note = owners ? owners.map((o) => `${o.owner} ${o.n}`).join(", ") : null;
  // Self and joint count as the member's own; anything else, or no statement, is the household.
  if (owners && [...kinds].every((k) => k === "self" || k === "joint")) return { ...plain, owners: note };
  const after = owners && kinds.size === 1 && kinds.has("spouse") ? CONNECT_WORDS.spouse : owners && kinds.size === 1 && kinds.has("dependent") ? CONNECT_WORDS.dependent : CONNECT_WORDS.household;
  return { before: "", after, owners: note };
}
