"use client";

import "@/app/reach.css";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardHref, dataUrl, getJSON } from "@/lib/client";
import { count, money, seat, stateName } from "@/lib/format";
import { YEAR_MIN } from "@/lib/site";
import { decodeWall, PARTY_FULL, PARTY_ORDER, type Party, type WallRow, shortMoney } from "@/lib/party";
import { Print } from "./Print";

type MeasureKey = "cases" | "trades" | "pac" | "oppose";
const MEASURES: { k: MeasureKey; label: string; fmt: (n: number) => string; long: (n: number) => string }[] = [
  { k: "cases", label: "Cases", fmt: count, long: (n) => `${count(n)} ${n === 1 ? "case" : "cases"}` },
  { k: "trades", label: "Household trades", fmt: count, long: (n) => `${count(n)} household ${n === 1 ? "trade" : "trades"}` },
  { k: "pac", label: "PAC dollars received", fmt: shortMoney, long: (n) => `${money(n)} from PACs` },
  { k: "oppose", label: "Outside spending against", fmt: shortMoney, long: (n) => `${money(n)} in outside spending against` },
];
type SortKey = "seat" | "measure" | "name";
type Chamber = "all" | "sen" | "rep";

function bySeat(a: WallRow, b: WallRow) {
  return a.state.localeCompare(b.state) || (a.district ?? 0) - (b.district ?? 0) || a.last.localeCompare(b.last) || a.id.localeCompare(b.id);
}

function sorter(sort: SortKey, k: MeasureKey) {
  return (a: WallRow, b: WallRow) => {
    if (sort === "measure") return b[k] - a[k] || bySeat(a, b);
    if (sort === "name") return a.last.localeCompare(b.last) || a.name.localeCompare(b.name);
    return (a.chamber === b.chamber ? 0 : a.chamber === "sen" ? -1 : 1) || bySeat(a, b);
  };
}

type Tip = { row: WallRow; x: number; y: number; below: boolean };

