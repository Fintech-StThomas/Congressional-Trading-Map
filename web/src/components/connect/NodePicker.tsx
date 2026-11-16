"use client";
// One end of the connection search: a combobox over the search index (members and organisations). Once an end is
// chosen it shows its name with a Change button; the id lives in the page address, not here.
import { useId, useMemo, useRef, useState } from "react";
import type { SearchIndex } from "@/lib/data/fetch";
import { CONNECT } from "@/lib/copy";
import { ORG_KIND_LABEL } from "@/lib/domain/names";
import { count, seat } from "@/lib/format";

type Option = { id: string; label: string; sub: string };

function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Props = {
  label: string;
  /** The chosen id, or null. */
  value: string | null;
  /** Its name, once known. */
  name: string | null;
  index: SearchIndex | null;
  indexFailed: boolean;
  onFocus: () => void;
  onChange: (id: string | null) => void;
};

export function NodePicker({ label, value, name, index, indexFailed, onFocus, onChange }: Props) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options: Option[] = useMemo(() => {
    const t = fold(q.trim());
    if (!t || !index) return [];
    const out: Option[] = [];
    const ms: [number, Option][] = [];
    for (const m of index.members) {
      const n = fold(m.name);
      const s = fold(m.last).startsWith(t) ? 0 : n.startsWith(t) ? 1 : n.includes(t) ? 2 : -1;
      if (s >= 0) ms.push([s + (m.current ? 0 : 0.5), { id: m.id, label: m.name, sub: `Member · ${m.party} · ${seat(m, false)}${m.current ? "" : " · former"}` }]);
    }
    ms.sort((x, y) => x[0] - y[0] || x[1].label.localeCompare(y[1].label));
    out.push(...ms.slice(0, 6).map((x) => x[1]));
    if (t.length >= 2) {
      let n = 0;
      for (const o of index.orgs) {
        if (n >= 6) break;
        if (fold(o.name).includes(t) || o.ticker?.toLowerCase() === t) {
          out.push({ id: o.id, label: o.name, sub: `${ORG_KIND_LABEL[o.kind]}${o.ticker ? ` · ${o.ticker}` : ""} · ${count(o.degree)} ${o.degree === 1 ? "member" : "members"}` });
          n++;
        }
      }
    }
    return out;
  }, [q, index]);

  const listId = `${uid}-list`;
  const show = open && q.trim().length > 0;
  const choose = (o: Option) => {
    setQ("");
    setOpen(false);
    onChange(o.id);
  };

  if (value) {
    return (
      <div className="cpick">
        <span className="cpick__label" id={`${uid}-l`}>{label}</span>
        <div className="cpick__chosen" role="group" aria-labelledby={`${uid}-l`}>
          <span className="cpick__name">{name ?? value}</span>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              onChange(null);
              setTimeout(() => input.current?.focus(), 0);
            }}
            aria-label={`${CONNECT.pick.change}: ${label} (${name ?? value})`}
          >
            {CONNECT.pick.change}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="cpick">
      <label className="cpick__label" htmlFor={`${uid}-q`}>{label}</label>
      <div className="cpick__box">
        <input
          ref={input}
          id={`${uid}-q`}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={CONNECT.pick.placeholder}
          value={q}
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && options[active] ? `${uid}-o${active}` : undefined}
          onFocus={() => {
            onFocus();
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && options[active]) {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {show && (
          <ul className="cpick__list" id={listId} role="listbox" aria-label={`${label}: results`}>
            {options.length === 0 && (
              <li className="cpick__none" role="option" aria-selected={false} aria-disabled="true">
                {index || indexFailed ? CONNECT.pick.none : CONNECT.pick.loading}
              </li>
            )}
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-o${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="cpick__olabel">{o.label}</span>
                <span className="cpick__osub mono">{o.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
