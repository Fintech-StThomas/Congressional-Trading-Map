"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dataUrl, getJSON } from "@/lib/client";
import {
  applyAssumptions, DEFAULT_ASSUMPTIONS, decodeAssumptions, encodeAssumptions, isDefault, ownOnly, readout, SWITCHES,
  type AssumptionEffect, type Assumptions, type TradeLite,
} from "@/lib/assume";
import { Switch } from "../controls/ChipSelect";

const NONE: TradeLite[] = [];
type TradeWire = { cols: string[]; rows: unknown[][] };
type EdgeLite = Parameters<typeof applyAssumptions>[1][number];

function decodeLite(t: TradeWire): TradeLite[] {
  const at = Object.fromEntries(t.cols.map((c, i) => [c, i]));
  return t.rows.map((r) => ({
    owner: String(r[at.owner] ?? "unspecified"), asset_class: String(r[at.asset_class] ?? "unknown"),
    low: (r[at.low] as number | null) ?? null, late: (r[at.late] as boolean | null) ?? null, org: (r[at.org] as string | null) ?? null,
  }));
}

/** Read `as` from the URL; write it back with replaceState, keeping every other parameter. */
export function readAssumptionsFromUrl(): Assumptions {
  if (typeof window === "undefined") return DEFAULT_ASSUMPTIONS;
  return decodeAssumptions(new URLSearchParams(window.location.search).get("as"));
}
function writeUrl(a: Assumptions) {
  const u = new URL(window.location.href);
  const v = encodeAssumptions(a);
  if (v) u.searchParams.set("as", v);
  else u.searchParams.delete("as");
  window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
}

export type AssumptionState = {
  assume: Assumptions;
  setAssume: (a: Assumptions) => void;
  effect: AssumptionEffect | null;
  status: "idle" | "loading" | "error" | "n/a";
  line: string;
};

/**
 * Assumptions for one member: loads trades/<id>.json the first time a switch is
 * used (or when the URL already carries `as`), then applies them.
 */
export function useAssumptions(member: string | null, hasTrades: boolean, edges: EdgeLite[], caseOrgs: string[]): AssumptionState {
  const [assume, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [trades, setTrades] = useState<Record<string, TradeLite[]>>({});
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setA(readAssumptionsFromUrl());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const active = !isDefault(assume);
  useEffect(() => {
    if (!active || !member || !hasTrades || trades[member]) return;
    let live = true;
    getJSON<TradeWire>(dataUrl(`trades/${member}.json`))
      .then((t) => live && setTrades((p) => ({ ...p, [member]: decodeLite(t) })))
      // No trade file means no trades: nothing to exclude.
      .catch((err) => live && (String(err).includes("404") ? setTrades((p) => ({ ...p, [member]: [] })) : setFailed(member)));
    return () => {
      live = false;
    };
  }, [active, member, hasTrades, trades]);
  const setAssume = useCallback((a: Assumptions) => {
    setA(a);
    writeUrl(a);
  }, []);
  const list = member ? (hasTrades ? trades[member] : NONE) : undefined;
  const effect = useMemo(() => (active && list ? applyAssumptions(list, edges, caseOrgs, assume) : null), [active, list, edges, caseOrgs, assume]);
  const status = !member ? "n/a" : failed === member ? "error" : active && !list ? "loading" : "idle";
  const line = status === "error" ? "The trades failed to load; assumptions are not applied." : readout(effect, assume);
  return { assume, setAssume, effect, status, line };
}

/** The switches, in a disclosure so they never crowd the board. */
export function AssumptionBar({ state, scope }: { state: AssumptionState; scope: string }) {
  const { assume, setAssume, status, line } = state;
  const active = !isDefault(assume);
  const own = assume.self && !assume.family && !assume.unstated;
  return (
    <details className={`assume${active ? " is-active" : ""}`} open={active || undefined}>
      <summary>
        <span className="assume__k">Assumptions</span>
        <span className="assume__v">{active ? "changed" : "household, every trade"}</span>
      </summary>
      <div className="assume__body" role="group" aria-label={`Assumptions for ${scope}`}>
        <Switch label="Member’s own trades only" on={own} onChange={(v) => setAssume(ownOnly(assume, v))} hint="Trades marked as the member’s own or a joint account" />
        {SWITCHES.map((s) => (
          <Switch key={s.key} label={s.label} on={assume[s.key]} hint={s.hint}
            onChange={(v) => setAssume({ ...assume, [s.key]: v, ...(s.key === "family" || s.key === "unstated" ? { self: true } : {}) })} />
        ))}
        {active && (
          <button type="button" className="linkbtn" onClick={() => setAssume(DEFAULT_ASSUMPTIONS)}>Reset</button>
        )}
        <p className="assume__note">Applies to household trades, the traded strings drawn from them and the cases built on them. Money strings are unaffected. Statistical co-trading ties are computed on all trades and are not recomputed.</p>
      </div>
      <p className="assume__line" role="status" aria-live="polite" aria-busy={status === "loading" || undefined} data-testid="assume-line">{line}</p>
    </details>
  );
}

// ---- member page: one provider, several consumers ---------------------------------

const Ctx = createContext<AssumptionState | null>(null);
export function useAssumptionContext() {
  return useContext(Ctx);
}

export function AssumptionProvider({ member, hasTrades, edges, caseOrgs, children }: {
  member: string; hasTrades: boolean; edges: EdgeLite[]; caseOrgs: string[]; children: ReactNode;
}) {
  const state = useAssumptions(member, hasTrades, edges, caseOrgs);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** The switch bar wired to the page's provider. */
export function PageAssumptionBar({ scope }: { scope: string }) {
  const s = useAssumptionContext();
  return s ? <AssumptionBar state={s} scope={scope} /> : null;
}

/** A count that follows the assumptions: trades kept, or cases kept. */
export function AssumeCount({ kind, total }: { kind: "trades" | "cases"; total: number }) {
  const s = useAssumptionContext();
  const e = s?.effect;
  if (!e) return <>{total.toLocaleString("en-US")}</>;
  const v = kind === "trades" ? e.kept : e.cases.size;
  return (
    <span title={`${total.toLocaleString("en-US")} without the assumptions`}>
      {v.toLocaleString("en-US")}
      <span className="assume__of"> of {total.toLocaleString("en-US")}</span>
    </span>
  );
}

/** Wraps one case row: fades and drops its tag when every trade behind it is excluded. */
export function AssumeCase({ org, children }: { org: string; children: ReactNode }) {
  const s = useAssumptionContext();
  const out = Boolean(s?.effect && !s.effect.cases.has(org));
  return (
    <li className={out ? "is-excluded" : undefined} data-case-org={org}>
      {children}
      {out && <span className="assume__gone">No longer a case under these assumptions</span>}
    </li>
  );
}
