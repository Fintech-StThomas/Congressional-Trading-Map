"use client";
// The search as React state: runs connect() when the two ends or the options change. The answer is stored with the
// request it belongs to, so a late answer for an earlier request is never shown and no state is set while rendering.
import { useEffect, useState } from "react";
import { connect, NodeMissing, type Outcome, type Settings } from "./load";

export type ConnectState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; outcome: Outcome }
  | { status: "missing"; id: string }
  | { status: "error" };

/** `a` and `b` must be valid ids; with fewer than two different ends the state stays idle. */
export function useConnect(a: string | null, b: string | null, s: Settings): ConnectState {
  const { maxHops, includeDerived, expandHubs } = s;
  const active = Boolean(a && b && a !== b);
  const key = `${a}|${b}|${maxHops}|${includeDerived ? 1 : 0}|${expandHubs ? 1 : 0}`;
  const [done, setDone] = useState<{ key: string; state: ConnectState } | null>(null);
  useEffect(() => {
    if (!active || !a || !b) return;
    let live = true;
    connect(a, b, { maxHops, includeDerived, expandHubs }).then(
      (outcome) => live && setDone({ key, state: { status: "ok", outcome } }),
      (e) => live && setDone({ key, state: e instanceof NodeMissing ? { status: "missing", id: e.id } : { status: "error" } }),
    );
    return () => {
      live = false;
    };
  }, [active, a, b, maxHops, includeDerived, expandHubs, key]);
  if (!active) return { status: "idle" };
  return done?.key === key ? done.state : { status: "loading" };
}
