"use client";
// Export and share for one board: the JSON file (private notes only when the box is ticked), all citations as text,
// a share link (title and record ids only), and printing. Everything is built in the browser from the saved board.
import { useId, useRef, useState } from "react";
import { SAVED } from "@/lib/copy";
import { savedHref } from "@/lib/urls";
import { boardFilename, citationsText, exportBoard, type Board } from "@/lib/domain/saved";
import { shareFragment } from "@/lib/domain/saved-share";
import { download } from "@/components/shared/download";

export function ExportPanel({ board, printNotes, onPrintNotes, announce }: {
  board: Board; printNotes: boolean; onPrintNotes: (on: boolean) => void; announce: (msg: string) => void;
}) {
  const uid = useId();
  const [notes, setNotes] = useState(false);
  const [link, setLink] = useState("");
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function copyLink() {
    const frag = shareFragment(board);
    if (!frag) return announce(SAVED.linkTooLarge);
    const url = new URL(savedHref(frag), window.location.href).href;
    setLink(url);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setFailed(false);
      announce(SAVED.linkCopied);
    } catch {
      setFailed(true);
      announce(SAVED.linkFailed);
      setTimeout(() => field.current?.select(), 0);
    }
  }

  return (
    <section className="saved-export" aria-labelledby={`${uid}-h`} data-testid="saved-export">
      <h3 id={`${uid}-h`}>{SAVED.exportHeading}</h3>
      <div className="saved-export__row">
        <button type="button" className="btn" onClick={() => { download(boardFilename(board, "json"), exportBoard(board, { includeNotes: notes }), "application/json"); announce(SAVED.downloaded); }} data-testid="saved-download-json">
          {SAVED.downloadBoard}
        </button>
        <label className="saved-check">
          <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} data-testid="saved-include-notes" aria-describedby={`${uid}-notes`} />
          {SAVED.includeNotes}
        </label>
      </div>
      <p id={`${uid}-notes`} className="saved-hint">{notes ? SAVED.notesOn : SAVED.notesOff}</p>
      <div className="saved-export__row">
        <button type="button" className="btn" onClick={() => { download(boardFilename(board, "txt"), citationsText(board, SAVED.noCitationText), "text/plain"); announce(SAVED.downloaded); }} disabled={board.items.length === 0} data-testid="saved-download-citations">
          {SAVED.downloadCitations}
        </button>
        <button type="button" className="btn" onClick={copyLink} disabled={board.items.length === 0} data-testid="saved-copy-link">{SAVED.copyLink}</button>
      </div>
      <p className="saved-hint">{SAVED.linkNote}</p>
      {link && (
        <div className="saved-link">
          <label htmlFor={`${uid}-link`}>{SAVED.linkLabel}</label>
          <input ref={field} id={`${uid}-link`} type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-testid="saved-link" aria-invalid={failed || undefined} />
        </div>
      )}
      <div className="saved-export__row">
        <button type="button" className="btn" onClick={() => window.print()} data-testid="saved-print">{SAVED.printBoard}</button>
        <label className="saved-check">
          <input type="checkbox" checked={printNotes} onChange={(e) => onPrintNotes(e.target.checked)} data-testid="saved-print-notes" />
          {SAVED.printNotes}
        </label>
      </div>
    </section>
  );
}
