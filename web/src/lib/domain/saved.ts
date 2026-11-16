// Saved boards (schema paper-trail.saved/1): a reader's private research lists kept only in their own browser. This
// file is the pure core: the types, strict validation (used on load and on import), immutable operations, the JSON
// export (private notes excluded unless asked for) and merge-on-import. Share links are in saved-share.ts and the
// browser storage adapter in saved-storage.ts. No DOM access here; times and ids are passed in so tests are exact.
import { CITATION_SCHEMA, citationText, type Citation } from "./citation.ts";
import { isEdgeId, isMemberId, isOrgId } from "../data/ids.ts";
import { isReleaseId } from "../data/release.ts";
import type { Edge } from "../types.ts";
import { typeLabel } from "./edges.ts";

export const SAVED_SCHEMA = "paper-trail.saved/1";

export const LIMITS = {
  title: 120,
  note: 4000,
  itemsPerBoard: 200,
  boards: 50,
  label: 300,
  amountText: 120,
  years: 40,
  citationChars: 60000,
  /** A file chosen for import; larger files are refused before they are read into memory twice. */
  fileChars: 5_000_000,
} as const;

export type ItemKind = "tie" | "member" | "org";
export type Party = "D" | "R" | "I";

export type Item = {
  /** `tie:<edge>`, `member:<id>` or `org:<id>`: one of each per board. */
  key: string;
  kind: ItemKind;
  member?: string;
  org?: string;
  edge?: string;
  /** The data release it was saved from, or null when the page was not pinned to one ("latest at the time"). */
  release: string | null;
  saved: string;
  /** Names and amount exactly as displayed when saved. Never recomputed, never overwritten by a re-check. */
  label: string;
  amount_text: string;
  years: string;
  parties?: Party[];
  citation?: Citation;
  /** The reader's private note. */
  note: string;
};

export type Board = { id: string; title: string; created: string; updated: string; items: Item[]; note: string };
export type SavedState = { schema: typeof SAVED_SCHEMA; boards: Board[] };

export type ItemInput = {
  kind: ItemKind; member?: string; org?: string; edge?: string; release: string | null;
  label: string; amount_text: string; years: string; parties?: Party[]; citation?: Citation;
};

export const emptyState = (): SavedState => ({ schema: SAVED_SCHEMA, boards: [] });

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export { isEdgeId };

/** The identity of an item inside a board, from its ids; null when the ids do not fit its kind. */
export function itemKey(i: { kind: unknown; member?: unknown; org?: unknown; edge?: unknown }): string | null {
  if (i.kind === "tie") return isEdgeId(i.edge) && isMemberId(i.member) && (i.org === undefined || isOrgId(i.org)) ? `tie:${i.edge}` : null;
  if (i.kind === "member") return isMemberId(i.member) && i.org === undefined && i.edge === undefined ? `member:${i.member}` : null;
  if (i.kind === "org") return isOrgId(i.org) && i.member === undefined && i.edge === undefined ? `org:${i.org}` : null;
  return null;
}

/** The label a saved tie carries: the same title as its citation packet ("Traded: A to B"). */
export function tieLabel(edge: Pick<Edge, "type" | "note" | "via" | "directed">, names: { from: string; to: string }): string {
  return `${typeLabel(edge)}: ${names.from} ${edge.directed ? "to" : "and"} ${names.to}`;
}

// ---------------------------------------------------------------- validation

type Errs = string[];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is string => typeof x === "string" && ISO.test(x) && !Number.isNaN(Date.parse(x));
const str = (x: unknown, max: number, min = 0): x is string => typeof x === "string" && x.length >= min && x.length <= max;
const strArr = (x: unknown, maxN: number, maxLen: number): x is string[] => Array.isArray(x) && x.length <= maxN && x.every((s) => str(s, maxLen));
const numOrNull = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
const strOrNull = (x: unknown, max = 400) => x === null || str(x, max);

/** A citation packet read back from storage or a file: checked for every field the text rendering reads, and
 *  rebuilt field by field so nothing else a file carries is kept. Null when it does not fit. */
