// Unit tests for the documented-connection finder (src/lib/domain/paths.ts, pathhops.ts), loaded with Node's built-in
// type stripping. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, comparePaths, findPaths, hopSentence, hopYears, pickExpansions, temporalOf } from "../src/lib/domain/paths.ts";
import { edgeFromHop, hopsFromMemberFile, hopsFromOrgFile } from "../src/lib/domain/pathhops.ts";

let n = 0;
const M = (id) => ({ kind: "member", id });
const O = (id) => ({ kind: "org", id });
const node = (id) => (id.startsWith("M") ? M(id) : O(id));

/** A hop between two nodes; years are given as [first, last] or null. */
function hop(type, from, to, extra = {}) {
  n++;
  const years = extra.years === undefined ? [2018, 2020] : extra.years;
  const ys = years ? Array.from({ length: years[1] - years[0] + 1 }, (_, i) => years[0] + i) : null;
  return {
    key: extra.key ?? `h${n}`, edge: `e${n}`, file: "M0", full: true, source: "edge", type,
    label: type, family: extra.family ?? "money", basis: extra.basis ?? "filed", directed: extra.directed ?? true,
    from: node(from), to: node(to), amount: { low: null, high: null, exact: 100 }, count: extra.count ?? 1,
    first: years ? `${years[0]}-01-01` : null, last: years ? `${years[1]}-12-31` : null,
    years: ys, yearsBasis: ys ? "yearly" : null, side: extra.side ?? null, via: null,
  };
}
const ids = (r) => r.paths.map((p) => p.nodes.join(">"));

test("a direct tie is a one-step path", () => {
  const g = buildGraph([hop("pac_money", "pac:C00000001", "M1")]);
  const r = findPaths(g, "M1", "pac:C00000001", { maxHops: 1 });
  assert.deepEqual(ids(r), ["M1>pac:C00000001"]);
  assert.equal(r.paths[0].temporal.status, "single");
  assert.equal(r.total, 1);
  assert.equal(r.more, 0);
});

test("a two-step path through an organisation, and one through a member", () => {
  const g = buildGraph([
    hop("pac_money", "pac:C00000001", "M1"),
    hop("traded", "M2", "tk:AAA", { family: "holding" }),
    hop("pac_money", "pac:C00000001", "M2"),
    hop("funds", "M1", "M3"),
    hop("funds", "M3", "M2"),
  ]);
  const r = findPaths(g, "M1", "M2", { maxHops: 2 });
  assert.deepEqual(ids(r), ["M1>M3>M2", "M1>pac:C00000001>M2"].sort());
});

test("direct and longer paths are both found, shortest first; no node is revisited", () => {
  const g = buildGraph([hop("funds", "M1", "M2"), hop("funds", "M1", "M3"), hop("funds", "M3", "M2"), hop("funds", "M2", "M1", { key: "dup" })]);
  const r = findPaths(g, "M1", "M2", { maxHops: 3 });
  assert.equal(r.paths[0].steps.length, 1);
  for (const p of r.paths) assert.equal(new Set(p.nodes).size, p.nodes.length);
  assert.deepEqual(ids(r), ["M1>M2", "M1>M3>M2"]);
  // both M1-M2 hops are shown on the one step
  assert.equal(r.paths[0].steps[0].hops.length, 2);
});

test("the hop bound is respected: three steps only when allowed", () => {
  const g = buildGraph([hop("funds", "M1", "M2"), hop("funds", "M2", "M3"), hop("funds", "M3", "M4")]);
  assert.equal(findPaths(g, "M1", "M4", { maxHops: 2 }).total, 0);
  const r = findPaths(g, "M1", "M4", { maxHops: 3 });
  assert.deepEqual(ids(r), ["M1>M2>M3>M4"]);
  assert.equal(findPaths(g, "M1", "M4", { maxHops: 9 }).maxHops, 3);
  assert.equal(findPaths(g, "M1", "M4", { maxHops: 0 }).maxHops, 1);
  assert.equal(findPaths(g, "M1", "M1").total, 0);
});

test("spending against a member, unknown-side spending and context ties are never used", () => {
  const g = buildGraph([
    hop("outside_spending", "pac:C00000009", "M1", { side: "oppose" }),
    hop("outside_spending", "pac:C00000009", "M2", { side: "oppose" }),
    hop("outside_spending", "pac:C00000008", "M1", { side: null }),
    hop("outside_spending", "pac:C00000008", "M2", { side: "support" }),
    hop("sits_with", "M1", "M2", { family: "context", directed: false }),
  ]);
  assert.deepEqual(g.excluded, { against: 2, sideUnknown: 1, context: 1 });
  assert.equal(findPaths(g, "M1", "M2").total, 0);
});

