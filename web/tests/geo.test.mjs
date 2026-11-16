// Map completeness and invalid-asset guards; no network or runtime asset directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import topology from "../public/geo/us-states.json" with { type: "json" };
import { getMapGeometry, projectMapGeometry } from "../src/lib/board/geo.ts";
import { STATE_CODES } from "../src/lib/data/ids.ts";

test("bundled map covers 50 states and DC with finite geometry", () => {
  const geometry = getMapGeometry();
  const territories = new Set(["AS", "GU", "MP", "PR", "VI"]);
  assert.deepEqual(geometry.states.map((s) => s.code).sort(), STATE_CODES.filter((s) => !territories.has(s)).sort());
  for (const state of geometry.states) {
    assert.match(state.d, /^M/);
    assert.doesNotMatch(state.d, /NaN|Infinity/);
    assert.ok([state.cx, state.cy, state.lx, state.ly, ...state.box].every(Number.isFinite));
    assert.ok(state.box[2] > state.box[0] && state.box[3] > state.box[1]);
  }
  assert.match(geometry.nation, /^M/);
  assert.match(geometry.borders, /^M/);
});

test("missing, incomplete and duplicate geometry cannot publish a partial map", () => {
  assert.throws(() => projectMapGeometry({ type: "Topology", objects: {} }), /topology are required/);
  for (const replacement of [[], topology.objects.states.geometries.slice(1),
    [...topology.objects.states.geometries, topology.objects.states.geometries.find((s) => String(s.id) === "06")]]) {
    const broken = structuredClone(topology);
    broken.objects.states.geometries = replacement;
    assert.throws(() => projectMapGeometry(broken), /Expected valid outlines/);
  }
  const collapsed = structuredClone(topology);
  collapsed.transform.scale = [0, 0];
  assert.throws(() => projectMapGeometry(collapsed), /Expected valid outlines/);
});
