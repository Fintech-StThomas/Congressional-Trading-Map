// Unit tests for saved boards (src/lib/domain/saved.ts, saved-share.ts, saved-storage.ts): validation and caps,
// immutable operations, export without notes, merge on import, share fragments that carry no notes, storage failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addItem, boardsContaining, citationsText, createBoard, deleteBoard, emptyState, exportBoard, importBoards, latestBoard, LIMITS,
  makeItem, moveItem, removeItem, renameBoard, reorderItem, setBoardNote, setItemNote, validateSaved, SAVED_SCHEMA,
} from "../src/lib/domain/saved.ts";
import { parseShareFragment, shareFragment, SHARE_MAX_CHARS } from "../src/lib/domain/saved-share.ts";
import { BACKUP_KEY_PREFIX, loadSaved, readBackup, saveSaved, STORAGE_KEY } from "../src/lib/domain/saved-storage.ts";
import { buildTieCitation } from "../src/lib/domain/citation.ts";

const T0 = "2026-11-16T10:00:00.000Z";
const T1 = "2026-11-16T11:00:00.000Z";
const REL = "ab".repeat(32);
const SECRET = "MY-PRIVATE-NOTE-xyzzy";
let n = 0;
const id = () => `b${++n}`;
const edgeId = (i) => i.toString(16).padStart(12, "0");

const edge = {
  id: "e1e1e1e1e1e1", type: "traded", family: "holding", basis: "filed",
  from: { kind: "member", id: "M000001" }, to: { kind: "org", id: "co:123" }, directed: true, via: null,
  amount: { low: 15001, high: 50000, exact: null }, count: 1, first: "2021-03-14", last: "2021-03-14", by_year: [],
  evidence: [{ label: "Buy ACME", date: "2021-03-14", url: "https://example.gov/a", source: "ptr", record: "r1" }],
  evidence_total: 1, stat: null, weak: false, note: null,
};
const citation = () => buildTieCitation({ edge, names: { from: "Jane Doe", to: "ACME" }, env: { release: REL, built: T0, retrieved: T0, sources: [{ id: "ptr", name: "PTR" }] }, limitations: [], ledgerOnly: false });
const tieInput = (over = {}) => ({ kind: "tie", member: "M000001", org: "co:123", edge: "e1e1e1e1e1e1", release: REL, label: "Jane Doe to ACME", amount_text: "$15,001–$50,000", years: "2021", parties: ["D"], citation: citation(), ...over });
const mem = (i) => makeItem({ kind: "member", member: `M${String(i).padStart(6, "0")}`, release: null, label: `Member ${i}`, amount_text: "", years: "" }, T0);
const withBoard = () => {
  const s = createBoard(emptyState(), "  My   first board ", { id: "b0", now: T0 }).state;
  return s;
};

test("create trims the title, rejects empty, long and duplicate ids", () => {
  const s = withBoard();
  assert.equal(s.boards[0].title, "My first board");
  assert.equal(createBoard(s, "   ", { id: "x", now: T0 }).reason, "invalid");
  assert.equal(createBoard(s, "x".repeat(LIMITS.title + 1), { id: "x", now: T0 }).reason, "invalid");
  assert.equal(createBoard(s, "ok", { id: "b0", now: T0 }).ok, false);
});

test("operations are immutable", () => {
  const s = withBoard();
  const frozen = JSON.stringify(s);
  const a = addItem(s, "b0", makeItem(tieInput(), T0), T1);
  renameBoard(a.state, "b0", "Renamed", T1);
  assert.equal(JSON.stringify(s), frozen);
  assert.equal(a.state.boards[0].items.length, 1);
  assert.equal(s.boards[0].items.length, 0);
});

test("a board cap of 50 and an item cap of 200", () => {
  let s = emptyState();
  for (let i = 0; i < LIMITS.boards; i++) s = createBoard(s, `B${i}`, { id: `id${i}`, now: T0 }).state;
  assert.equal(createBoard(s, "one more", { id: "zz", now: T0 }).reason, "limit");
  let t = withBoard();
  for (let i = 1; i <= LIMITS.itemsPerBoard; i++) t = addItem(t, "b0", mem(i), T0).state;
  assert.equal(t.boards[0].items.length, LIMITS.itemsPerBoard);
  assert.equal(addItem(t, "b0", mem(999), T0).reason, "limit");
});

