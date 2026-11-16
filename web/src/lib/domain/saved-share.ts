// Share links for saved boards. A link carries the board title and, per item, its kind, ids and data release in the
// URL fragment (`#b=<base64url of compact JSON>`). Nothing else: no notes, no citation text, no timestamps, no labels
// or amounts (the reader of the link looks the records up). A fragment is never sent to the server by the browser.
// Pure; parse is strict and capped at 16 KB and 100 items.
import { isMemberId, isOrgId } from "../data/ids.ts";
import { isReleaseId } from "../data/release.ts";
import { isEdgeId, itemKey, LIMITS, type Board, type ItemKind } from "./saved.ts";

export const SHARE_PREFIX = "#b=";
export const SHARE_MAX_CHARS = 16384;
export const SHARE_MAX_ITEMS = 100;

export type SharedItem = { key: string; kind: ItemKind; member?: string; org?: string; edge?: string; release: string | null };
export type SharedBoard = { title: string; items: SharedItem[] };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

const KIND_CODE = { tie: "t", member: "m", org: "o" } as const;
const CODE_KIND: Record<string, ItemKind> = { t: "tie", m: "member", o: "org" };

/** True when the board can be shared as a link (1 to 100 items). */
export const canShare = (b: Pick<Board, "items">) => b.items.length >= 1 && b.items.length <= SHARE_MAX_ITEMS;

/** `#b=…` for a board, or null when it has no items, more than 100, or would exceed 16 KB. */
export function shareFragment(board: Pick<Board, "title" | "items">): string | null {
  if (!canShare(board)) return null;
  const releases: string[] = [];
  const items = board.items.map((i) => {
    let r = -1;
    if (i.release) {
      r = releases.indexOf(i.release);
      if (r < 0) r = releases.push(i.release) - 1;
    }
    return [KIND_CODE[i.kind], i.member ?? "", i.org ?? "", i.edge ?? "", r];
  });
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ v: 1, t: board.title, r: releases, i: items })));
  return payload.length > SHARE_MAX_CHARS ? null : SHARE_PREFIX + payload;
}

export type ParsedShare = { ok: true; board: SharedBoard } | { ok: false; error: string };
const bad = (error: string): ParsedShare => ({ ok: false, error });

/** Strictly reads a share fragment (with or without the leading `#`). Anything unexpected is refused as a whole. */
export function parseShareFragment(fragment: string): ParsedShare {
  const f = typeof fragment === "string" ? fragment.replace(/^#/, "") : "";
  if (!f.startsWith("b=")) return bad("not a share link");
  const payload = f.slice(2);
  if (payload.length === 0 || payload.length > SHARE_MAX_CHARS) return bad("the link is empty or larger than 16 KB");
  const bytes = b64urlDecode(payload);
  if (!bytes) return bad("the link is not valid");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return bad("the link is not valid");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("the link is not valid");
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return bad("unknown link version");
  if (typeof o.t !== "string" || o.t.length < 1 || o.t.length > LIMITS.title) return bad("the board title is missing or too long");
  if (!Array.isArray(o.r) || o.r.length > SHARE_MAX_ITEMS || !o.r.every(isReleaseId)) return bad("the release list is not valid");
  if (!Array.isArray(o.i) || o.i.length < 1 || o.i.length > SHARE_MAX_ITEMS) return bad("the link lists no items or more than 100");
  const releases = o.r as string[];
  const items: SharedItem[] = [];
  const seen = new Set<string>();
  for (const t of o.i as unknown[]) {
    if (!Array.isArray(t) || t.length !== 5) return bad("an item is not valid");
    const [code, member, org, edge, ri] = t as [unknown, unknown, unknown, unknown, unknown];
    const kind = typeof code === "string" ? CODE_KIND[code] : undefined;
    if (!kind || typeof member !== "string" || typeof org !== "string" || typeof edge !== "string") return bad("an item is not valid");
    if (!Number.isInteger(ri) || (ri as number) < -1 || (ri as number) >= releases.length) return bad("an item names an unknown release");
    const ids = {
      kind,
      member: member === "" ? undefined : member,
      org: org === "" ? undefined : org,
      edge: edge === "" ? undefined : edge,
    };
    if ((ids.member !== undefined && !isMemberId(ids.member)) || (ids.org !== undefined && !isOrgId(ids.org)) || (ids.edge !== undefined && !isEdgeId(ids.edge))) return bad("an item has a malformed id");
    const key = itemKey(ids);
    if (!key) return bad("an item's ids do not fit its kind");
    if (seen.has(key)) return bad("an item is listed twice");
    seen.add(key);
    const item: SharedItem = { key, kind, release: (ri as number) < 0 ? null : releases[ri as number] };
    if (ids.member) item.member = ids.member;
    if (ids.org) item.org = ids.org;
    if (ids.edge) item.edge = ids.edge;
    items.push(item);
  }
  return { ok: true, board: { title: o.t, items } };
}
