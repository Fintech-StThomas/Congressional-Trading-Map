"use client";
// One board in full: its name (rename, delete with a confirmation), a private board note, the saved items as cards
// (reorder with buttons, remove), the side-by-side comparison of ticked items, and export / share / print.
// Every change goes through the pure operations in lib/domain/saved.ts and is stored in this browser only.
import { useEffect, useId, useRef, useState } from "react";
import { SAVED } from "@/lib/copy";
import { deleteBoard, LIMITS, moveItem, removeItem, renameBoard, setBoardNote, setItemNote, type Board } from "@/lib/domain/saved";
import { apply, nowIso } from "./store";
import { BoardFollow } from "./BoardFollow";
import { CompareTable } from "./CompareTable";
import { ExportPanel } from "./ExportPanel";
import { ItemCard } from "./ItemCard";
import { NoteField } from "./NoteField";
import { PrintBlock } from "./PrintBlock";

export function BoardPanel({ board, pinned, onDeleted }: { board: Board; pinned: boolean; onDeleted: () => void }) {
  const uid = useId();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(board.title);
  const [confirm, setConfirm] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [printNotes, setPrintNotes] = useState(false);
  const [msg, setMsg] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const live = (m: string) => setMsg(m);

  useEffect(() => {
    if (renaming) nameInput.current?.focus();
  }, [renaming]);
  // Ticked items that are no longer on the board simply do not match any item below.

  const compare = board.items.filter((i) => picked.includes(i.key));

  function saveName() {
    const op = apply((s) => renameBoard(s, board.id, title, nowIso()));
    if (op.ok) {
      setRenaming(false);
      setTimeout(() => renameBtn.current?.focus(), 0);
    }
  }

  return (
    <section className="saved-board" aria-labelledby={`${uid}-h`} data-testid="saved-board">
      <div className="saved-board__head no-print">
        {renaming ? (
          <form className="saved-inline" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
            <label htmlFor={`${uid}-name`}>{SAVED.titleLabel}</label>
            <input ref={nameInput} id={`${uid}-name`} type="text" maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="saved-rename-input" />
            <button type="submit" className="btn btn--small" disabled={!title.trim()} data-testid="saved-rename-save">{SAVED.renameSave}</button>
            <button type="button" className="btn btn--small" onClick={() => { setRenaming(false); setTitle(board.title); }}>{SAVED.cancel}</button>
          </form>
        ) : (
          <>
            <h2 id={`${uid}-h`} ref={heading} tabIndex={-1}>{board.title}</h2>
            <button ref={renameBtn} type="button" className="btn btn--small" onClick={() => { setTitle(board.title); setRenaming(true); }} data-testid="saved-rename">{SAVED.rename}</button>
            <button type="button" className="btn btn--small" onClick={() => setConfirm(true)} data-testid="saved-delete">{SAVED.deleteBoard}</button>
          </>
        )}
      </div>
      {renaming && <h2 id={`${uid}-h`} className="visually-hidden">{board.title}</h2>}
      {confirm && (
        <div className="saved-confirm no-print" role="alertdialog" aria-labelledby={`${uid}-ask`}>
          <p id={`${uid}-ask`}>{SAVED.deleteAsk}</p>
          <button type="button" className="btn btn--small" onClick={() => { apply((s) => deleteBoard(s, board.id)); onDeleted(); }} data-testid="saved-delete-confirm">{SAVED.deleteConfirm}</button>
          <button type="button" className="btn btn--small" autoFocus onClick={() => setConfirm(false)}>{SAVED.cancel}</button>
        </div>
      )}
      <div className="no-print">
        <NoteField id={`${uid}-bnote`} label={SAVED.boardNoteLabel} value={board.note} onSave={(t) => apply((s) => setBoardNote(s, board.id, t, nowIso()))} testId="saved-board-note" />
        <p className="saved-count">{SAVED.boardCount(board.items.length)}</p>
        <BoardFollow board={board} />
        {board.items.length === 0 ? (
          <p className="saved-empty">{SAVED.noItems}</p>
        ) : (
          <>
            <p className="saved-hint">{SAVED.compare.hint}</p>
            <ol className="saved-items">
              {board.items.map((it, i) => (
                <ItemCard
                  key={it.key}
                  item={it}
                  index={i}
                  total={board.items.length}
                  pinned={pinned}
                  selected={picked.includes(it.key)}
                  onSelect={(on) => setPicked((p) => (on ? [...p, it.key] : p.filter((k) => k !== it.key)))}
                  onMove={(d) => {
                    const op = apply((s) => moveItem(s, board.id, it.key, d, nowIso()));
                    if (op.ok) live(SAVED.item.moved(it.label, i + d + 1, board.items.length));
                  }}
                  onRemove={() => { apply((s) => removeItem(s, board.id, it.key, nowIso())); live(SAVED.item.removedMsg(it.label)); heading.current?.focus(); }}
                  onNote={(t) => apply((s) => setItemNote(s, board.id, it.key, t, nowIso()))}
                />
              ))}
            </ol>
          </>
        )}
        {compare.length >= 2 && (
          <section className="saved-compare-sec" aria-labelledby={`${uid}-cmp`}>
            <h3 id={`${uid}-cmp`}>{SAVED.compare.heading} <span className="h-count mono">{SAVED.compare.pick(compare.length)}</span></h3>
            <CompareTable items={compare} />
          </section>
        )}
        <ExportPanel board={board} printNotes={printNotes} onPrintNotes={setPrintNotes} announce={live} />
        <p className="saved-msg" role="status" aria-live="polite" data-testid="saved-msg">{msg}</p>
      </div>
      <PrintBlock board={board} notes={printNotes} />
    </section>
  );
}