test("items dedupe by key and keep one entry", () => {
  let s = withBoard();
  s = addItem(s, "b0", makeItem(tieInput(), T0), T0).state;
  const again = addItem(s, "b0", makeItem(tieInput({ label: "other label" }), T1), T1);
  assert.deepEqual([again.ok, again.reason], [false, "duplicate"]);
  assert.equal(again.state.boards[0].items.length, 1);
  assert.equal(boardsContaining(s, "tie:e1e1e1e1e1e1").length, 1);
});

test("makeItem refuses ids that do not fit the kind", () => {
  assert.equal(makeItem(tieInput({ edge: undefined }), T0), null);
  assert.equal(makeItem(tieInput({ member: "nope" }), T0), null);
  assert.equal(makeItem(tieInput({ release: "abc" }), T0), null);
  assert.equal(makeItem({ kind: "org", org: "bad", release: null, label: "x", amount_text: "", years: "" }, T0), null);
  assert.equal(makeItem({ kind: "member", member: "M000001", org: "co:1", release: null, label: "x", amount_text: "", years: "" }, T0), null);
});

test("reorder and move by one place", () => {
  let s = withBoard();
  for (const i of [1, 2, 3]) s = addItem(s, "b0", mem(i), T0).state;
  const keys = (st) => st.boards[0].items.map((x) => x.key.slice(-1));
  assert.deepEqual(keys(s), ["1", "2", "3"]);
  assert.deepEqual(keys(reorderItem(s, "b0", 0, 2, T1).state), ["2", "3", "1"]);
  assert.deepEqual(keys(moveItem(s, "b0", "member:M000003", -1, T1).state), ["1", "3", "2"]);
  assert.deepEqual(keys(moveItem(s, "b0", "member:M000001", -1, T1).state), ["1", "2", "3"]);
  assert.equal(reorderItem(s, "b0", 0, 9, T1).ok, false);
  assert.equal(moveItem(s, "b0", "member:M000009", 1, T1).reason, "missing");
});

test("remove, rename, delete, notes and the latest board", () => {
  let s = withBoard();
  s = createBoard(s, "Second", { id: "b1", now: T1 }).state;
  assert.equal(latestBoard(s).id, "b1");
  s = addItem(s, "b0", mem(1), "2026-11-17T00:00:00.000Z").state;
  assert.equal(latestBoard(s).id, "b0");
  s = setItemNote(s, "b0", "member:M000001", "n", T1).state;
  assert.equal(s.boards[0].items[0].note, "n");
  assert.equal(setBoardNote(s, "b0", "x".repeat(LIMITS.note + 1), T1).ok, false);
  assert.equal(removeItem(s, "b0", "member:M000001", T1).state.boards[0].items.length, 0);
  assert.equal(renameBoard(s, "b1", "Third", T1).state.boards[1].title, "Third");
  assert.equal(deleteBoard(s, "b1").state.boards.length, 1);
  assert.equal(deleteBoard(s, "nope").reason, "missing");
});

function fullState() {
  let s = withBoard();
  s = addItem(s, "b0", makeItem(tieInput(), T0), T0).state;
  s = addItem(s, "b0", mem(2), T0).state;
  s = setItemNote(s, "b0", "tie:e1e1e1e1e1e1", SECRET, T1).state;
  s = setBoardNote(s, "b0", SECRET + "-board", T1).state;
  return s;
}

test("validateSaved round trips a full state, and drops unknown keys", () => {
  const s = fullState();
  const v = validateSaved(JSON.stringify(s));
  assert.equal(v.ok, true);
  assert.deepEqual(v.state, s);
  const extra = JSON.parse(JSON.stringify(s));
  extra.boards[0].extra = "x";
  extra.boards[0].items[0].extra = "y";
  assert.deepEqual(validateSaved(extra).state, s);
});

