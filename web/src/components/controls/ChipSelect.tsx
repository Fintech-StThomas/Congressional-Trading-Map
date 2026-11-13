"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ChipOption = { value: string; label: string; short?: string };

/**
 * A chip that opens a small listbox: the board's filter-chip look, with the
 * keyboard model of a select (arrows, Home/End, Enter, Escape, type to search).
 */
export function ChipSelect({ label, value, options, onChange, search = false, searchLabel }: {
  label: string; value: string; options: ChipOption[]; onChange: (v: string) => void; search?: boolean; searchLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase() === s) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", off);
    (search ? input.current : list.current)?.focus();
    return () => document.removeEventListener("pointerdown", off);
  }, [open, search]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openAt = () => {
    setQ("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: ChipOption | undefined) => {
    if (o) onChange(o.value);
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = shown.length;
    if (e.key === "ArrowDown") setActive((a) => Math.min(n - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home" && !search) setActive(0);
    else if (e.key === "End" && !search) setActive(n - 1);
    else if (e.key === "Enter") choose(shown[active]);
    else if (e.key === "Escape") {
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
    else return;
    e.preventDefault();
  };

  return (
    <div className="chipsel" ref={box}>
      <button
        ref={btn}
        type="button"
        className="chip chip--select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openAt();
          }
        }}
      >
        <span className="chip__k">{label}</span>
        <span className="chip__v">{current?.short ?? current?.label}</span>
        <svg className="chip__caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <div className="chipsel__pop">
          {search && (
            <input
              ref={input}
              className="chipsel__search"
              type="search"
              placeholder={searchLabel ?? "Search"}
              aria-label={searchLabel ?? `Search ${label.toLowerCase()}`}
              value={q}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={shown[active] ? `${id}-o${active}` : undefined}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          )}
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={search ? -1 : 0}
            className="chipsel__list"
            aria-activedescendant={!search && shown[active] ? `${id}-o${active}` : undefined}
            onKeyDown={search ? undefined : onKey}
          >
            {shown.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-o${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={i === active ? "is-active" : undefined}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.label}
              </li>
            ))}
            {shown.length === 0 && <li className="chipsel__none" role="presentation">No match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** An on/off switch styled as a chip. */
export function Switch({ label, on, onChange, disabled, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      title={hint}
      className="chip chip--switch"
      onClick={() => !disabled && onChange(!on)}
    >
      <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
      {label}
    </button>
  );
}

/** Segmented control on native radios (arrow keys work as in any radio group). */
export function Segmented<T extends string>({ label, name, value, options, onChange }: {
  label: string; name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="seg">
      <legend className="visually-hidden">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "is-on" : undefined}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
