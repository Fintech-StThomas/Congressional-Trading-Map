"use client";
// A member search for the export and embed pages: type part of a name, choose from the matches (search index, so every
// member and no organisations). Once chosen it shows the name with a Change button. The index is pinned to the page's release.
import { useEffect, useId, useMemo, useState } from "react";
import { EXPORT } from "@/lib/copy";
import { loadSearchIndex, type SearchIndex } from "@/lib/data/fetch";
import { seat } from "@/lib/format";
import "@/styles/export.css";

export type PickedMember = { id: string; name: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MemberPicker({ value, onChange }: { value: PickedMember | null; onChange: (m: PickedMember | null) => void }) {
  const uid = useId();
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    loadSearchIndex().then(setIndex, () => setIndex(null));
  }, []);

  const options = useMemo(() => {
    const t = fold(q.trim());
    if (!t || !index) return [];
    return index.members.filter((m) => fold(m.name).includes(t)).slice(0, 8);
  }, [q, index]);

  if (value) {
    return (
      <p>
        <strong>{EXPORT.memberLabel}:</strong> {value.name}{" "}
        <button type="button" className="btn btn--small" onClick={() => onChange(null)}>
          Change
        </button>
      </p>
    );
  }
  return (
    <div className="export__field">
      <label htmlFor={`${uid}-q`}>{EXPORT.memberLabel}</label>
      <input id={`${uid}-q`} type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" aria-controls={`${uid}-list`} />
      <ul id={`${uid}-list`} className="export__options" aria-label="Matching members">
        {options.map((m) => (
          <li key={m.id}>
            <button type="button" className="btn btn--small" onClick={() => { onChange({ id: m.id, name: m.name }); setQ(""); }}>
              {m.name} · {m.party} · {seat(m, false)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