test("statistical ties are off by default, on by switch, and two are never chained", () => {
  const hops = [
    hop("traded_together", "M1", "M2", { family: "holding", basis: "derived", directed: false }),
    hop("shared_donors", "M2", "M3", { basis: "derived", directed: false }),
    hop("funds", "M3", "M4"),
    hop("funds", "M2", "M4"),
  ];
  const g = buildGraph(hops);
  const off = findPaths(g, "M1", "M4", { maxHops: 3 });
  assert.equal(off.total, 0);
  assert.equal(off.derivedUnused, 2);
  const on = findPaths(g, "M1", "M4", { maxHops: 3, includeDerived: true });
  assert.deepEqual(ids(on), ["M1>M2>M4"]); // M1>M2>M3>M4 would chain two statistical steps
  assert.equal(on.paths[0].anyDerived, true);
  assert.equal(on.derivedUnused, 0);
});

test("a statistical hop is dropped from a step that also has a filed one", () => {
  const g = buildGraph([hop("funds", "M1", "M2"), hop("traded_together", "M1", "M2", { family: "holding", basis: "derived", directed: false })]);
  const r = findPaths(g, "M1", "M2", { maxHops: 1, includeDerived: true });
  assert.equal(r.paths[0].steps[0].hops.length, 1);
  assert.equal(r.paths[0].anyDerived, false);
});

test("widely tied intermediate organisations are skipped unless asked for", () => {
  const g = buildGraph([hop("traded", "M1", "tk:BIG", { family: "holding" }), hop("traded", "M2", "tk:BIG", { family: "holding" }), hop("funds", "M1", "M2", { key: "x" })]);
  const degree = (id) => (id === "tk:BIG" ? 4000 : null);
  const r = findPaths(g, "M1", "M2", { maxHops: 2, degree });
  assert.deepEqual(ids(r), ["M1>M2"]);
  assert.deepEqual(r.hubsSkipped, ["tk:BIG"]);
  const r2 = findPaths(g, "M1", "M2", { maxHops: 2, degree, expandHubs: true });
  assert.deepEqual(ids(r2), ["M1>M2", "M1>tk:BIG>M2"]);
  assert.deepEqual(r2.hubsSkipped, []);
  // a hub as an end is searched
  assert.equal(findPaths(g, "M1", "tk:BIG", { maxHops: 1, degree }).total, 1);
});

test("temporal labels: overlap, none, unknown, never assumed", () => {
  const mk = (y1, y2) => buildGraph([hop("pac_money", "pac:C00000001", "M1", { years: y1 }), hop("pac_money", "pac:C00000001", "M2", { years: y2 })]);
  const find = (g) => findPaths(g, "M1", "M2", { maxHops: 2 }).paths[0].temporal;
  assert.deepEqual(find(mk([2010, 2014], [2013, 2016])), { status: "overlap", years: [2013, 2014], spanBased: false });
  assert.deepEqual(find(mk([2010, 2012], [2013, 2016])), { status: "none" });
  assert.deepEqual(find(mk([2010, 2012], null)), { status: "unknown" });
  // a step without years cannot rescue, but two disjoint steps still make it "none"
  const t = temporalOf([{ hops: [hop("funds", "M1", "M2", { years: [2001, 2002] })] }, { hops: [hop("funds", "M2", "M3", { years: [2005, 2006] })] }, { hops: [hop("funds", "M3", "M4", { years: null })] }]);
  assert.equal(t.status, "none");
  assert.equal(temporalOf([{ hops: [hop("funds", "M1", "M2")] }]).status, "single");
});

test("year spans come from by-year counts, else from first to last", () => {
  assert.deepEqual(hopYears({ by_year: [{ y: 2010, n: 1 }, { y: 2014, n: 2 }, { y: 2012, n: 0 }], first: "2000-01-01", last: "2020-01-01" }), { years: [2010, 2014], basis: "yearly" });
  assert.deepEqual(hopYears({ by_year: [], first: "2010-05-01", last: "2012-01-01" }), { years: [2010, 2011, 2012], basis: "span" });
  assert.equal(hopYears({ by_year: [], first: null, last: "" }), null);
});

