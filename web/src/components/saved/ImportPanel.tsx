"use client";
// Import a board file (JSON). The file is read in the browser, validated strictly and merged into the reader's boards
// without overwriting any of them; problems are shown plainly and nothing is changed when the file is refused.
import { useId, useState } from "react";
import { SAVED } from "@/lib/copy";
import { importBoards, LIMITS, type SavedState } from "@/lib/domain/saved";
import { commit, newId } from "./store";

export function ImportPanel({ state }: { state: SavedState }) {
  const uid = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState("");

  async function onFile(file: File | undefined) {
    setErrors([]);
    setDone("");
    if (!file) return;
    if (file.size > LIMITS.fileChars) return setErrors(["The file is too large to be a saved-boards file."]);
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setErrors(["The file could not be read."]);
    }
    const r = importBoards(text, state, newId);
    if (!r.ok) return setErrors(r.errors);
    commit(r.state);
    setDone(SAVED.importDone(r.added, r.renamed) + (r.notesIncluded ? ` ${SAVED.importNotesIn}` : ""));
  }

  return (
    <section className="saved-import no-print" aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>{SAVED.importHeading}</h3>
      <label htmlFor={`${uid}-f`} className="saved-import__label">{SAVED.importLabel}</label>
      <input id={`${uid}-f`} type="file" accept="application/json,.json" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} data-testid="saved-import" />
      <div role="status" aria-live="polite">
        {done && <p className="saved-ok" data-testid="saved-import-done">{done}</p>}
        {errors.length > 0 && (
          <div className="saved-err" data-testid="saved-import-errors">
            <p>{SAVED.importFailed}</p>
            <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
