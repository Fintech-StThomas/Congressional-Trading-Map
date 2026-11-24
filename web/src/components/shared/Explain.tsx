"use client";
// A plain-language explainer: a term styled as a button that opens a short definition beside it. Click, tap or Enter
// opens it; Escape or a click outside closes it and Escape returns focus to the term. Never hover-only. In print only
// the term is printed. Definitions are in lib/copy.ts (EXPLAIN) and lib/copy-finance.ts (FINANCE_EXPLAIN). The popover stays inside the viewport at 390 px.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { EXPLAIN } from "@/lib/copy";
import { FINANCE_EXPLAIN } from "@/lib/copy-finance";

export type ExplainTerm = "household" | "range" | "tie" | "statistical" | "nocategory";

/** `children` is the words shown as the button (default: the term itself); the definition always comes from EXPLAIN. */
export function Explain({ term, children }: { term: ExplainTerm; children?: React.ReactNode }) {
  const def = term === "nocategory" ? FINANCE_EXPLAIN.nocategory : EXPLAIN[term];
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    // Capture phase at window: Escape closes this popover before anything else (such as the evidence drawer) sees it.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (ev: PointerEvent) => {
      if (!wrap.current?.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Keep the popover inside the viewport: shift it left by however far it overflows the right edge.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    el.style.transform = "";
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.transform = `translateX(${-Math.ceil(over)}px)`;
  }, [open]);

  return (
    <span className="explain" ref={wrap}>
      <button ref={button} type="button" className="explain__term" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-testid={`explain-${term}`}>
        {children ?? def.label}
        <span className="visually-hidden"> ({EXPLAIN.hint})</span>
      </button>
      <span id={id} ref={pop} className="explain__pop no-print" role="note" hidden={!open} data-testid={`explain-${term}-text`}>
        <strong className="explain__h">{def.label}</strong>
        {def.body}
        <button type="button" className="explain__close" onClick={() => { setOpen(false); button.current?.focus(); }}>
          {EXPLAIN.close}
        </button>
      </span>
    </span>
  );
}