test("validateSaved rejects bad schema, types, ids, release, size and counts", () => {
  const s = fullState();
  const mut = (f) => { const c = JSON.parse(JSON.stringify(s)); f(c); return validateSaved(c); };
  assert.equal(validateSaved("not json").ok, false);
  assert.equal(validateSaved([]).ok, false);
  assert.equal(mut((c) => (c.schema = "paper-trail.saved/2")).ok, false);
  assert.equal(mut((c) => (c.boards = {})).ok, false);
  assert.equal(mut((c) => (c.boards[0].title = 5)).ok, false);
  assert.equal(mut((c) => (c.boards[0].title = "x".repeat(121))).ok, false);
  assert.equal(mut((c) => (c.boards[0].note = "x".repeat(4001))).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].note = "x".repeat(4001))).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].member = "lowercase")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].org = "co:0")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].release = "ABC")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].key = "tie:ffffffffffff")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].saved = "yesterday")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[1] = c.boards[0].items[0])).ok, false);
  assert.equal(mut((c) => (c.boards[0].items[0].citation.schema = "x")).ok, false);
  assert.equal(mut((c) => delete c.boards[0].items[0].citation.subject).ok, false);
  assert.equal(mut((c) => c.boards.push(c.boards[0])).ok, false);
  assert.equal(mut((c) => (c.boards[0].id = "has space")).ok, false);
  assert.equal(mut((c) => (c.boards[0].items = Array.from({ length: 201 }, () => c.boards[0].items[0]))).ok, false);
  assert.equal(mut((c) => (c.boards = Array.from({ length: 51 }, (_, i) => ({ ...c.boards[0], id: `x${i}` })))).ok, false);
  assert.equal(mut((c) => (c.notes_included = "yes")).ok, false);
});

test("the default export excludes notes and says so; includeNotes keeps them", () => {
  const board = fullState().boards[0];
  const plain = exportBoard(board);
  assert.ok(!plain.includes(SECRET));
  assert.equal(JSON.parse(plain).notes_included, false);
  assert.equal(JSON.parse(plain).schema, SAVED_SCHEMA);
  const withNotes = exportBoard(board, { includeNotes: true });
  assert.ok(withNotes.includes(SECRET));
  assert.equal(JSON.parse(withNotes).notes_included, true);
  assert.equal(validateSaved(plain).ok, true);
  assert.equal(validateSaved(withNotes).state.boards[0].items[0].note, SECRET);
});

test("import merges without overwriting and gives new ids on collision", () => {
  const existing = fullState();
  const file = exportBoard(existing.boards[0], { includeNotes: true });
  const r = importBoards(file, existing, id);
  assert.equal(r.ok, true);
  assert.equal(r.state.boards.length, 2);
  assert.equal(r.renamed, 1);
  assert.notEqual(r.state.boards[1].id, "b0");
  assert.deepEqual(r.state.boards[0], existing.boards[0]);
  assert.equal(r.notesIncluded, true);
  const fresh = importBoards(file, emptyState(), id);
  assert.equal(fresh.state.boards[0].id, "b0");
  assert.equal(fresh.renamed, 0);
});

test("import refuses invalid files and a merge that passes 50 boards", () => {
  assert.equal(importBoards("{", emptyState(), id).ok, false);
  assert.equal(importBoards({ schema: "x", boards: [] }, emptyState(), id).ok, false);
  let s = emptyState();
  for (let i = 0; i < 50; i++) s = createBoard(s, `B${i}`, { id: `id${i}`, now: T0 }).state;
  assert.equal(importBoards(exportBoard(fullState().boards[0]), s, id).ok, false);
});

test("citations text lists every item and says when none was captured", () => {
  const t = citationsText(fullState().boards[0], "No citation was captured.");
  assert.ok(t.includes("1. Jane Doe to ACME"));
  assert.ok(t.includes("Amount as displayed: $15,001–$50,000"));
  assert.ok(t.includes("2. Member 2\nNo citation was captured."));
  assert.ok(!t.includes(SECRET));
});

// ---------------------------------------------------------------- share links

