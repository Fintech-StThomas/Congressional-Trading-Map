// Unit test for the board's string picker (src/lib/pick.ts), loaded with Node's
// built-in type stripping. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAgainst, pickBoard, pickBoardSplit } from "../src/lib/pick.ts";

const SELF = "M1";
let n = 0;
function edge(type, other, dollars, extra = {}) {
  n++;
  const family = { traded: "holding", traded_together: "holding", sits_with: "context" }[type] ?? "money";
  const o = other.startsWith("M") ? { kind: "member", id: other } : { kind: "org", id: other };
  const outgoing = extra.out;
  return {
    id: `e${String(n).padStart(3, "0")}`, type, family, basis: type === "traded_together" ? "derived" : "filed", weak: false,
    amount: { exact: dollars, high: dollars, low: dollars }, count: 1, by_year: [], note: extra.note ?? null, via: null,
    from: outgoing ? { kind: "member", id: SELF } : o, to: outgoing ? o : { kind: "member", id: SELF }, directed: true,
  };
}

function fixture() {
  n = 0;
  const edges = [];
  // Eight case companies, each with a traded and a PAC string, all large.
  for (let i = 0; i < 8; i++) {
    edges.push(edge("traded", `org:c${i}`, 900000 - i * 1000));
    edges.push(edge("pac_money", `org:c${i}`, 10000));
  }
  edges.push(edge("outside_spending", "org:sup1", 5000, { note: "support" }));
  edges.push(edge("outside_spending", "org:sup2", 9000, { note: "support" }));
  edges.push(edge("outside_spending", "org:opp1", 7000, { note: "oppose" }));
  edges.push(edge("funds", "M2", 3000));
  edges.push(edge("funds", "M3", 2500));
  edges.push(edge("funds", "M4", 1000, { out: true }));
  edges.push(edge("traded_together", "M5", 0));
  edges.push(edge("employee_money", "org:big", 50000));
  edges.push(edge("sits_with", "M9", 0));
  return edges;
}

test("variety is guaranteed and limits hold", () => {
  const picked = pickBoard(SELF, fixture());
  const ends = new Set(picked.map((e) => (e.from.id === SELF ? e.to.id : e.from.id)));
  assert.ok(picked.length <= 14);
  assert.ok(ends.size <= 12);
  const ids = (t) => picked.filter((e) => e.type === t);
  assert.deepEqual(ids("outside_spending").map((e) => e.from.id).sort(), ["org:sup2"], "spending against never takes a string");
  const funds = ids("funds");
  assert.equal(funds.length, 2);
  assert.ok(funds.some((e) => e.to.id === SELF) && funds.some((e) => e.from.id === SELF), "one received, one given");
  assert.equal(ids("traded_together").length, 1);
  assert.equal(ids("sits_with").length, 0, "context is never picked");
});

test("case companies keep both strings and are capped at five", () => {
  const picked = pickBoard(SELF, fixture());
  const caseOrgs = new Set(picked.filter((e) => e.type === "traded").map((e) => e.from.id));
  assert.ok(caseOrgs.size >= 1 && caseOrgs.size <= 5);
  for (const o of caseOrgs) assert.ok(picked.some((e) => e.type === "pac_money" && e.from.id === o), `${o} keeps its PAC string`);
  assert.ok(caseOrgs.has("org:c0"), "largest case first");
});

test("deterministic regardless of input order", () => {
  const a = pickBoard(SELF, fixture()).map((e) => e.id);
  const b = pickBoard(SELF, fixture().reverse()).map((e) => e.id);
  assert.deepEqual(a, b);
});

test("a member without variety fills with the largest money", () => {
  n = 0;
  const edges = [edge("pac_money", "org:a", 100), edge("pac_money", "org:b", 900), edge("traded", "org:t", 50)];
  assert.deepEqual(pickBoard(SELF, edges).map((e) => e.from.id), ["org:b", "org:a", "org:t"]);
});

test("spending against is a separate list: largest three, with a count of the rest", () => {
  const edges = fixture();
  edges.push(edge("outside_spending", "org:opp2", 9000, { note: "oppose" }));
  edges.push(edge("outside_spending", "org:opp3", 1000, { note: "oppose" }));
  edges.push(edge("outside_spending", "org:opp4", 500, { note: "oppose" }));
  const a = pickAgainst(edges);
  assert.deepEqual(a.shown.map((e) => e.from.id), ["org:opp2", "org:opp1", "org:opp3"]);
  assert.equal(a.more, 1);
  const split = pickBoardSplit(SELF, edges);
  assert.ok(split.strings.every((e) => e.note !== "oppose"));
  assert.equal(split.against.length, 3);
  assert.equal(split.againstMore, 1);
  // The slot goes back to the fill rule: as many strings as before the opposers existed.
  const without = fixture().filter((e) => e.note !== "oppose");
  assert.equal(split.strings.length, pickBoard(SELF, without).length);
});