/** The wall: every current member as a pinned print in three party sections, with a quiet marker for one measure. */
export function WallView({ current }: { current: WallRow[] }) {
  const [measure, setMeasure] = useState<MeasureKey>("cases");
  const [sort, setSort] = useState<SortKey>("seat");
  const [chamber, setChamber] = useState<Chamber>("all");
  const [state, setState] = useState("");
  const [former, setFormer] = useState(false);
  const [formerRows, setFormerRows] = useState<WallRow[] | null>(null);
  const [formerStatus, setFormerStatus] = useState<"idle" | "loading" | "error">("idle");
  const [tip, setTip] = useState<Tip | null>(null);
  const m = MEASURES.find((x) => x.k === measure)!;

  const loadFormer = useCallback(() => {
    setFormerStatus("loading");
    getJSON<{ cols: string[]; rows: unknown[][] }>(dataUrl("wall.json"))
      .then((raw) => {
        setFormerRows(decodeWall(raw).filter((r) => !r.current));
        setFormerStatus("idle");
      })
      .catch(() => setFormerStatus("error"));
  }, []);

  const states = useMemo(() => [...new Set(current.map((r) => r.state))].sort(), [current]);
  const keep = useCallback((r: WallRow) => (chamber === "all" || r.chamber === chamber) && (!state || r.state === state), [chamber, state]);
  // One scale for the whole wall (current members), so markers compare across sections.
  const max = useMemo(() => Math.max(1, ...current.map((r) => r[measure])), [current, measure]);
  const formerMax = useMemo(() => Math.max(1, ...(formerRows ?? []).map((r) => r[measure])), [formerRows, measure]);

  const show = useCallback((row: WallRow, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 120;
    setTip({ row, x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    window.addEventListener("scroll", off, { passive: true, once: true });
    return () => window.removeEventListener("scroll", off);
  }, [tip]);

  const formerShown = useMemo(() => (formerRows ?? []).filter(keep), [formerRows, keep]);

  return (
    <div className="wall" data-testid="wall" data-measure={measure}>
      <div className="wall__controls" role="group" aria-label="Wall controls">
        <fieldset className="seg-control">
          <legend>Marker</legend>
          {MEASURES.map((x) => (
            <label key={x.k} className={measure === x.k ? "is-on" : undefined}>
              <input type="radio" name="measure" value={x.k} checked={measure === x.k} onChange={() => setMeasure(x.k)} />
              <span>{x.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="wall__filters">
          <label>
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="seat">Senators, then by state</option>
              <option value="measure">By marker, largest first</option>
              <option value="name">By last name</option>
            </select>
          </label>
          <label>
            <span>Chamber</span>
            <select value={chamber} onChange={(e) => setChamber(e.target.value as Chamber)}>
              <option value="all">Both</option>
              <option value="sen">Senate</option>
              <option value="rep">House</option>
            </select>
          </label>
          <label>
            <span>State</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>{stateName(s)}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={former} onChange={(e) => {
                setFormer(e.target.checked);
                if (e.target.checked && !formerRows) loadFormer();
              }} />
            <span>Include former members</span>
          </label>
        </div>
      </div>
      <p className="wall__scale">
        <span className="wall__scalebar" aria-hidden="true" /> Marker length is proportional to {m.label.toLowerCase()}; the longest is {m.fmt(max)}.
      </p>

      <Band rows={current.filter(keep)} measure={measure} max={max} sort={sort} m={m} size="sm" onShow={show} onHide={hide} label="Current members" />

      {former && (
        <section className="wall__former" aria-labelledby="former-h">
          <h2 id="former-h">Former members since {YEAR_MIN}</h2>
          {formerStatus === "error" ? (
            <p className="section__note">Former members failed to load. Untick and tick again to retry.</p>
          ) : !formerRows ? (
            <p className="section__note" aria-busy="true">Loading former members…</p>
          ) : (
            <>
              <p className="section__note">Smaller prints; markers use their own scale, the longest is {m.fmt(formerMax)}.</p>
              <Band rows={formerShown} measure={measure} max={formerMax} sort={sort} m={m} size="xs" onShow={show} onHide={hide} label="Former members" />
            </>
          )}
        </section>
      )}

      {tip && (
        <div className={`wall__tip${tip.below ? " is-below" : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip" id="wall-tip">
          <strong>{tip.row.name}</strong>
          <span>
            <abbr className="party" title={PARTY_FULL[tip.row.party]}>{tip.row.party}</abbr> {seat(tip.row)}
            {tip.row.current ? "" : " · former"}
          </span>
          <span className="mono">{m.long(tip.row[measure])}</span>
        </div>
      )}
    </div>
  );
}

type BandProps = {
  rows: WallRow[]; measure: MeasureKey; max: number; sort: SortKey; m: (typeof MEASURES)[number]; size: "sm" | "xs";
  onShow: (r: WallRow, el: HTMLElement) => void; onHide: () => void; label: string;
};

function Band({ rows, measure, max, sort, m, size, onShow, onHide, label }: BandProps) {
  const order = sorter(sort, measure);
  return (
    <div className={`wall__band wall__band--${size}`} aria-label={label} role="region">
      {PARTY_ORDER.map((p) => {
        const list = rows.filter((r) => r.party === p).sort(order);
        return <Section key={p} p={p} list={list} measure={measure} max={max} sort={sort} m={m} size={size} onShow={onShow} onHide={onHide} />;
      })}
    </div>
  );
}

function summary(list: WallRow[]): string {
  const cases = list.reduce((n, r) => n + r.cases, 0);
  const pac = list.reduce((n, r) => n + r.pac, 0);
  return `${count(list.length)} ${list.length === 1 ? "member" : "members"} · ${count(cases)} ${cases === 1 ? "case" : "cases"} · ${shortMoney(pac)} from PACs since ${YEAR_MIN}`;
}

function Section({ p, list, measure, max, sort, m, size, onShow, onHide }: Omit<BandProps, "rows" | "label"> & { p: Party; list: WallRow[] }) {
  const parts: { key: string; title: string | null; rows: WallRow[] }[] =
    sort === "seat"
      ? [
          { key: "sen", title: "Senate", rows: list.filter((r) => r.chamber === "sen") },
          { key: "rep", title: "House", rows: list.filter((r) => r.chamber === "rep") },
        ].filter((x) => x.rows.length > 0)
      : [{ key: "all", title: null, rows: list }];
  return (
    <section className={`wall__party wall__party--${p}`} style={{ flexGrow: Math.max(list.length, 4) }} aria-labelledby={`wp-${size}-${p}`}>
      <h2 className="wall__head" id={`wp-${size}-${p}`}>
        <span className="wall__letter">{p}</span>
        <span className="wall__pname">{PARTY_FULL[p]}</span>
      </h2>
      <p className="wall__sum mono" data-testid={`wall-sum-${p}`}>{summary(list)}</p>
      {list.length === 0 && <p className="wall__empty">No members match.</p>}
      {parts.map((part) => (
        <div key={part.key} className="wall__group">
          {part.title && <h3 className="wall__sub">{part.title}</h3>}
          <ul className="wall__prints">
            {part.rows.map((r) => (
              <WallPrint key={r.id} r={r} value={r[measure]} max={max} m={m} size={size} onShow={onShow} onHide={onHide} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const WallPrint = memo(function WallPrint({ r, value, max, m, size, onShow, onHide }: {
  r: WallRow; value: number; max: number; m: (typeof MEASURES)[number]; size: "sm" | "xs";
  onShow: (r: WallRow, el: HTMLElement) => void; onHide: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const pct = value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <li>
      <Link
        ref={ref}
        href={boardHref({ s: r.current ? r.state : undefined, m: r.id })}
        className="wall__print"
        prefetch={false}
        aria-label={`${r.name}, ${PARTY_FULL[r.party]}, ${seat(r)}${r.current ? "" : ", former"}: ${m.long(value)}. Open on the board`}
        onMouseEnter={() => ref.current && onShow(r, ref.current)}
        onMouseLeave={onHide}
        onFocus={() => ref.current && onShow(r, ref.current)}
        onBlur={onHide}
      >
        <Print id={r.id} name={r.name} photo={r.photo} size={size} />
        <span className="wall__marker" aria-hidden="true">
          <span style={{ width: `${pct}%` }} data-value={value} />
        </span>
      </Link>
    </li>
  );
});
