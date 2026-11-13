// Unit tests for the featured-example picker (src/lib/featured.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardKinds, featuredReason, rankFeatured, TIE_KINDS } from "../src/lib/featured.ts";

let n = 0;
function e(self, type, other, opts = {}) {
  n++;
  const o = other.startsWith("M") ? { kind: "member", id: other } : { kind: "org", id: other };
  const me = { kind: "member", id: self };
  return { id: `e${n}`, type, count: opts.count ?? 1, note: opts.note ?? null, via: null, from: opts.out ? me : o, to: opts.out ? o : me };
}

test("kinds: a case company, plain PAC, both spending sides, both fund directions, co-trading", () => {
  const S = "M1";
  const all = [
    e(S, "traded", "org:a", { out: true }), e(S, "pac_money", "org:a"), e(S, "pac_money", "org:b"),
    e(S, "outside_spending", "org:s", { note: "support" }), e(S, "outside_spending", "org:o", { note: "oppose" }),
    e(S, "funds", "M2"), e(S, "funds", "M3", { out: true }), e(S, "traded_together", "M4"),
  ];
  assert.deepEqual(boardKinds(S, all), TIE_KINDS);
  assert.match(featuredReason(boardKinds(S, all)), /every kind of tie/);
  assert.deepEqual(boardKinds(S, [e(S, "traded", "org:x", { out: true }), e(S, "pac_money", "org:y")]), ["pac"]);
});

test("ranking: variety, then records, then id; deterministic", () => {
  const boards = [
    { member: "B", picked: [e("B", "pac_money", "org:a", { count: 9 })] },
    { member: "A", picked: [e("A", "pac_money", "org:a", { count: 9 })] },
    { member: "C", picked: [e("C", "pac_money", "org:a"), e("C", "funds", "M9")] },
    { member: "D", picked: [e("D", "pac_money", "org:a", { count: 50 })] },
    { member: "E", picked: [] },
  ];
  const r = rankFeatured(boards);
  assert.deepEqual(r.map((x) => x.member), ["C", "D", "A", "B"]);
  assert.deepEqual(rankFeatured([...boards].reverse()).map((x) => x.member), ["C", "D", "A", "B"]);
  assert.match(featuredReason(r[0].kinds), /money from a colleague and PAC money .*2 of the 7 kinds/);
  assert.match(featuredReason(r[1].kinds, false), /one of the widest/);
});
