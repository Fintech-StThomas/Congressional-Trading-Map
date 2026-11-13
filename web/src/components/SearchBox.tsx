"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { loadSearchIndex, ORG_KIND_LABEL, type BoardMember, type SearchIndex } from "@/lib/client";
import { seat, STATE_NAMES } from "@/lib/format";

type Result =
  | { kind: "state"; code: string; label: string; sub: string }
  | { kind: "member"; m: BoardMember; label: string; sub: string }
  | { kind: "org"; id: string; label: string; sub: string };

function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Finds members by name and states by name or postal code. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [active, setActive] = useState(0);

  const load = () => {
    if (index || failed) return;
    loadSearchIndex().then(setIndex, () => setFailed(true));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results: Result[] = useMemo(() => {
    const t = fold(q.trim());
    if (!t) return [];
    const out: Result[] = [];
    for (const [code, name] of Object.entries(STATE_NAMES)) {
      if (fold(name).startsWith(t) || code.toLowerCase() === t) out.push({ kind: "state", code, label: name, sub: `State · ${code}` });
    }
    if (index) {
      const scored: [number, BoardMember][] = [];
      for (const m of index.members) {
        const n = fold(m.name);
        const last = fold(m.last);
        let s = -1;
        if (last.startsWith(t)) s = 0;
        else if (n.startsWith(t)) s = 1;
        else if (n.includes(t)) s = 2;
        else if (t.length === 2 && m.state.toLowerCase() === t) s = 3;
        if (s >= 0) scored.push([s + (m.current ? 0 : 0.5), m]);
      }
      scored.sort((a, b) => a[0] - b[0] || a[1].last.localeCompare(b[1].last));
      for (const [, m] of scored.slice(0, 8))
        out.push({ kind: "member", m, label: m.name, sub: `${m.party} · ${seat(m, false)}${m.current ? "" : " · former"}` });
      if (t.length >= 3) {
        let n = 0;
        for (const o of index.orgs) {
          if (n >= 4) break;
          if (fold(o.name).includes(t) || (o.ticker && o.ticker.toLowerCase() === t)) {
            out.push({ kind: "org", id: o.id, label: o.name, sub: `${ORG_KIND_LABEL[o.kind]}${o.ticker ? ` · ${o.ticker}` : ""} · ${o.degree} ${o.degree === 1 ? "member" : "members"}` });
            n++;
          }
        }
      }
    }
    return out.slice(0, 12);
  }, [q, index]);

  function choose(r: Result) {
    const href = r.kind === "state" ? `/?s=${r.code}` : r.kind === "member" ? `/?s=${r.m.state}&m=${r.m.id}` : `/?o=${encodeURIComponent(r.id)}`;
    setOpenList(false);
    setQ("");
    input.current?.blur();
    if (pathname === "/") {
      window.history.pushState(null, "", href);
      window.dispatchEvent(new Event("pt:locationchange"));
    } else router.push(href);
  }

  const listId = `${id}-list`;
  const showList = openList && q.trim().length > 0;
  return (
    <div className="search" role="search">
      <label htmlFor={`${id}-q`} className="visually-hidden">
        Search members, states or organisations
      </label>
      <svg className="search__icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.6 10.6 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        id={`${id}-q`}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search members, states, organisations"
        value={q}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${id}-o${active}` : undefined}
        onFocus={() => {
          load();
          setOpenList(true);
        }}
        onBlur={() => setTimeout(() => setOpenList(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpenList(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") {
            setOpenList(false);
          }
        }}
      />
      <kbd className="search__kbd" aria-hidden="true">/</kbd>
      {showList && (
        <ul className="search__list" id={listId} role="listbox" aria-label="Search results">
          {results.length === 0 && (
            <li className="search__none" role="option" aria-selected={false} aria-disabled="true">
              {index || failed ? `Nothing matches “${q.trim()}”.` : "Loading the index…"}
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.kind === "state" ? r.code : r.kind === "member" ? r.m.id : r.id}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="search__label">{r.label}</span>
              <span className="search__sub mono">{r.sub}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="visually-hidden" aria-live="polite">
        {showList ? `${results.length} results` : ""}
      </span>
    </div>
  );
}