test("ranking: fewer steps, filed before statistical, overlap before none, more records, then ids", () => {
  const g = buildGraph([
    // 2 steps, overlapping, 5 + 5 records via org A
    hop("pac_money", "pac:C00000001", "M1", { count: 5 }), hop("pac_money", "pac:C00000001", "M2", { count: 5 }),
    // 2 steps, overlapping, 1 + 1 via org B
    hop("pac_money", "pac:C00000002", "M1", { count: 1 }), hop("pac_money", "pac:C00000002", "M2", { count: 1 }),
    // 2 steps, no overlap via org C (many records)
    hop("pac_money", "pac:C00000003", "M1", { count: 50, years: [2001, 2002] }), hop("pac_money", "pac:C00000003", "M2", { count: 50, years: [2010, 2011] }),
    // 2 steps with a statistical step via M5
    hop("shared_donors", "M1", "M5", { basis: "derived", directed: false, count: 99 }), hop("funds", "M5", "M2", { count: 99 }),
    // direct
    hop("funds", "M1", "M2", { count: 1, years: [1999, 1999] }),
  ]);
  const r = findPaths(g, "M1", "M2", { maxHops: 2, includeDerived: true });
  assert.deepEqual(ids(r), ["M1>M2", "M1>pac:C00000001>M2", "M1>pac:C00000002>M2", "M1>pac:C00000003>M2", "M1>M5>M2"]);
  assert.ok(r.paths.every((p, i) => i === 0 || comparePaths(r.paths[i - 1], p) <= 0));
});

test("at most 25 paths are returned and the rest are counted", () => {
  const hops = [];
  for (let i = 0; i < 40; i++) {
    const org = `pac:C${String(10000000 + i)}`;
    hops.push(hop("pac_money", org, "M1"), hop("pac_money", org, "M2"));
  }
  const r = findPaths(buildGraph(hops), "M1", "M2", { maxHops: 2 });
  assert.equal(r.paths.length, 25);
  assert.equal(r.total, 40);
  assert.equal(r.more, 15);
  assert.equal(r.capped, false);
  assert.equal(findPaths(buildGraph(hops), "M1", "M2", { maxHops: 2, limit: 5 }).paths.length, 5);
});

