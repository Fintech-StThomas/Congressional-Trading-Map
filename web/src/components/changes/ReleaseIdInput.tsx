"use client";
// Beside a /changes picker when the release list is longer than the picker shows: paste an older release's id. Only an
// id that is in the release list is accepted (the list stays the allow-list); anything else says why and changes nothing.
import { useState } from "react";
import { RELEASE_PICKER } from "@/lib/copy-permalink";
import type { ReleaseIndexEntry } from "@/lib/domain/compare";
import { findListedRelease } from "@/lib/domain/releaseOptions";

export function ReleaseIdInput({ id, entries, onPick }: { id: string; entries: ReleaseIndexEntry[]; onPick: (release: string) => void }) {
  const [text, setText] = useState("");
  const found = text.trim() === "" ? null : findListedRelease(entries, text);
  return (
    <div className="cmp__older">
      <label htmlFor={id}>{RELEASE_PICKER.inputLabel}</label>
      <input
        id={id} type="text" value={text} placeholder={RELEASE_PICKER.inputHint} spellCheck={false} autoComplete="off" className="mono"
        onChange={(e) => {
          setText(e.target.value);
          const r = findListedRelease(entries, e.target.value);
          if (r.status === "ok") onPick(r.id);
        }}
        aria-describedby={`${id}-msg`} aria-invalid={found !== null && found.status !== "ok"} data-testid={id}
      />
      <p id={`${id}-msg`} className="cmp__sub" role="status">{found?.status === "notId" ? RELEASE_PICKER.notId : found?.status === "notListed" ? RELEASE_PICKER.notListed : ""}</p>
    </div>
  );
}