export function parseCitation(x: unknown): Citation | null {
  if (!isObj(x) || x.schema !== CITATION_SCHEMA || JSON.stringify(x).length > LIMITS.citationChars) return null;
  const { subject, identifiers: ids, dates, data, filters, links, counts } = x as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const named = (a: unknown) => Array.isArray(a) && a.length <= 20 && a.every((n) => isObj(n) && str(n.id, 80) && str(n.name, 300));
  const idList = (a: unknown) => strArr(a, 600, 200);
  const sound =
    str(x.title, 400) && ["tie", "member", "records", "table"].includes(x.kind as string) &&
    isObj(subject) && named(subject.members) && named(subject.orgs) &&
    isObj(ids) && idList(ids.edge_ids) && idList(ids.evidence_records) && idList(ids.trade_ids) && idList(ids.filing_docs) && numOrNull(ids.evidence_total) && typeof ids.truncated === "boolean" &&
    Array.isArray(x.evidence) && x.evidence.length <= 50 && x.evidence.every((e) => isObj(e) && strOrNull(e.record, 200) && str(e.label, 600) && strOrNull(e.date, 40) && str(e.source, 200) && str(e.source_name, 300) && strOrNull(e.url, 2000)) &&
    Array.isArray(x.sources) && x.sources.length <= 60 && x.sources.every((s) => isObj(s) && str(s.id, 200) && str(s.name, 300) && strOrNull(s.url, 2000) && strOrNull(s.revision) && strOrNull(s.retrieved)) &&
    isObj(dates) && strOrNull(dates.first, 40) && strOrNull(dates.last, 40) && strArr(dates.evidence, 100, 40) &&
    (x.amount === null || (isObj(x.amount) && str(x.amount.displayed, 200) && typeof x.amount.disclosed === "boolean" && typeof x.amount.open_ended === "boolean" && numOrNull(x.amount.low) && numOrNull(x.amount.high) && numOrNull(x.amount.exact) && Array.isArray(x.amount.by_year) && x.amount.by_year.length <= 60 && x.amount.by_year.every((b: unknown) => isObj(b) && numOrNull(b.y) && numOrNull(b.n) && numOrNull(b.low) && numOrNull(b.high) && numOrNull(b.exact)))) &&
    (x.amount_in_years === null || (isObj(x.amount_in_years) && str(x.amount_in_years.displayed, 200) && numOrNull(x.amount_in_years.records))) &&
    isObj(counts) && Object.keys(counts).length <= 30 && Object.values(counts).every(numOrNull) &&
    isObj(data) && strOrNull(data.release, 64) && strOrNull(data.built, 60) && str(x.retrieved, 60) &&
    isObj(filters) && (filters.years === null || (Array.isArray(filters.years) && filters.years.length === 2 && filters.years.every(numOrNull))) &&
    (filters.assumptions === null || (isObj(filters.assumptions) && str(filters.assumptions.param, 200) && typeof filters.assumptions.default === "boolean")) &&
    Array.isArray(filters.table) && filters.table.length <= 30 && filters.table.every((t: unknown) => isObj(t) && str(t.column, 200) && str(t.value, 400)) &&
    numOrNull(filters.rows_shown) && numOrNull(filters.rows_total) && str(x.method_version, 100) && strArr(x.limitations, 40, 1200) &&
    typeof x.ledger_only === "boolean" && strOrNull(x.ledger_note, 1200) && isObj(links) && strOrNull(links.permanent, 2000) && str(links.latest, 2000) && strOrNull(x.permanence_note, 1200) && str(x.disclaimer, 1200);
  return sound ? (JSON.parse(JSON.stringify(x)) as Citation) : null;
}

