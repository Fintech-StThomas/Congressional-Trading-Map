"use client";
// On a permanent page (/r/<release>/m/<id>): after first paint, compares this member's files in the page's release with
// the latest release (the /changes loader and comparison, in the browser) and says what differs, directly under the
// release banner. Header counts that differ show "X in this snapshot · Y in today's data" beside the snapshot's own
// figure, which is never altered. A comparison that cannot load is said plainly. Wording is in lib/copy.ts (SNAPSHOT).
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { SNAPSHOT } from "@/lib/copy";
import { count } from "@/lib/format";
import { changesHref } from "@/lib/urls";
import { loadMemberSide } from "@/lib/data/compareLoad";
import { loadLatestRelease } from "@/lib/data/latest";
import { compareMember } from "@/lib/domain/compare";
import { Notice } from "@/components/shared/Notice";
import { differingCounts, snapshotParts, type CountKind, type HeaderCounts } from "@/lib/domain/snapshot";

type State =
  | { phase: "loading" }
  | { phase: "same" }
  | { phase: "error" }
  | { phase: "changed"; latest: string; parts: string[]; later: Partial<HeaderCounts> };

const Ctx = createContext<{ state: State; member: string; release: string; counts: HeaderCounts } | null>(null);

/** Wraps the permalink page: runs the comparison once and shares the result with the note and the header counts. */
export function SnapshotProvider({ release, member, counts, children }: { release: string; member: string; counts: HeaderCounts; children: React.ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let live = true;
    // Lazily, after first paint: the page is already readable before any of this is fetched.
    const timer = setTimeout(async () => {
      try {
        const latest = await loadLatestRelease((u) => fetch(u, { cache: "no-store" }));
        if (!live) return;
        if (latest === release) return setState({ phase: "same" });
        const [a, b] = await Promise.all([loadMemberSide(release, member, null), loadMemberSide(latest, member, null)]);
        if (!live) return;
        if (a.status !== "ok" || b.status !== "ok") return setState({ phase: "error" });
        const parts = snapshotParts(compareMember(member, a.side, b.side));
        setState({ phase: "changed", latest, parts, later: differingCounts(counts, b.counts) });
      } catch {
        if (live) setState({ phase: "error" });
      }
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, member]);

  return <Ctx.Provider value={{ state, member, release, counts }}>{children}</Ctx.Provider>;
}

/** The note under the release banner. Nothing while loading or when this release is the latest. */
export function SnapshotNote() {
  const c = useContext(Ctx);
  const s = c?.state;
  return (
    <div aria-live="polite" className="snapshot-slot no-print">
      {c && s?.phase === "error" && (
        <Notice tone="snapshot" className="snapshot-note" data-testid="snapshot-note" data-state="error"><p>{SNAPSHOT.error}</p></Notice>
      )}
      {c && s?.phase === "changed" && (
        <Notice tone="snapshot" className="snapshot-note" data-testid="snapshot-note" data-state={s.parts.length ? "changed" : "unchanged"}>
          <p>
          {s.parts.length ? (
            <>
              {SNAPSHOT.since(s.parts.join(", "))} <Link href={changesHref(c.member, c.release, s.latest)}>{SNAPSHOT.seeChanges}</Link>
            </>
          ) : (
            SNAPSHOT.unchanged
          )}
          </p>
        </Notice>
      )}
    </div>
  );
}

/** Beside one header count: "186 in this snapshot · 188 in today's data", only when the latest data differs. */
export function SnapshotCount({ kind }: { kind: CountKind }) {
  const c = useContext(Ctx);
  if (!c || c.state.phase !== "changed") return null;
  const latest = c.state.later[kind];
  if (latest === undefined) return null;
  return <span className="snapshot-count no-print" data-testid={`snapshot-count-${kind}`}>{SNAPSHOT.count(count(c.counts[kind]), count(latest))}</span>;
}