test("a share fragment holds title, kinds, ids and releases only", () => {
  const board = fullState().boards[0];
  const f = shareFragment(board);
  assert.ok(f.startsWith("#b="));
  assert.ok(/^#b=[A-Za-z0-9_-]+$/.test(f));
  assert.ok(!f.includes(SECRET));
  const decoded = Buffer.from(f.slice(3), "base64url").toString("utf8");
  for (const forbidden of [SECRET, "Jane Doe", "15,001", "2026-11", "Buy ACME", "citation", "note", "label", "amount"]) assert.ok(!decoded.includes(forbidden), forbidden);
  const p = parseShareFragment(f);
  assert.equal(p.ok, true);
  assert.equal(p.board.title, "My first board");
  assert.deepEqual(p.board.items.map((i) => [i.kind, i.member, i.org, i.edge, i.release]), [
    ["tie", "M000001", "co:123", "e1e1e1e1e1e1", REL], ["member", "M000002", undefined, undefined, null],
  ]);
});

test("a title with non-ASCII text and a shared release round trip", () => {
  const board = { title: "Ärzte — 医療 ✓", items: [mem(1), makeItem(tieInput(), T0), makeItem(tieInput({ edge: "000000000001" }), T0)] };
  const p = parseShareFragment(shareFragment(board));
  assert.equal(p.board.title, board.title);
  assert.equal(p.board.items.length, 3);
  assert.equal(parseShareFragment(shareFragment(board).slice(1)).ok, true);
});

test("share fragments: caps and strict failures", () => {
  assert.equal(shareFragment({ title: "t", items: [] }), null);
  const many = Array.from({ length: 101 }, (_, i) => makeItem({ kind: "tie", member: "M000001", edge: edgeId(i), release: REL, label: "x", amount_text: "", years: "" }, T0));
  assert.equal(shareFragment({ title: "t", items: many }), null);
  const hundred = shareFragment({ title: "t", items: many.slice(0, 100) });
  assert.ok(hundred && hundred.length <= SHARE_MAX_CHARS + 3);
  const enc = (o) => "#b=" + Buffer.from(JSON.stringify(o)).toString("base64url");
  const ok = { v: 1, t: "T", r: [], i: [["m", "M000001", "", "", -1]] };
  assert.equal(parseShareFragment(enc(ok)).ok, true);
  assert.equal(parseShareFragment("#x=abc").ok, false);
  assert.equal(parseShareFragment("#b=").ok, false);
  assert.equal(parseShareFragment("#b=!!!").ok, false);
  assert.equal(parseShareFragment("#b=" + "A".repeat(SHARE_MAX_CHARS + 1)).ok, false);
  assert.equal(parseShareFragment("#b=" + Buffer.from("not json").toString("base64url")).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, v: 2 })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, t: "" })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, t: "x".repeat(121) })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["x", "M000001", "", "", -1]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["m", "bad", "", "", -1]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["m", "M000001", "", "", 0]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["t", "M000001", "", "", -1]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["m", "M000001", "", "", -1, "extra"]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, i: [["m", "M000001", "", "", -1], ["m", "M000001", "", "", -1]] })).ok, false);
  assert.equal(parseShareFragment(enc({ ...ok, r: ["nothex"], i: [["m", "M000001", "", "", 0]] })).ok, false);
  const tooMany = { ...ok, i: Array.from({ length: 101 }, (_, i) => ["t", "M000001", "", edgeId(i), -1]) };
  assert.equal(parseShareFragment(enc(tooMany)).ok, false);
});

// ---------------------------------------------------------------- storage

const fake = (over = {}) => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), ...over };
};

test("storage: empty, save, load", () => {
  const kv = fake();
  assert.equal(loadSaved(kv, T0).status.kind, "empty");
  const s = fullState();
  assert.equal(saveSaved(kv, s).ok, true);
  assert.ok(kv.m.has(STORAGE_KEY));
  const l = loadSaved(kv, T0);
  assert.equal(l.status.kind, "ok");
  assert.deepEqual(l.state, s);
});

test("storage: corrupt data is kept aside and reported, not dropped", () => {
  const kv = fake();
  kv.m.set(STORAGE_KEY, '{"schema":"paper-trail.saved/1","boards":[{"id":1}]}');
  const l = loadSaved(kv, T0);
  assert.equal(l.status.kind, "corrupt");
  assert.deepEqual(l.state.boards, []);
  assert.ok(l.status.backupKey.startsWith(BACKUP_KEY_PREFIX));
  assert.equal(readBackup(kv, l.status.backupKey), kv.m.get(STORAGE_KEY));
  assert.ok(l.status.errors.length > 0);
  kv.m.set(STORAGE_KEY, "garbage");
  assert.equal(loadSaved(kv, T1).status.kind, "corrupt");
  assert.equal(readBackup(kv, "other.key"), null);
});

test("storage: unavailable, throwing and full storage never throw", () => {
  assert.equal(loadSaved(null, T0).status.kind, "unavailable");
  assert.equal(saveSaved(null, emptyState()).ok, false);
  const boom = fake({ getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } });
  assert.equal(loadSaved(boom, T0).status.kind, "unavailable");
  const r = saveSaved(boom, emptyState());
  assert.deepEqual([r.ok, r.error], [false, "quota"]);
  const noBackup = fake({ setItem: () => { throw new Error("quota"); } });
  noBackup.m.set(STORAGE_KEY, "garbage");
  const l = loadSaved(noBackup, T0);
  assert.equal(l.status.kind, "corrupt");
  assert.equal(l.status.backupKey, null);
});