function readItem(raw: unknown, at: string, errs: Errs): Item | null {
  if (!isObj(raw)) {
    errs.push(`${at}: not an object`);
    return null;
  }
  const n = errs.length;
  const key = itemKey(raw as { kind: unknown });
  if (key === null) errs.push(`${at}: ids do not fit the kind`);
  else if (raw.key !== key) errs.push(`${at}: key does not match its ids`);
  if (raw.release !== null && !isReleaseId(raw.release)) errs.push(`${at}: release is not a release id`);
  if (!isTime(raw.saved)) errs.push(`${at}: saved is not a time`);
  if (!str(raw.label, LIMITS.label, 1)) errs.push(`${at}: label missing or over ${LIMITS.label} characters`);
  if (!str(raw.amount_text, LIMITS.amountText)) errs.push(`${at}: amount text too long`);
  if (!str(raw.years, LIMITS.years)) errs.push(`${at}: years too long`);
  if (!str(raw.note, LIMITS.note)) errs.push(`${at}: note over ${LIMITS.note} characters`);
  if (raw.parties !== undefined && !(Array.isArray(raw.parties) && raw.parties.length <= 2 && raw.parties.every((p) => p === "D" || p === "R" || p === "I"))) errs.push(`${at}: parties invalid`);
  let citation: Citation | undefined;
  if (raw.citation !== undefined) {
    citation = parseCitation(raw.citation) ?? undefined;
    if (!citation) errs.push(`${at}: citation packet invalid`);
  }
  if (errs.length > n) return null;
  const r = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const item: Item = { key: key!, kind: r.kind, release: r.release, saved: r.saved, label: r.label, amount_text: r.amount_text, years: r.years, note: r.note };
  if (r.member !== undefined) item.member = r.member;
  if (r.org !== undefined) item.org = r.org;
  if (r.edge !== undefined) item.edge = r.edge;
  if (r.parties !== undefined) item.parties = [...r.parties];
  if (citation) item.citation = citation;
  return item;
}

export type Validated = { ok: true; state: SavedState; notesIncluded: boolean | null } | { ok: false; errors: string[] };

/** Strict check of a saved state or an exported file (JSON text or a parsed value). Unknown keys are dropped, anything
 *  else wrong rejects the whole thing: unknown schema, wrong types, bad ids, oversize text, too many boards or items. */
export function validateSaved(input: unknown): Validated {
  const errs: Errs = [];
  let json = input;
  if (typeof input === "string") {
    if (input.length > LIMITS.fileChars) return { ok: false, errors: ["The file is too large to be a saved-boards file."] };
    try {
      json = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["The file is not valid JSON."] };
    }
  }
  if (!isObj(json)) return { ok: false, errors: ["Not a saved-boards file."] };
  if (json.schema !== SAVED_SCHEMA) return { ok: false, errors: [`Unknown schema (expected ${SAVED_SCHEMA}).`] };
  if (!Array.isArray(json.boards)) return { ok: false, errors: ["No boards list."] };
  if (json.boards.length > LIMITS.boards) return { ok: false, errors: [`More than ${LIMITS.boards} boards.`] };
  if (json.notes_included !== undefined && typeof json.notes_included !== "boolean") return { ok: false, errors: ["notes_included must be true or false."] };
  const boards: Board[] = [];
  const seen = new Set<string>();
  json.boards.forEach((b: unknown, bi: number) => {
    const at = `board ${bi + 1}`;
    if (!isObj(b)) return void errs.push(`${at}: not an object`);
    const n = errs.length;
    if (typeof b.id !== "string" || !BOARD_ID.test(b.id)) errs.push(`${at}: bad id`);
    else if (seen.has(b.id)) errs.push(`${at}: duplicate id`);
    else seen.add(b.id);
    if (!str(b.title, LIMITS.title, 1)) errs.push(`${at}: title missing or over ${LIMITS.title} characters`);
    if (!isTime(b.created) || !isTime(b.updated)) errs.push(`${at}: created/updated are not times`);
    if (!str(b.note, LIMITS.note)) errs.push(`${at}: note over ${LIMITS.note} characters`);
    if (!Array.isArray(b.items)) errs.push(`${at}: no items list`);
    else if (b.items.length > LIMITS.itemsPerBoard) errs.push(`${at}: more than ${LIMITS.itemsPerBoard} items`);
    if (errs.length > n) return;
    const keys = new Set<string>();
    const items: Item[] = [];
    (b.items as unknown[]).forEach((it, ii) => {
      const item = readItem(it, `${at}, item ${ii + 1}`, errs);
      if (!item) return;
      if (keys.has(item.key)) errs.push(`${at}, item ${ii + 1}: listed twice`);
      keys.add(item.key);
      items.push(item);
    });
    boards.push({ id: b.id as string, title: b.title as string, created: b.created as string, updated: b.updated as string, note: b.note as string, items });
  });
  if (errs.length) return { ok: false, errors: errs.slice(0, 10) };
  return { ok: true, state: { schema: SAVED_SCHEMA, boards }, notesIncluded: typeof json.notes_included === "boolean" ? json.notes_included : null };
}

