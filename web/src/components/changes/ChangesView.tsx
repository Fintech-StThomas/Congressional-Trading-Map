"use client";
// /changes in the browser: reads ?m, ?from, ?to (ids validated before any fetch), lists archived releases from the
// same-origin release list, lets the reader pick two, loads the member's files from both and shows the comparison.
// Without archived releases (not pinned mode, or an empty/missing list) it says so and shows no numbers.
import { useEffect, useState } from "react";
import { COMPARE } from "@/lib/copy";
import { releaseShort } from "@/lib/format";
import { changesHref } from "@/lib/urls";
import { isMemberId } from "@/lib/data/ids";
import { isReleaseId } from "@/lib/data/release";
import { loadMemberSide, loadReleaseIndex, type SideResult } from "@/lib/data/compareLoad";
import { defaultPair, releaseOptionLabel, type ReleaseIndexEntry } from "@/lib/domain/compare";
import { ChangesResult, Explanation, type OkSide } from "./ChangesResult";
import "@/styles/changes.css";

type Sel = { m: string; from: string | null; to: string | null };
type Loaded = { key: string; a: SideResult; b: SideResult; name: string };
type Phase = "init" | "bad" | "off" | "empty" | "error" | "ready";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page page--narrow cmp" data-testid="changes-page">
      <h1>{COMPARE.title}</h1>
      {children}
    </div>
  );
}

function Picker({ id, label, value, entries, onChange }: { id: string; label: string; value: string | null; entries: ReleaseIndexEntry[]; onChange: (v: string) => void }) {
  const listed = entries.some((e) => e.release_id === value);
  return (
    <div className="cmp__pick">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={id}>
        {value && !listed && <option value={value}>{releaseShort(value)} (not in the list)</option>}
        {entries.map((e) => <option key={e.release_id} value={e.release_id}>{releaseOptionLabel(e)}</option>)}
      </select>
    </div>
  );
}

export function ChangesView({ pinned }: { pinned: boolean }) {
  const [phase, setPhase] = useState<Phase>("init");
  const [entries, setEntries] = useState<ReleaseIndexEntry[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const run = async () => {
      const q = new URLSearchParams(window.location.search);
      const m = q.get("m"), from = q.get("from"), to = q.get("to");
      if (!isMemberId(m) || (from !== null && !isReleaseId(from)) || (to !== null && !isReleaseId(to))) return setPhase("bad");
      if (!pinned) return setPhase("off");
      try {
        const list = await loadReleaseIndex();
        if (!live) return;
        if (!list.length) return setPhase("empty");
        const d = defaultPair(list);
        setEntries(list);
        setSel({ m, from: from ?? d.from, to: to ?? d.to });
        setPhase("ready");
      } catch {
        if (live) setPhase("empty");
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [pinned]);

  const key = sel && sel.from && sel.to && sel.from !== sel.to ? `${sel.m}|${sel.from}|${sel.to}` : null;
  useEffect(() => {
    if (!sel || !key || !sel.from || !sel.to) return;
    const { m, from, to } = sel;
    const built = (id: string) => entries.find((e) => e.release_id === id)?.build_time ?? null;
    let live = true;
    Promise.all([loadMemberSide(from, m, built(from)), loadMemberSide(to, m, built(to))])
      .then(([a, b]) => {
        if (!live) return;
        const name = (b.status === "ok" ? b.memberName : a.status === "ok" ? a.memberName : m);
        setLoaded({ key, a, b, name });
      })
      .catch(() => live && setFailed(key));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (phase === "init") return <Shell><div className="skeleton skeleton--table" aria-busy="true" /></Shell>;
  if (phase === "bad") return <Shell><div className="cmp__state" role="status" data-testid="cmp-bad"><h2>{COMPARE.badLinkTitle}</h2><p>{COMPARE.badLinkBody}</p></div></Shell>;
  if (phase === "off" || phase === "empty") {
    return (
      <Shell>
        <div className="cmp__state" role="status" data-testid="cmp-off">
          <h2>{COMPARE.notSwitchedOnTitle}</h2>
          <p>{COMPARE.notSwitchedOnBody}</p>
          {phase === "empty" && <p>{COMPARE.noIndexBody}</p>}
        </div>
      </Shell>
    );
  }
  if (!sel) return null;

  const set = (next: Sel) => {
    setSel(next);
    window.history.replaceState(null, "", changesHref(next.m, next.from, next.to));
  };
  const current = loaded && loaded.key === key ? loaded : null;
  const unavailable = current ? ([[sel.from, current.a], [sel.to, current.b]] as const).filter(([, r]) => r.status === "unavailable") : [];

  return (
    <Shell>
      <p className="lede">{COMPARE.description}</p>
      <p className="mono cmp__member" data-testid="cmp-member">{current?.name ?? sel.m} ({sel.m})</p>
      <form className="cmp__picks no-print" onSubmit={(e) => e.preventDefault()}>
        <Picker id="cmp-from" label={COMPARE.fromLabel} value={sel.from} entries={entries} onChange={(v) => set({ ...sel, from: v })} />
        <Picker id="cmp-to" label={COMPARE.toLabel} value={sel.to} entries={entries} onChange={(v) => set({ ...sel, to: v })} />
      </form>
      <p className="cmp__sub no-print">{COMPARE.indexAdvisory}</p>
      {!key && <div className="cmp__state" role="status" data-testid="cmp-same"><p>{COMPARE.sameRelease}</p></div>}
      {key && failed === key && <div className="cmp__state" role="alert" data-testid="cmp-error"><p>{COMPARE.loadError}</p></div>}
      {key && failed !== key && !current && <p role="status" aria-busy="true">{COMPARE.loading}</p>}
      {current && unavailable.length > 0 && (
        <div className="cmp__state" role="alert" data-testid="cmp-unavailable">
          {unavailable.map(([id]) => <p key={id}>{COMPARE.unavailable(releaseShort(id ?? ""))}</p>)}
          <Explanation />
        </div>
      )}
      {current && current.a.status === "ok" && current.b.status === "ok" && sel.from && sel.to && (
        <ChangesResult
          member={sel.m}
          a={{ id: sel.from, side: current.a.side, built: current.a.built } satisfies OkSide}
          b={{ id: sel.to, side: current.b.side, built: current.b.built } satisfies OkSide}
        />
      )}
    </Shell>
  );
}
