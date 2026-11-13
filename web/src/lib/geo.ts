// Server-only: projects the us-atlas TopoJSON once at build time so the
// browser receives finished SVG path strings and no mapping library.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";

import { MAP_H, MAP_W } from "./mapsize";
export { MAP_H, MAP_W };

export type StateShape = {
  code: string;
  name: string;
  d: string;
  cx: number;
  cy: number;
  /** Bounding box in map units, for zooming to a state. */
  box: [number, number, number, number];
  /** Where the delegation count sits; differs from the centroid for small states. */
  lx: number;
  ly: number;
  /** True when the label sits outside the state with a leader line. */
  callout: boolean;
};

export type MapGeometry = { states: StateShape[]; nation: string; borders: string };

const FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

// Small eastern states get their counts in a column off the coast.
const CALLOUTS: Record<string, [number, number]> = {
  VT: [856, 96], NH: [952, 168], MA: [952, 192], RI: [952, 216], CT: [952, 240],
  NJ: [952, 264], DE: [952, 288], MD: [952, 312], DC: [952, 336],
};
// Centroids that land awkwardly for the label.
const NUDGE: Record<string, [number, number]> = {
  FL: [12, 6], LA: [-10, -4], MI: [10, 18], KY: [6, 2], VA: [6, 4], ID: [0, 18], CA: [-8, 0], NY: [4, 4], HI: [10, 8], AK: [0, 6],
};

function loadTopology(): Topology | null {
  const candidates = [join(process.cwd(), "public", "geo", "us-states.json"), join(process.cwd(), ".cache", "us-states.json")];
  for (const p of candidates) if (existsSync(/*turbopackIgnore: true*/ p)) return JSON.parse(readFileSync(/*turbopackIgnore: true*/ p, "utf8")) as Topology;
  return null;
}

let cached: MapGeometry | null = null;

export function getMapGeometry(): MapGeometry {
  if (cached) return cached;
  const topo = loadTopology();
  if (!topo) return (cached = { states: [], nation: "", borders: "" });
  const projection = geoAlbersUsa().scale(1300).translate([MAP_W / 2, MAP_H / 2]);
  const path = geoPath(projection).digits(1);
  const statesObj = topo.objects.states as GeometryCollection<{ name: string }>;
  const fc = feature(topo, statesObj);
  const states: StateShape[] = [];
  for (const f of fc.features as Feature<Geometry, { name: string }>[]) {
    const code = FIPS[String(f.id).padStart(2, "0")];
    if (!code) continue;
    const d = path(f);
    if (!d) continue; // territories: geoAlbersUsa does not project them
    const [cx, cy] = path.centroid(f);
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    const call = CALLOUTS[code];
    const nudge = NUDGE[code] ?? [0, 0];
    states.push({
      code,
      name: f.properties?.name ?? code,
      d,
      cx: round(cx), cy: round(cy),
      box: [round(x0), round(y0), round(x1), round(y1)],
      lx: call ? call[0] : round(cx + nudge[0]),
      ly: call ? call[1] : round(cy + nudge[1]),
      callout: Boolean(call),
    });
  }
  states.sort((a, b) => a.name.localeCompare(b.name));
  const nation = topo.objects.nation ? path(feature(topo, topo.objects.nation as GeometryCollection)) ?? "" : "";
  const borders = path(mesh(topo, statesObj, (a, b) => a !== b)) ?? "";
  cached = { states, nation, borders };
  return cached;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
