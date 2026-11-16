// The view state shared by the board, the case file and the full file: one URL-encoded description of what the
// reader is looking at. Parser, serializer, `withView` (carry the state onto any of the three routes) and the
// one-line description printed on paper. Pure; tests/viewstate.test.mjs loads it directly.
//
// Params (written in this order, defaults omitted):  y=<from>-<to>  f=<family,family>  as=<assumptions>
//                                                    e=<tie edge id>  o=<organisation id>  d=event|public
// Unknown or invalid values are dropped, never thrown. `as` is the encoding of assume.ts, not a copy of it.
import { decodeAssumptions, DEFAULT_ASSUMPTIONS, encodeAssumptions, isDefault, isOwnOnly, type Assumptions } from "./assume.ts";
import { FAMILIES, FAMILY_LABEL, type Family } from "./edges.ts";
import { isEdgeId, isOrgId } from "../data/ids.ts";
import { YEAR_MAX, YEAR_MIN } from "../years.ts";
import { VIEW } from "../copy.ts";

export type DateBasis = "event" | "public";

export type ViewState = {
  /** Year window, inside YEAR_MIN..YEAR_MAX; null = every year. */
  years: [number, number] | null;
  /** Tie families shown (`f=none` is an empty list); null = the view's own default (the board hides context, the case file shows all). */
  families: Family[] | null;
  assume: Assumptions;
  /** Selected tie (edge id). */
  edge: string | null;
  /** Selected organisation. */
  org: string | null;
  basis: DateBasis;
};

export const DEFAULT_VIEW: ViewState = { years: null, families: null, assume: DEFAULT_ASSUMPTIONS, edge: null, org: null, basis: "event" };

/** The parameters this module owns, in the order they are written. */
export const VIEW_KEYS = ["y", "f", "as", "e", "o", "d"] as const;

type Source = string | URLSearchParams | { get(name: string): string | null };

function paramsOf(s: Source): { get(name: string): string | null } {
  return typeof s === "string" ? new URLSearchParams(s.startsWith("?") ? s.slice(1) : s) : s;
}

/** `2016-2020` -> clamped window; null when malformed, reversed, outside the data's years, or the whole span. */
export function parseYears(v: string | null | undefined): [number, number] | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{4})$/.exec(v) : null;
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (a > b || b < YEAR_MIN || a > YEAR_MAX) return null;
  const from = Math.max(YEAR_MIN, a), to = Math.min(YEAR_MAX, b);
  return from === YEAR_MIN && to === YEAR_MAX ? null : [from, to];
}

/** Families from a comma list: valid names only, no repeats, in the canonical order; `none` is an empty list; null when nothing valid is given. */
export function parseFamilies(v: string | null | undefined): Family[] | null {
  if (typeof v !== "string") return null;
  if (v.trim() === "none") return [];
  const want = new Set(v.split(",").map((x) => x.trim()));
  const out = FAMILIES.filter((f) => want.has(f));
  return out.length ? out : null;
}

/** Read the shared state from a query string, URLSearchParams or anything with `get`. Never throws. */
export function parseView(source: Source): ViewState {
  const q = paramsOf(source);
  const e = q.get("e"), o = q.get("o");
  return {
    years: parseYears(q.get("y")),
    families: parseFamilies(q.get("f")),
    assume: decodeAssumptions(q.get("as")),
    edge: isEdgeId(e) ? e : null,
    org: isOrgId(o) ? o : null,
    basis: q.get("d") === "public" ? "public" : "event",
  };
}

/** The state's own parameters as [key, value] pairs in stable order; defaults are left out. */
export function viewPairs(state: Partial<ViewState>): [string, string][] {
  const out: [string, string][] = [];
  const y = state.years;
  if (y && !(y[0] <= YEAR_MIN && y[1] >= YEAR_MAX)) out.push(["y", `${Math.max(YEAR_MIN, y[0])}-${Math.min(YEAR_MAX, y[1])}`]);
  if (state.families) {
    const f = FAMILIES.filter((x) => state.families?.includes(x));
    out.push(["f", f.length ? f.join(",") : "none"]);
  }
  const as = state.assume ? encodeAssumptions(state.assume) : "";
  if (as) out.push(["as", as]);
  if (isEdgeId(state.edge)) out.push(["e", state.edge]);
  if (isOrgId(state.org)) out.push(["o", state.org]);
  if (state.basis === "public") out.push(["d", "public"]);
  return out;
}

