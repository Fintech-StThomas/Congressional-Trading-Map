// Assumption switches: what counts as "the member's trades". Pure and free of
// runtime imports so tests can load it directly. Money strings are never affected.

export type Assumptions = {
  /** Owners counted. Default: all (the household). */
  self: boolean; family: boolean; unstated: boolean;
  /** Drop funds, bonds and trades whose filing gives no asset type. */
  noFunds: boolean;
  /** Drop trades whose disclosed range starts under $15,000. */
  noSmall: boolean;
  /** Only trades disclosed more than 45 days late. */
  lateOnly: boolean;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = { self: true, family: true, unstated: true, noFunds: false, noSmall: false, lateOnly: false };
export const SMALL_TRADE = 15000;

export type TradeLite = { owner: string; asset_class: string; low: number | null; late: boolean | null; org: string | null };

export function isDefault(a: Assumptions): boolean {
  return (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]).every((k) => a[k] === DEFAULT_ASSUMPTIONS[k]);
}

/** URL form: `as=own` (self only), `nofam`, `nounst`, `nofunds`, `small`, `late`, comma separated. */
export function encodeAssumptions(a: Assumptions): string {
  const t: string[] = [];
  if (a.self && !a.family && !a.unstated) t.push("own");
  else {
    if (!a.self) t.push("noself");
    if (!a.family) t.push("nofam");
    if (!a.unstated) t.push("nounst");
  }
  if (a.noFunds) t.push("nofunds");
  if (a.noSmall) t.push("small");
  if (a.lateOnly) t.push("late");
  return t.join(",");
}

export function decodeAssumptions(s: string | null | undefined): Assumptions {
  const t = new Set((s ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const own = t.has("own");
  return {
    self: !t.has("noself"), family: !own && !t.has("nofam"), unstated: !own && !t.has("nounst"),
    noFunds: t.has("nofunds"), noSmall: t.has("small"), lateOnly: t.has("late"),
  };
}

/** Does one trade count under these assumptions? Joint accounts count with the member's own. */
export function tradeCounts(t: TradeLite, a: Assumptions): boolean {
  const o = t.owner;
  if ((o === "self" || o === "joint") && !a.self) return false;
  if ((o === "spouse" || o === "dependent") && !a.family) return false;
  if ((o === "unspecified" || !o) && !a.unstated) return false;
  if (a.noFunds && (t.asset_class === "fund" || t.asset_class === "bond" || t.asset_class === "unknown")) return false;
  if (a.noSmall && t.low !== null && t.low < SMALL_TRADE) return false;
  if (a.lateOnly && t.late !== true) return false;
  return true;
}

export type AssumptionEffect = {
  /** org id -> trades that still count. */
  byOrg: Map<string, number>;
  kept: number; total: number;
  /** traded edge ids whose trades are all excluded (they fade). */
  excluded: Set<string>;
  /** case orgs that keep their tag. */
  cases: Set<string>;
  caseTotal: number;
};

type EdgeLite = { id: string; type: string; from: { kind: string; id: string }; to: { kind: string; id: string } };

/** Apply assumptions to one member's trades, their traded strings and their cases. */
export function applyAssumptions(trades: TradeLite[], edges: EdgeLite[], caseOrgs: string[], a: Assumptions): AssumptionEffect {
  const byOrg = new Map<string, number>();
  let kept = 0;
  for (const t of trades) {
    if (!tradeCounts(t, a)) continue;
    kept++;
    if (t.org) byOrg.set(t.org, (byOrg.get(t.org) ?? 0) + 1);
  }
  const excluded = new Set<string>();
  for (const e of edges) {
    if (e.type !== "traded") continue;
    const org = e.to.kind === "org" ? e.to.id : e.from.id;
    if (!byOrg.get(org)) excluded.add(e.id);
  }
  const cases = new Set(caseOrgs.filter((o) => (byOrg.get(o) ?? 0) > 0));
  return { byOrg, kept, total: trades.length, excluded, cases, caseTotal: caseOrgs.length };
}

/** The labels for the switches, in display order. */
export const SWITCHES: { key: keyof Assumptions; label: string; hint: string }[] = [
  { key: "family", label: "Include spouse and dependents", hint: "Trades the filing marks as a spouse’s or a dependent child’s" },
  { key: "unstated", label: "Include unstated owner", hint: "Trades whose filing does not say whose they are" },
  { key: "noFunds", label: "Exclude funds, bonds and unlabelled assets", hint: "Drops asset classes fund and bond, and trades whose filing gives no asset type" },
  { key: "noSmall", label: "Exclude trades under $15,000", hint: "Drops trades whose disclosed range starts below $15,000" },
  { key: "lateOnly", label: "Late disclosures only", hint: "Keeps only trades the public could see more than 45 days after the trade" },
];

/** One line: what changed. */
export function readout(e: AssumptionEffect | null, a: Assumptions): string {
  if (isDefault(a)) return "Counting every trade the household reported.";
  if (!e) return "Loading the trades…";
  const trades = `${e.kept.toLocaleString("en-US")} of ${e.total.toLocaleString("en-US")} trades count`;
  const cases = e.caseTotal ? `; ${e.cases.size} of ${e.caseTotal} ${e.caseTotal === 1 ? "case remains" : "cases remain"}` : "";
  return `${trades}${cases} under these assumptions. Money strings are unaffected.`;
}

/** The "own only" shortcut: self on, everyone else off. */
export function ownOnly(a: Assumptions, on: boolean): Assumptions {
  return on ? { ...a, self: true, family: false, unstated: false } : { ...a, self: true, family: true, unstated: true };
}
