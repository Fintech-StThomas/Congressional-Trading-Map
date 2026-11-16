"use client";
// "Cite this": a button that opens a small panel with the citation text (selectable), Copy, a JSON download and the
// permanent link, or the note saying there is none. Disclosure pattern: the button toggles the panel, focus moves to
// the panel's heading on open, Escape closes it and returns focus to the button. Built in the browser; sends nothing.
import "@/styles/cite.css";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CITE } from "@/lib/copy";
import { releaseShort } from "@/lib/format";
import { citationFilename, citationJson, citationText, type Citation } from "@/lib/domain/citation";
import { download } from "./download";

type Props = {
  /** Builds the packet for the moment of opening; `retrieved` is the ISO time. Called while the panel is open. */
  build: (retrieved: string) => Citation;
  label?: string;
  /** Tells the parent when the panel opens (the drawer fetches the build time only then). */
  onOpenChange?: (open: boolean) => void;
  block?: boolean;
  testId?: string;
};

export function CiteButton({ build, label = CITE.button, onOpenChange, block, testId = "cite" }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [retrieved, setRetrieved] = useState("");
  const [msg, setMsg] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  const toggle = (next: boolean) => {
    if (next) setRetrieved(new Date().toISOString());
    setMsg("");
    setOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    toggle(false);
    btn.current?.focus();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && open) {
      // Closes this panel only, not the evidence drawer around it.
      ev.stopPropagation();
      ev.nativeEvent.stopImmediatePropagation?.();
      close();
    }
  };

  const packet = open ? build(retrieved) : null;
  const text = packet ? citationText(packet) : "";

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setMsg(CITE.copied);
    } catch {
      area.current?.focus();
      area.current?.select();
      setMsg(CITE.copyFailed);
    }
  }
  function save() {
    if (!packet) return;
    download(citationFilename(packet), citationJson(packet), "application/json");
    setMsg(CITE.downloaded);
  }

  return (
    <div className={`cite no-print${block ? " cite--block" : ""}`} onKeyDown={onKey} data-testid={testId}>
      <button ref={btn} type="button" className="btn btn--small" aria-expanded={open} aria-controls={`${uid}-panel`} onClick={() => toggle(!open)} data-testid={`${testId}-button`}>
        {label}
      </button>
      {open && packet && (
        <div id={`${uid}-panel`} className="cite__panel" role="group" aria-labelledby={`${uid}-title`} data-testid={`${testId}-panel`}>
          <h3 id={`${uid}-title`} ref={title} tabIndex={-1} className="cite__title">{CITE.panelTitle}</h3>
          <p className="cite__intro">{CITE.intro}</p>
          <label className="cite__label" htmlFor={`${uid}-text`}>{CITE.textLabel}</label>
          <textarea id={`${uid}-text`} ref={area} className="cite__text" readOnly value={text} rows={12} onFocus={(e) => e.currentTarget.select()} data-testid={`${testId}-text`} />
          <div className="cite__actions">
            <button type="button" className="btn btn--small" onClick={copy} data-testid={`${testId}-copy`}>{CITE.copy}</button>
            <button type="button" className="btn btn--small" onClick={save} data-testid={`${testId}-download`}>{CITE.download}</button>
            <button type="button" className="btn btn--small" onClick={close}>{CITE.close}</button>
          </div>
          <p className="cite__msg" role="status" aria-live="polite" data-testid={`${testId}-msg`}>{msg}</p>
          {packet.links.permanent ? (
            <p className="cite__links" data-testid={`${testId}-permanent`}>
              {CITE.permanentLabel(releaseShort(packet.data.release ?? ""))}:<br />
              <a className="cite__url" href={packet.links.permanent}>{packet.links.permanent}</a>
            </p>
          ) : (
            <p className="cite__note" data-testid={`${testId}-nopermanent`}>{packet.permanence_note}</p>
          )}
          <p className="cite__links">
            {CITE.latestLabel}:<br />
            <a className="cite__url" href={packet.links.latest}>{packet.links.latest}</a>
          </p>
        </div>
      )}
    </div>
  );
}