const pretty = (qs: string) => qs.replace(/%2C/gi, ",").replace(/%3A/gi, ":");

/** The state as a query string without the leading "?" (empty for the default view). */
export function serializeView(state: Partial<ViewState>): string {
  return pretty(new URLSearchParams(viewPairs(state)).toString());
}

/**
 * `href` (any of /, /m/<id>, /m/<id>/records, with or without a query and hash) carrying `state`. Every other
 * parameter is kept as it is. This module's parameters are replaced by the state's, so the same state is written
 * the same way everywhere. `o` doubles as the board's organisation centre: an `o` already in `href` survives when
 * the state selects none, unless `keepOrg` is false.
 */
export function withView(href: string, state: Partial<ViewState>, keepOrg = true): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const rest = hashAt < 0 ? href : href.slice(0, hashAt);
  const qAt = rest.indexOf("?");
  const path = qAt < 0 ? rest : rest.slice(0, qAt);
  const existing = new URLSearchParams(qAt < 0 ? "" : rest.slice(qAt + 1));
  const pairs = viewPairs(state);
  const setsOrg = pairs.some(([k]) => k === "o");
  const kept = new URLSearchParams();
  for (const [k, v] of existing) {
    if ((VIEW_KEYS as readonly string[]).includes(k) && !(k === "o" && keepOrg && !setsOrg)) continue;
    kept.append(k, v);
  }
  for (const [k, v] of pairs) kept.append(k, v);
  const qs = pretty(kept.toString());
  return `${path}${qs ? `?${qs}` : ""}${hash}`;
}

/** Is any filter on (so a view should say what it is showing)? */
export function isFiltered(s: ViewState): boolean {
  return s.years !== null || s.families !== null || !isDefault(s.assume) || s.basis !== "event";
}

/** "2014–2018", or "2016" for one year. */
export function yearsText(y: [number, number]): string {
  return y[0] === y[1] ? String(y[0]) : `${y[0]}–${y[1]}`;
}

/** How the assumptions read in a sentence, e.g. "household trades counted as the member’s own". */
export function assumeText(a: Assumptions): string {
  if (isDefault(a)) return VIEW.assumeAll;
  if (isOwnOnly(a) && !a.noFunds && !a.noSmall && !a.lateOnly) return VIEW.assumeOwn;
  const parts: string[] = [];
  if (isOwnOnly(a)) parts.push(VIEW.assumeOwnShort);
  else {
    if (!a.self) parts.push(VIEW.dropSelf);
    if (!a.family) parts.push(VIEW.dropFamily);
    if (!a.unstated) parts.push(VIEW.dropUnstated);
  }
  if (a.noFunds) parts.push(VIEW.dropFunds);
  if (a.noSmall) parts.push(VIEW.dropSmall);
  if (a.lateOnly) parts.push(VIEW.lateOnly);
  return `${VIEW.assumeSome}: ${parts.join("; ")}`;
}

/** The one line printed on every view: "Showing 2014–2018, household trades counted as the member’s own, by transaction date". */
export function viewLine(s: ViewState): string {
  const parts = [s.years ? yearsText(s.years) : VIEW.yearsAll, assumeText(s.assume)];
  if (s.families) parts.push(VIEW.families(s.families.map((f) => FAMILY_LABEL[f])));
  parts.push(s.basis === "public" ? VIEW.byPublic : VIEW.byEvent);
  return `${VIEW.showing} ${parts.join(", ")}`;
}

/** Notes that qualify the numbers under this state (shown on screen and printed). */
export function viewNotes(s: ViewState): string[] {
  return s.basis === "public" ? [VIEW.publicNote] : [];
}
