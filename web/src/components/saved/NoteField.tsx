"use client";
// A private note box: a labelled textarea that saves to the board after a short pause and when it loses focus.
// The text is the reader's own; it is never rendered as HTML and never leaves the browser.
import { useEffect, useRef, useState } from "react";
import { LIMITS } from "@/lib/domain/saved";

export function NoteField({ id, label, value, onSave, testId }: { id: string; label: string; value: string; onSave: (text: string) => void; testId?: string }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ text, onSave });
  useEffect(() => {
    latest.current = { text, onSave };
  });

  // Changes made in another tab arrive while the box is not being edited.
  useEffect(() => {
    if (!focused.current && !dirty.current) setText(value);
  }, [value]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) {
      dirty.current = false;
      latest.current.onSave(latest.current.text);
    }
  };
  useEffect(() => () => flush(), []);

  return (
    <div className="saved-note">
      <label className="saved-note__label" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="saved-note__text"
        rows={3}
        maxLength={LIMITS.note}
        value={text}
        data-testid={testId}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          dirty.current = true;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 700);
        }}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
      />
    </div>
  );
}