test("the same input gives the same output in any input order", () => {
  const hops = [];
  for (let i = 0; i < 6; i++) {
    const org = `pac:C${String(10000000 + i)}`;
    hops.push(hop("pac_money", org, "M1", { key: `a${i}` }), hop("pac_money", org, "M2", { key: `b${i}` }));
  }
  const a = findPaths(buildGraph(hops), "M1", "M2");
  const b = findPaths(buildGraph([...hops].reverse()), "M1", "M2");
  assert.deepEqual(a.paths.map((p) => p.id), b.paths.map((p) => p.id));
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("direction is kept as published, whichever way the path is read", () => {
  const h = hop("pac_money", "pac:C00000001", "M1");
  const g = buildGraph([h, hop("funds", "M2", "M1")]);
  const fwd = findPaths(g, "M1", "pac:C00000001", { maxHops: 1 }).paths[0];
  const back = findPaths(g, "pac:C00000001", "M1", { maxHops: 1 }).paths[0];
  assert.equal(fwd.steps[0].hops[0].from.id, "pac:C00000001");
  assert.equal(back.steps[0].hops[0].from.id, "pac:C00000001");
  assert.deepEqual(hopSentence(h, "M1"), { subject: h.from, object: h.to, directed: true });
  const u = hop("fundraises_with", "M1", "M2", { directed: false });
  assert.equal(hopSentence(u, "M2").subject.id, "M2");
  assert.equal(hopSentence(u, "M1").subject.id, "M1");
});

test("a three-step search reads the least widely tied neighbours first and counts the rest", () => {
  const hops = [hop("funds", "M1", "M9")];
  for (let i = 0; i < 10; i++) hops.push(hop("pac_money", `pac:C${20000000 + i}`, "M1"));
  hops.push(hop("pac_money", "pac:C30000000", "M1"), hop("pac_money", "pac:C00000099", "M1"), hop("pac_money", "pac:C00000098", "M2"));
  const g = buildGraph(hops, ["M1", "M2"]);
  const degrees = { "pac:C30000000": 5000, "pac:C00000099": 1, "pac:C20000003": 2, "pac:C20000001": 4 };
  const e = pickExpansions(g, "M1", "M2", { degree: (id) => degrees[id] ?? null, perSide: 4 });
  assert.deepEqual(e.hubsSkipped, ["pac:C30000000"]);
  assert.ok(!e.pick.includes("pac:C00000099")); // an organisation tied to one member is a dead end
  assert.deepEqual(e.pick.slice(0, 2), ["pac:C20000003", "pac:C20000001"]);
  assert.equal(e.pick.length, 5);
  assert.equal(e.notExpanded, 7);
  assert.ok(e.notExpanded > 0);
  assert.equal(pickExpansions(g, "M1", "M2", { perSide: 4, expandHubs: true, degree: (id) => degrees[id] ?? null }).hubsSkipped.length, 0);
});

test("member-file rows: edges, ledger directions and statistical types", () => {
  const edge = (id, type, from, to, extra = {}) => ({
    id, type, family: "money", basis: "filed", from: node(from), to: node(to), directed: true, via: null,
    amount: { low: null, high: null, exact: 10 }, count: 2, first: "2015-01-01", last: "2016-01-01", by_year: [{ y: 2015, n: 1 }, { y: 2016, n: 1 }],
    evidence: [], evidence_total: 2, stat: null, weak: false, note: null, ...extra,
  });
  const file = {
    member: { id: "M1", name: "A" },
    edges: [edge("e1", "pac_money", "pac:C00000001", "M1")],
    nodes: {},
    ledger: {
      cols: ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"],
      rows: [
        ["funds", "member", "M2", null, 5, 5, 5, 1, "2012-03-01", "2012-03-01", null, "in"],
        ["funds", "member", "M3", null, 5, 5, 5, 1, "2013-03-01", "2013-03-01", null, "out"],
        ["shared_donors", "member", "M4", null, null, null, null, 7, "2010-01-01", "2014-01-01", null, "both"],
        ["outside_spending", "org", "pac:C00000007", "pac:C00000007:oppose", 9, 9, 9, 1, "2014-01-01", "2014-01-01", "oppose", "in"],
      ],
    },
  };
  const hops = hopsFromMemberFile(file);
  assert.equal(hops.length, 5);
  const byType = (t, o) => hops.find((h) => h.type === t && (h.from.id === o || h.to.id === o));
  assert.equal(byType("funds", "M2").from.id, "M2"); // dir in: the other end is the payer
  assert.equal(byType("funds", "M3").to.id, "M3");
  assert.equal(byType("shared_donors", "M4").basis, "derived");
  assert.equal(byType("shared_donors", "M4").directed, false);
  assert.equal(byType("pac_money", "pac:C00000001").full, true);
  assert.equal(byType("funds", "M2").full, false);
  assert.equal(byType("outside_spending", "pac:C00000007").side, "oppose");
  assert.deepEqual(byType("pac_money", "pac:C00000001").years, [2015, 2016]);
  assert.equal(edgeFromHop(byType("funds", "M2")).evidence.length, 0);
  const g = buildGraph(hops);
  assert.equal(g.excluded.against, 1);
});

test("organisation rows: direction by type, merge with the member's edge, drop duplicates of ledger rows", () => {
  const orgFile = {
    org: { id: "pac:C00000001" },
    ties: {
      cols: ["type", "member", "exact", "low", "high", "count", "first", "last", "edge"],
      rows: [
        ["pac_money", "M1", 10, 10, 10, 2, "2015-01-01", "2016-01-01", "e1"],
        ["pac_money", "M2", 7, 7, 7, 1, "2015-01-01", "2015-01-01", null],
        ["outside_spending", "M3", 7, 7, 7, 1, "2015-01-01", "2015-01-01", null],
        ["position", "M4", null, null, null, 1, "2015-01-01", "2015-01-01", null],
        ["revolving_door", "M5", null, null, null, 1, "2015-01-01", "2015-01-01", null],
      ],
    },
  };
  const rows = hopsFromOrgFile(orgFile);
  const row = (m) => rows.find((h) => h.from.id === m || h.to.id === m);
  assert.equal(row("M1").from.id, "pac:C00000001");
  assert.equal(row("M4").from.id, "M4");
  assert.equal(row("M5").directed, false);
  assert.equal(row("M1").file, "M1");
  assert.equal(row("M2").file, null);
  assert.equal(row("M2").full, false);
  const memberFile = {
    member: { id: "M2", name: "B" }, edges: [], nodes: {},
    ledger: { cols: ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"], rows: [["pac_money", "org", "pac:C00000001", null, 7, 7, 7, 1, "2015-01-01", "2015-01-01", null, "in"]] },
  };
  const g = buildGraph([...rows, ...hopsFromMemberFile(memberFile)]);
  const m2 = g.byNode.get("M2");
  assert.equal(m2.length, 1);
  assert.equal(m2[0].source, "ledger");
  // outside spending read from an org row has no side: not used
  assert.equal(g.excluded.sideUnknown, 1);
  assert.equal(g.byNode.get("M3"), undefined);
});
