"use client";
// One saved record on a board, as a readable card: what was saved (names, amount text and years as displayed then),
// the data release it came from, links to the current page and to the page as of that release, a re-check against
// the current data that never overwrites what was saved, a private note, and keyboard-operable move and remove buttons.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SAVED } from "@/lib/copy";
import { date, releaseShort } from "@/lib/format";
import { memberHref, orgHref, releaseMemberHref } from "@/lib/urls";
import type { Item } from "@/lib/domain/saved";
import { NoteField } from "./NoteField";
import { lookup } from "./resolve";

type Check = { state: "idle" | "checking" } | { state: "done"; outcome: "same" | "missing" | "error" | { different: string } };

export function ItemCard({ item, index, total, pinned, selected, onSelect, onMove, onRemove, onNote }: {
  item: Item; index: number; total: number; pinned: boolean; selected: boolean;
  onSelect: (on: boolean) => void; onMove: (delta: -1 | 1) => void; onRemove: () => void; onNote: (text: string) => void;
}) {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const root = useRef<HTMLLIElement>(null);
  const pending = useRef<"up" | "down" | null>(null);

  // After a move the same button should keep focus (the browser may drop it when the node is re-inserted).
  useEffect(() => {
    if (!pending.current) return;
    const want = pending.current;
    pending.current = null;
    const q = (a: string) => root.current?.querySelector<HTMLButtonElement>(`[data-act="${a}"]`);
    const first = q(want);
    (first && !first.disabled ? first : q(want === "up" ? "down" : "up"))?.focus();
  }, [index]);

  async function recheck() {
    setCheck({ state: "checking" });
    const r = await lookup(item, { useItemRelease: false, pinned });
    if (r.state !== "found") return setCheck({ state: "done", outcome: r.state });
    const nowText = item.kind === "tie" ? [r.amount_text, r.years].filter(Boolean).join(", ") : r.label;
    const savedText = item.kind === "tie" ? [item.amount_text, item.years].filter(Boolean).join(", ") : item.label;
    setCheck({ state: "done", outcome: nowText === savedText ? "same" : { different: nowText } });
  }

  const I = SAVED.item;
  const short = item.release ? releaseShort(item.release) : null;
  const pinnedHref = item.release && item.member ? releaseMemberHref(item.release, item.member) : null;
  const move = (d: -1 | 1) => {
    pending.current = d < 0 ? "up" : "down";
    onMove(d);
  };
  const result = check.state !== "done" ? "" : check.outcome === "same" ? I.same : check.outcome === "missing" ? I.missing : check.outcome === "error" ? I.error : I.different(check.outcome.different);

  return (
    <li ref={root} className="saved-item" data-testid="saved-item">
      <div className="saved-item__head">
        <input type="checkbox" id={`cmp-${item.key}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} data-testid="saved-compare-pick" />
        <label htmlFor={`cmp-${item.key}`} className="visually-hidden">{`${I.compare}: ${item.label}`}</label>
        <span className="saved-item__kind">{SAVED.kind[item.kind]}</span>
        <h4 className="saved-item__label">{item.label}</h4>
      </div>
      <dl className="saved-item__facts">
        <div><dt>{I.amountLabel}</dt><dd className="mono">{item.kind === "tie" ? item.amount_text : I.noAmount}</dd></div>
        <div><dt>{I.yearsLabel}</dt><dd className="mono">{item.years || SAVED.compare.notRecorded}</dd></div>
        <div><dt>{short ? I.release(short) : I.latestAtTime}</dt><dd className="mono">{I.savedOn(date(item.saved.slice(0, 10)))}</dd></div>
      </dl>
      <p className="saved-item__links">
        {item.member && <Link href={memberHref(item.member)}>{I.openMember}</Link>}
        {item.org && <Link href={orgHref(item.org)}>{I.openOrg}</Link>}
        {pinnedHref && short && <Link href={pinnedHref}>{I.openPinned(short)}</Link>}
      </p>
      <div className="saved-item__check">
        <button type="button" className="btn btn--small" onClick={recheck} disabled={check.state === "checking"} data-testid="saved-recheck">
          {check.state === "checking" ? I.checking : I.recheck}
        </button>
        <p role="status" aria-live="polite" className="saved-item__result" data-testid="saved-recheck-result">{result}</p>
      </div>
      <NoteField id={`note-${item.key}`} label={SAVED.noteLabel} value={item.note} onSave={onNote} testId="saved-item-note" />
      <div className="saved-item__actions">
        <button type="button" className="btn btn--small" data-act="up" disabled={index === 0} onClick={() => move(-1)} data-testid="saved-up">{I.up}<span className="visually-hidden">: {item.label}</span></button>
        <button type="button" className="btn btn--small" data-act="down" disabled={index === total - 1} onClick={() => move(1)} data-testid="saved-down">{I.down}<span className="visually-hidden">: {item.label}</span></button>
        <button type="button" className="btn btn--small" onClick={onRemove} data-testid="saved-remove">{I.remove}<span className="visually-hidden">: {item.label}</span></button>
      </div>
    </li>
  );
}
