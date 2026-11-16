"use client";
// A "More ▾" menu button for the actions a page keeps out of its main row (header navigation, the member page's
// share and export actions). Disclosure pattern, not an ARIA menu: the button toggles a list of links and buttons,
// so Tab, Shift+Tab, Enter and Space behave as everywhere else. Extras: Arrow keys, Home and End move between items;
// Escape and a click outside close it (Escape returns focus to the button); tabbing out of the menu closes it; choosing
// an item closes it. Nothing is hover-only, and touch works the same as click. Styles: styles/menu.css.
import "@/styles/menu.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  /** The visible label of the button. */
  label: string;
  /** The button's accessible name when it needs to say more than the label (it must contain the label). */
  ariaLabel?: string;
  /** One entry per item: a link or a button styled with the `menu__item` class. */
  items: ReactNode[];
  /** The current page is one of the items: marks the button (`aria-current`) so the section reads as active. */
  current?: boolean;
  className?: string;
  /** Names a test hook on the button; the list gets `<id>-list`. */
  testId?: string;
  /** An extra class for the list, for a parent that restyles it (the phone header lays it out inline). */
  panelClass?: string;
};

export function ActionMenu({ label, ariaLabel, items, current, className, testId, panelClass }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);

  // Keep the list inside the viewport: left-aligned to the button unless that would run off the right edge.
  useLayoutEffect(() => {
    if (!open || !btn.current || !list.current) return;
    const b = btn.current.getBoundingClientRect();
    const w = list.current.getBoundingClientRect().width;
    setEnd(b.left + w > window.innerWidth - 8 && b.right - w >= 8);
  }, [open]);

  const focusItem = (to: number | "first" | "last") => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
    if (!els.length) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    const i = to === "first" ? 0 : to === "last" ? els.length - 1 : Math.min(els.length - 1, Math.max(0, at + to));
    els[i].focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close(true);
    } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      focusItem(e.key === "ArrowDown" ? 1 : -1);
    } else if (open && e.key === "Home") {
      e.preventDefault();
      focusItem("first");
    } else if (open && e.key === "End") {
      e.preventDefault();
      focusItem("last");
    } else if (!open && e.key === "ArrowDown" && e.target === btn.current) {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusItem("first"));
    }
  };

  return (
    <div
      ref={root}
      className={`menu${className ? ` ${className}` : ""}`}
      onKeyDown={onKey}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false);
      }}
      data-open={open || undefined}
    >
      <button
        ref={btn}
        type="button"
        className="btn menu__btn"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-label={ariaLabel}
        aria-current={current ? "true" : undefined}
        data-current={current || undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        <span>{label}</span>
        <svg className="menu__caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul
        id={`${uid}-list`}
        ref={list}
        className={`menu__list${end ? " is-end" : ""}${panelClass ? ` ${panelClass}` : ""}`}
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href], button")) setOpen(false);
        }}
        data-testid={testId ? `${testId}-list` : undefined}
      >
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