// ---------------------------------------------------------------- operations (immutable)

export type Reason = "missing" | "limit" | "invalid" | "duplicate";
export type Op = { state: SavedState; ok: boolean; reason?: Reason };
const done = (state: SavedState): Op => ({ state, ok: true });
const fail = (state: SavedState, reason: Reason): Op => ({ state, ok: false, reason });
const cleanTitle = (t: string) => t.trim().replace(/\s+/g, " ");

function patch(s: SavedState, id: string, f: (b: Board) => Board | Op): Op {
  const i = s.boards.findIndex((b) => b.id === id);
  if (i < 0) return fail(s, "missing");
  const out = f(s.boards[i]);
  if ("ok" in out) return out;
  return done({ ...s, boards: s.boards.map((b, j) => (j === i ? out : b)) });
}

export function createBoard(s: SavedState, title: string, p: { id: string; now: string }): Op {
  const t = cleanTitle(title);
  if (!t || t.length > LIMITS.title || !BOARD_ID.test(p.id) || s.boards.some((b) => b.id === p.id)) return fail(s, "invalid");
  if (s.boards.length >= LIMITS.boards) return fail(s, "limit");
  return done({ ...s, boards: [...s.boards, { id: p.id, title: t, created: p.now, updated: p.now, items: [], note: "" }] });
}

export function renameBoard(s: SavedState, id: string, title: string, now: string): Op {
  const t = cleanTitle(title);
  if (!t || t.length > LIMITS.title) return fail(s, "invalid");
  return patch(s, id, (b) => ({ ...b, title: t, updated: now }));
}

export function deleteBoard(s: SavedState, id: string): Op {
  return s.boards.some((b) => b.id === id) ? done({ ...s, boards: s.boards.filter((b) => b.id !== id) }) : fail(s, "missing");
}

export function setBoardNote(s: SavedState, id: string, note: string, now: string): Op {
  return note.length > LIMITS.note ? fail(s, "invalid") : patch(s, id, (b) => ({ ...b, note, updated: now }));
}

export function setItemNote(s: SavedState, id: string, key: string, note: string, now: string): Op {
  if (note.length > LIMITS.note) return fail(s, "invalid");
  return patch(s, id, (b) => (b.items.some((i) => i.key === key) ? { ...b, updated: now, items: b.items.map((i) => (i.key === key ? { ...i, note } : i)) } : fail(s, "missing")));
}

/** An item for `addItem`, with the identity key derived from its ids. Null when the input does not fit the schema. */
export function makeItem(input: ItemInput, now: string): Item | null {
  const key = itemKey(input);
  if (!key || (input.release !== null && !isReleaseId(input.release))) return null;
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  const item: Item = { key, kind: input.kind, release: input.release, saved: now, label: clip(input.label.trim() || key, LIMITS.label), amount_text: clip(input.amount_text, LIMITS.amountText), years: clip(input.years, LIMITS.years), note: "" };
  if (input.member) item.member = input.member;
  if (input.org) item.org = input.org;
  if (input.edge) item.edge = input.edge;
  if (input.parties?.length) item.parties = input.parties.slice(0, 2);
  if (input.citation) {
    const c = parseCitation(input.citation);
    if (c) item.citation = c;
  }
  return item;
}

/** Adds an item to the end of a board. Saving what is already on the board is a no-op reported as `duplicate`. */
export function addItem(s: SavedState, boardId: string, item: Item, now: string): Op {
  return patch(s, boardId, (b) => {
    if (b.items.some((i) => i.key === item.key)) return fail(s, "duplicate");
    if (b.items.length >= LIMITS.itemsPerBoard) return fail(s, "limit");
    return { ...b, updated: now, items: [...b.items, item] };
  });
}

