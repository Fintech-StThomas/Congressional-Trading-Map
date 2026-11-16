"use client";
// The board's toolbar: breadcrumbs (United States / state / member or organisation), the state
// picker, the family chips with their counts, the year window and the board/table toggle.
import { FAMILIES, FAMILY_HINT, FAMILY_LABEL, type Family } from "@/lib/domain/edges";
import { stateName } from "@/lib/format";
import { LineSample } from "@/components/shared/LineSample";
import { YearRange } from "@/components/shared/YearRange";
import { EMPTY, type Sel } from "./types";

type Props = {
  sel: Sel;
  /** The state in view: the selected state, or the centre member's state. */
  viewState: string | null;
  memberName: string | null;
  orgName: string | null;
  states: Record<string, string[]>;
  families: Set<Family>;
  /** Strings per family on the current board, or null when nothing is centred. */
  familyCounts: Record<Family, number> | null;
  range: [number, number];
  view: "board" | "table";
  go: (next: Sel) => void;
  selectState: (code: string) => void;
  onToggleFamily: (f: Family) => void;
  onRange: (r: [number, number]) => void;
  onToggleView: () => void;
};

export function Toolbar({ sel, viewState, memberName, orgName, states, families, familyCounts, range, view, go, selectState, onToggleFamily, onRange, onToggleView }: Props) {
  return (
  <div className="board__toolbar">
    <nav className="crumbs" aria-label="Board position">
      <button type="button" className="crumb" onClick={() => go(EMPTY)} aria-current={!sel.s && !sel.m && !sel.o ? "true" : undefined}>
        United States
      </button>
      {viewState && (
        <>
          <Sep />
          <button type="button" className="crumb" onClick={() => go({ ...EMPTY, s: viewState })} aria-current={sel.s && !sel.m ? "true" : undefined}>
            {stateName(viewState)}
          </button>
        </>
      )}
      {memberName && (
        <>
          <Sep />
          <span className="crumb is-current" aria-current="true">{memberName}</span>
        </>
      )}
      {sel.o && !sel.m && (
        <>
          <Sep />
          <span className="crumb is-current" aria-current="true">{orgName ?? "Organisation"}</span>
        </>
      )}
    </nav>
    <label className="statepick">
      <span className="visually-hidden">Choose a state</span>
      <select value={viewState ?? ""} onChange={(e) => (e.target.value ? selectState(e.target.value) : go(EMPTY))}>
        <option value="">Choose a state…</option>
        {Object.keys(states)
          .sort((a, b) => stateName(a).localeCompare(stateName(b)))
          .map((st) => (
            <option key={st} value={st}>
              {stateName(st)} ({states[st].length})
            </option>
          ))}
      </select>
    </label>
    <div className="board__controls">
      <div className="chips" role="group" aria-label="Kinds of string to show">
        {FAMILIES.map((f) => {
          const on = families.has(f);
          return (
            <button
              key={f}
              type="button"
              className="chip"
              aria-pressed={on}
              title={FAMILY_HINT[f]}
              onClick={() => onToggleFamily(f)}
            >
              <LineSample style={f === "context" ? "context" : "filed"} width={18} />
              {FAMILY_LABEL[f]}
              {familyCounts && <span className="mono chip__n">{familyCounts[f]}</span>}
            </button>
          );
        })}
      </div>
      <YearRange value={range} onChange={onRange} />
      <button type="button" className="btn viewtoggle" aria-pressed={view === "table"} onClick={onToggleView}>
        {view === "board" ? "View as table" : "View as board"}
      </button>
    </div>
  </div>
  );
}

function Sep() {
  return (
    <svg className="crumbs__sep" viewBox="0 0 8 12" width="7" height="11" aria-hidden="true">
      <path d="M2 1l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
