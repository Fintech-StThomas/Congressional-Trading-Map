"use client";
// The /saved page body (client): the plain statement of where boards live, storage notices, then either the board
// shared in the address (`#b=…`, read-only) or the reader's own boards: a list, a new-board form, the selected board
// in full, and import. Boards come from this browser's storage only (components/saved/store.ts).
import "@/styles/saved.css";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { WATCH } from "@/lib/copy-discovery";
import { watchHref } from "@/lib/urls";
import { SAVED } from "@/lib/copy";
import { createBoard, latestBoard } from "@/lib/domain/saved";
import { parseShareFragment, SHARE_PREFIX, type ParsedShare } from "@/lib/domain/saved-share";
import { readBackup } from "@/lib/domain/saved-storage";
import { download } from "@/components/shared/download";
import { BoardPanel } from "./BoardPanel";
import { ImportPanel } from "./ImportPanel";
import { SharedBoardView } from "./SharedBoard";
import { apply, newId, nowIso, storage, useSaved } from "./store";

function useFragment(): ParsedShare | null {
  const [parsed, setParsed] = useState<ParsedShare | null>(null);
  useEffect(() => {
    const read = () => setParsed(window.location.hash.startsWith(SHARE_PREFIX) ? parseShareFragment(window.location.hash) : null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return parsed;
}

export function SavedView({ pinned }: { pinned: boolean }) {
  const uid = useId();
  const { ready, state, status, memory, writeFailed } = useSaved();
  const shared = useFragment();
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const current = state.boards.find((b) => b.id === sel) ?? latestBoard(state);

  function create() {
    const id = newId();
    const op = apply((s) => createBoard(s, name, { id, now: nowIso() }));
    if (op.ok) {
      setSel(id);
      setName("");
      setErr("");
    } else setErr(op.reason === "limit" ? SAVED.save.boardsFull : SAVED.save.failed);
  }

  const backup = status.kind === "corrupt" && status.backupKey ? readBackup(storage(), status.backupKey) : null;

  return (
    <div className="page page--narrow saved" data-testid="saved-page">
      <h1>{SAVED.title}</h1>
      <p className="lede">{SAVED.lede}</p>
      <p className="saved-hint"><Link href={watchHref()} data-testid="saved-following-link">{WATCH.savedLink}</Link></p>
      <aside className="saved-privacy no-print" aria-labelledby={`${uid}-priv`} data-testid="saved-privacy">
        <h2 id={`${uid}-priv`}>{SAVED.privacyTitle}</h2>
        {SAVED.privacy.map((p) => <p key={p}>{p}</p>)}
      </aside>
      {memory && <p className="saved-warn" role="status" data-testid="saved-memory">{SAVED.memoryNotice}</p>}
      {writeFailed && <p className="saved-warn" role="status" data-testid="saved-write-failed">{SAVED.saveFailed}</p>}
      {status.kind === "corrupt" && (
        <div className="saved-warn" role="alert" data-testid="saved-corrupt">
          <p>{status.backupKey ? SAVED.corruptKept : SAVED.corruptNotKept}</p>
          {backup !== null && (
            <button type="button" className="btn btn--small" onClick={() => download("paper-trail-unreadable-saved-data.txt", backup, "text/plain")}>{SAVED.downloadUnreadable}</button>
          )}
        </div>
      )}
      {shared ? (
        shared.ok ? (
          <SharedBoardView key={shared.board.items.map((i) => i.key).join(",")} board={shared.board} pinned={pinned} />
        ) : (
          <p className="saved-err" role="alert" data-testid="saved-shared-invalid">{SAVED.shared.invalid(shared.error)}</p>
        )
      ) : !ready ? (
        <p className="saved-hint" role="status">{SAVED.loading}</p>
      ) : (
        <div className="saved-layout">
          <nav className="saved-list no-print" aria-label={SAVED.boardsHeading}>
            <h2>{SAVED.boardsHeading}</h2>
            {state.boards.length === 0 ? (
              <p className="saved-empty" data-testid="saved-empty">{SAVED.empty}</p>
            ) : (
              <ul>
                {state.boards.map((b) => (
                  <li key={b.id}>
                    <button type="button" className="saved-list__btn" aria-current={current?.id === b.id ? "true" : undefined} onClick={() => setSel(b.id)} data-testid="saved-board-pick">
                      <span>{b.title}</span>
                      <span className="mono">{SAVED.boardCount(b.items.length)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="saved-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
              <label htmlFor={`${uid}-new`}>{SAVED.newBoardHeading}</label>
              <input id={`${uid}-new`} type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-testid="saved-new-name" />
              <button type="submit" className="btn btn--small" disabled={!name.trim()} data-testid="saved-new-create">{SAVED.createBoard}</button>
              {err && <p className="saved-err" role="alert">{err}</p>}
            </form>
            <ImportPanel state={state} />
          </nav>
          <div className="saved-main">{current && <BoardPanel key={current.id} board={current} pinned={pinned} onDeleted={() => setSel(null)} />}</div>
        </div>
      )}
    </div>
  );
}
