"use client";
// "Save": a button that opens a small panel to save a record (a tie, a member) to one of the reader's boards, or to
// take it off again. Disclosure pattern like "Cite this": the button toggles the panel, focus moves to its heading,
// Escape closes it and returns focus. Everything is stored in this browser only; the confirmation is an aria-live message.
import "@/styles/saved.css";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SAVED } from "@/lib/copy";
import { addItem, boardsContaining, createBoard, itemKey, latestBoard, makeItem, removeItem, type ItemInput } from "@/lib/domain/saved";
import { apply, newId, nowIso, useSaved } from "./store";

const NEW = "__new";

type Props = {
  /** The record's ids; its identity on a board. */
  identity: { kind: ItemInput["kind"]; member?: string; org?: string; edge?: string };
  /** What to store, built at the moment of saving (so a citation carries that moment's time). */
  build: () => ItemInput;
  /** Tells the parent when the panel opens (the drawer fetches the build time only then). */
  onOpenChange?: (open: boolean) => void;
  testId?: string;
};

export function SaveButton({ identity, build, onOpenChange, testId = "save" }: Props) {
  const uid = useId();
  const { state, ready, memory } = useSaved();
  const key = itemKey(identity);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  if (!key) return null;
  const inBoards = ready ? boardsContaining(state, key) : [];
  const free = state.boards.filter((b) => !inBoards.some((x) => x.id === b.id));
  const latest = latestBoard({ ...state, boards: free });
  const effective = choice && (choice === NEW || free.some((b) => b.id === choice)) ? choice : latest?.id ?? NEW;
  const nameValue = name || (state.boards.length === 0 ? SAVED.save.firstBoard : "");

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) setMsg("");
    onOpenChange?.(next);
  };
  const close = () => {
    toggle(false);
    btn.current?.focus();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && open) {
      ev.stopPropagation();
      ev.nativeEvent.stopImmediatePropagation?.();
      close();
    }
  };

  function save() {
    const now = nowIso();
    const item = makeItem(build(), now);
    if (!item) return setMsg(SAVED.save.failed);
    let label = "";
    const op = apply((s) => {
      if (effective === NEW) {
        label = nameValue.trim().replace(/\s+/g, " ") || SAVED.save.firstBoard;
        const id = newId();
        const made = createBoard(s, label, { id, now });
        return made.ok ? addItem(made.state, id, item, now) : made;
      }
      label = s.boards.find((b) => b.id === effective)?.title ?? "";
      return addItem(s, effective, item, now);
    });
    setMsg(op.ok ? SAVED.save.added(label) : op.reason === "limit" && effective === NEW ? SAVED.save.boardsFull : SAVED.save.failed);
    if (op.ok) {
      setChoice(null);
      setName("");
    }
  }
  function remove(boardId: string, boardTitle: string) {
    const op = apply((s) => removeItem(s, boardId, key!, nowIso()));
    setMsg(op.ok ? SAVED.save.removed(boardTitle) : SAVED.save.failed);
  }

  return (
    <div className="save no-print" onKeyDown={onKey} data-testid={testId}>
      <button
        ref={btn}
        type="button"
        className="btn btn--small save__btn"
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        onClick={() => toggle(!open)}
        data-saved={inBoards.length > 0 ? "true" : "false"}
        data-testid={`${testId}-button`}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="save__icon">
          <path d="M4 2h8v12l-4-3-4 3z" fill={inBoards.length > 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        {inBoards.length > 0 ? SAVED.save.saved : SAVED.save.button}
        {inBoards.length > 0 && <span className="visually-hidden"> ({SAVED.boardCount(inBoards.length)})</span>}
      </button>
      {open && (
        <div id={`${uid}-panel`} className="save__panel" role="group" aria-labelledby={`${uid}-title`} data-testid={`${testId}-panel`}>
          <h3 id={`${uid}-title`} ref={title} tabIndex={-1} className="save__title">{SAVED.save.panelTitle}</h3>
          {inBoards.length > 0 && (
            <div className="save__in">
              <p className="save__label">{SAVED.save.savedIn}</p>
              <ul>
                {inBoards.map((b) => (
                  <li key={b.id}>
                    <span>{b.title}</span>
                    <button type="button" className="btn btn--small" onClick={() => remove(b.id, b.title)} data-testid={`${testId}-remove`}>
                      {SAVED.save.remove(b.title)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="save__form">
            <label className="save__label" htmlFor={`${uid}-board`}>{SAVED.save.saveTo}</label>
            <select id={`${uid}-board`} className="save__select" value={effective} onChange={(e) => setChoice(e.target.value)} data-testid={`${testId}-board`}>
              {free.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              <option value={NEW}>{SAVED.save.newBoard}</option>
            </select>
            {effective === NEW && (
              <>
                <label className="save__label" htmlFor={`${uid}-name`}>{SAVED.save.newName}</label>
                <input id={`${uid}-name`} className="save__input" type="text" maxLength={120} value={nameValue} onChange={(e) => setName(e.target.value)} data-testid={`${testId}-name`} />
              </>
            )}
            <div className="save__actions">
              <button type="button" className="btn btn--small" onClick={save} data-testid={`${testId}-confirm`}>{SAVED.save.confirm}</button>
              <button type="button" className="btn btn--small" onClick={close}>{SAVED.save.close}</button>
            </div>
          </div>
          <p className="save__msg" role="status" aria-live="polite" data-testid={`${testId}-msg`}>{msg}</p>
          <p className="save__note">{memory ? SAVED.memoryNotice : SAVED.save.privateNote} <Link href="/saved">{SAVED.save.viewBoards}</Link></p>
        </div>
      )}
    </div>
  );
}