export function removeItem(s: SavedState, boardId: string, key: string, now: string): Op {
  return patch(s, boardId, (b) => (b.items.some((i) => i.key === key) ? { ...b, updated: now, items: b.items.filter((i) => i.key !== key) } : fail(s, "missing")));
}

/** Moves the item at index `from` to index `to` (both inside the list). */
export function reorderItem(s: SavedState, boardId: string, from: number, to: number, now: string): Op {
  return patch(s, boardId, (b) => {
    const n = b.items.length;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) return fail(s, "invalid");
    if (from === to) return b;
    const items = b.items.slice();
    items.splice(to, 0, items.splice(from, 1)[0]);
    return { ...b, updated: now, items };
  });
}

/** Moves an item one place up (-1) or down (1) by key; a move off either end changes nothing. */
export function moveItem(s: SavedState, boardId: string, key: string, delta: -1 | 1, now: string): Op {
  const b = s.boards.find((x) => x.id === boardId);
  const from = b ? b.items.findIndex((i) => i.key === key) : -1;
  if (from < 0) return fail(s, "missing");
  const to = from + delta;
  return to < 0 || to >= b!.items.length ? done(s) : reorderItem(s, boardId, from, to, now);
}

export const boardsContaining = (s: SavedState, key: string): Board[] => s.boards.filter((b) => b.items.some((i) => i.key === key));

/** The board touched most recently (the default place to save to); null when there are none. */
export function latestBoard(s: SavedState): Board | null {
  let best: Board | null = null;
  for (const b of s.boards) if (!best || b.updated >= best.updated) best = b;
  return best;
}

// ---------------------------------------------------------------- export and import

/** The board as a JSON file. Private notes are blanked unless `includeNotes`; the file says which it is. */
export function exportBoard(board: Board, opts: { includeNotes?: boolean } = {}): string {
  const keep = opts.includeNotes === true;
  const b: Board = keep ? board : { ...board, note: "", items: board.items.map((i) => ({ ...i, note: "" })) };
  return JSON.stringify({ schema: SAVED_SCHEMA, notes_included: keep, boards: [b] }, null, 2) + "\n";
}

export type Imported = { ok: true; state: SavedState; added: number; renamed: number; notesIncluded: boolean | null } | { ok: false; errors: string[] };

/** Merges the boards of a file into the existing state without overwriting anything: a board whose id is already
 *  taken gets a new id from `newId`; the reader's boards are never replaced. */
export function importBoards(json: unknown, existing: SavedState, newId: () => string): Imported {
  const v = validateSaved(json);
  if (!v.ok) return v;
  if (existing.boards.length + v.state.boards.length > LIMITS.boards) return { ok: false, errors: [`That would make more than ${LIMITS.boards} boards. Delete some first.`] };
  const taken = new Set(existing.boards.map((b) => b.id));
  let renamed = 0;
  const added = v.state.boards.map((b) => {
    let id = b.id;
    for (let n = 0; taken.has(id) && n < 20; n++) id = newId();
    if (taken.has(id)) id = `${b.id.slice(0, 50)}-${taken.size}`;
    if (id !== b.id) renamed++;
    taken.add(id);
    return { ...b, id };
  });
  return { ok: true, state: { ...existing, boards: [...existing.boards, ...added] }, added: added.length, renamed, notesIncluded: v.notesIncluded };
}

/** Every item's citation as plain text, in board order, for one download; items saved without a packet say so. */
export function citationsText(board: Board, missing: string): string {
  const parts = board.items.map((i, n) => {
    let body = missing;
    if (i.citation) {
      try {
        body = citationText(i.citation);
      } catch {
        body = missing;
      }
    }
    return `${n + 1}. ${i.label}\n${body}`;
  });
  return `${board.title}\n\n${parts.join("\n\n---\n\n")}\n`;
}

/** A file name for a board download: paper-trail-board-<title words>.<ext>. */
export function boardFilename(board: Pick<Board, "title">, ext: "json" | "txt"): string {
  const slug = board.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `paper-trail-board-${slug || "board"}.${ext}`;
}
