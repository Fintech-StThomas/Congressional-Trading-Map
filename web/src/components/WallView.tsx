"use client";

import "@/app/reach.css";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardHref, dataUrl, getJSON } from "@/lib/client";
import { count, money, seat, stateName } from "@/lib/format";
import { YEAR_MIN } from "@/lib/site";
import { decodeWall, PARTY_FULL, PARTY_ORDER, type Party, type WallRow, shortMoney } from "@/lib/party";
import { decodeWallYears, leaving, rowsForYear, yearGap, yearScale, type WallYears, type WallYearsRaw } from "@/lib/wallyears";
import { ChipSelect, Segmented, Switch } from "./controls/ChipSelect";
import { YearControl } from "./controls/YearControl";
import { Print } from "./Print";

type MeasureKey = "cases" | "trades" | "pac" | "oppose";
const MEASURES: { k: MeasureKey; label: string; short: string; fmt: (n: number) => string; long: (n: number) => string }[] = [
  { k: "cases", label: "Cases", short: "Cases", fmt: count, long: (n) => `${count(n)} ${n === 1 ? "case" : "cases"}` },
  { k: "trades", label: "Household trades", short: "Trades", fmt: count, long: (n) => `${count(n)} household ${n === 1 ? "trade" : "trades"}` },
  { k: "pac", label: "PAC dollars received", short: "PAC $", fmt: shortMoney, long: (n) => `${money(Math.max(0, n))} from PACs` },
  { k: "oppose", label: "Outside spending against", short: "Spent against", fmt: shortMoney, long: (n) => `${money(Math.max(0, n))} in outside spending against` },
];
type SortKey = "seat" | "measure" | "name";
type Chamber = "all" | "sen" | "rep";
const SORTS = [
  { value: "seat", label: "Senators, then by state", short: "Seat" },
  { value: "measure", label: "By marker, largest first", short: "Marker" },
  { value: "name", label: "By last name", short: "Name" },
];
const YEAR_MAX = new Date().getFullYear();
const LEAVE_MS = 220;

function bySeat(a: WallRow, b: WallRow) {
  return a.state.localeCompare(b.state) || (a.district ?? 0) - (b.district ?? 0) || a.last.localeCompare(b.last) || a.id.localeCompare(b.id);
}

function sorter(sort: SortKey, k: MeasureKey) {
  return (a: WallRow, b: WallRow) => {
    if (sort === "measure") return b[k] - a[k] || bySeat(a, b);
    if (sort === "name") return a.last.localeCompare(b.last) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    return (a.chamber === b.chamber ? 0 : a.chamber === "sen" ? -1 : 1) || bySeat(a, b);
  };
}

type Tip = { row: WallRow; x: number; y: number; below: boolean };
type Ghost = WallRow & { ghost?: true };

/** URL state: ?y=2008&k=trades&sort=name&ch=sen&st=CA&former=1 (all optional). */
function readQuery() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const y = Number(q.get("y"));
  return {
    year: y >= YEAR_MIN && y <= YEAR_MAX ? y : null,
    measure: (MEASURES.find((m) => m.k === q.get("k"))?.k ?? "cases") as MeasureKey,
    sort: (SORTS.find((s) => s.value === q.get("sort"))?.value ?? "seat") as SortKey,
    chamber: (["sen", "rep"].includes(q.get("ch") ?? "") ? q.get("ch") : "all") as Chamber,
    state: /^[A-Z]{2}$/.test(q.get("st") ?? "") ? q.get("st")! : "",
    former: q.get("former") === "1",
  };
}

/** The wall: members as pinned prints in three party sections, with a quiet marker for one measure, all years or one. */
export function WallView({ current }: { current: WallRow[] }) {
  const [measure, setMeasure] = useState<MeasureKey>("cases");
  const [sort, setSort] = useState<SortKey>("seat");
  const [chamber, setChamber] = useState<Chamber>("all");
  const [state, setState] = useState("");
  const [former, setFormer] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [allRows, setAllRows] = useState<WallRow[] | null>(null);
  const [wy, setWy] = useState<WallYears | null>(null);
  const [status, setStatus] = useState<{ former: "idle" | "loading" | "error"; years: "idle" | "loading" | "error" }>({ former: "idle", years: "idle" });
  const [tip, setTip] = useState<Tip | null>(null);
  const m = MEASURES.find((x) => x.k === measure)!;
  const ready = useRef(false);

  const loadAll = useCallback(() => {
    setStatus((s) => ({ ...s, former: "loading" }));
    return getJSON<{ cols: string[]; rows: unknown[][] }>(dataUrl("wall.json"))
      .then((raw) => {
        setAllRows(decodeWall(raw));
        setStatus((s) => ({ ...s, former: "idle" }));
      })
      .catch(() => setStatus((s) => ({ ...s, former: "error" })));
  }, []);
  const loadYears = useCallback(() => {
    if (!allRows) loadAll();
    setStatus((s) => ({ ...s, years: "loading" }));
    getJSON<WallYearsRaw>(dataUrl("wall-years.json"))
      .then((raw) => {
        setWy(decodeWallYears(raw));
        setStatus((s) => ({ ...s, years: "idle" }));
      })
      .catch(() => setStatus((s) => ({ ...s, years: "error" })));
  }, [allRows, loadAll]);

  // Read the shareable state once, then keep the URL in step (replace, so Back leaves the wall).
  useEffect(() => {
    // Applied after hydration (the static page cannot know the query).
    const apply = (q: ReturnType<typeof readQuery>) => {
      if (!q) return;
      setMeasure(q.measure);
      setSort(q.sort);
      setChamber(q.chamber);
      setState(q.state);
      setFormer(q.former);
      setYear(q.year);
      if (q.former || q.year !== null) loadAll();
      if (q.year !== null) loadYears();
    };
    apply(readQuery());
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const q = new URLSearchParams();
    if (year !== null) q.set("y", String(year));
    if (measure !== "cases") q.set("k", measure);
    if (sort !== "seat") q.set("sort", sort);
    if (chamber !== "all") q.set("ch", chamber);
    if (state) q.set("st", state);
    if (former && year === null) q.set("former", "1");
    const s = q.toString();
    window.history.replaceState(window.history.state, "", s ? `?${s}` : window.location.pathname);
  }, [year, measure, sort, chamber, state, former]);

  const changeYear = useCallback(
    (y: number | null) => {
      if (y !== null && !wy && status.years !== "loading") loadYears();
      setYear(y);
    },
    [wy, status.years, loadYears],
  );

  const yearMode = year !== null && wy !== null && allRows !== null;
  const yearRows = useMemo(() => (yearMode ? rowsForYear(allRows!, wy!, year!) : null), [yearMode, allRows, wy, year]);
  const states = useMemo(() => [...new Set((allRows ?? current).map((r) => r.state))].sort(), [allRows, current]);
  const keep = useCallback((r: WallRow) => (chamber === "all" || r.chamber === chamber) && (!state || r.state === state), [chamber, state]);
  const base = yearRows ?? current;
  const shown = useMemo(() => base.filter(keep), [base, keep]);
  // One scale: current members all-time, or every year for the year view (so markers compare while playing).
  const max = useMemo(() => (yearMode ? yearScale(wy!, measure) : Math.max(1, ...current.map((r) => r[measure]))), [yearMode, wy, current, measure]);
  const formerRows = useMemo(() => (allRows ?? []).filter((r) => !r.current), [allRows]);
  const formerMax = useMemo(() => Math.max(1, ...formerRows.map((r) => r[measure])), [formerRows, measure]);
  const gap = yearMode ? yearGap(measure, year!, chamber, wy!.first) : null;

  // Prints leaving the wall stay for LEAVE_MS, fading, in their last place.
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const prevShown = useRef<WallRow[]>(shown);
  useEffect(() => {
    const prev = prevShown.current;
    prevShown.current = shown;
    if (prev === shown || !yearMode) return;
    const gone = leaving(prev, shown);
    if (!gone.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setGhosts([]);
    setGhosts(gone.map((r) => ({ ...r, ghost: true as const })));
    const t = window.setTimeout(() => setGhosts([]), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [shown, yearMode]);

  const show = useCallback((row: WallRow, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 180;
    setTip({ row, x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    window.addEventListener("scroll", off, { passive: true, once: true });
    return () => window.removeEventListener("scroll", off);
  }, [tip]);

  const formerShown = useMemo(() => formerRows.filter(keep), [formerRows, keep]);
  const period = yearMode ? `in ${year}` : `since ${YEAR_MIN}`;
  const busyYears = year !== null && !yearMode && status.years !== "error";
  const noMarkers = gap?.level === "none";

  return (
    <div className="wall" data-testid="wall" data-measure={measure} data-year={yearMode ? year : "all"}>
      <div className="wallbar" role="group" aria-label="Wall controls">
        <div className="wallbar__group">
          <span className="wallbar__label">Marker</span>
          <Segmented label="Marker" name="measure" value={measure} options={MEASURES.map((x) => ({ value: x.k, label: x.label, short: x.short }))} onChange={setMeasure} />
        </div>
        <div className="wallbar__group">
          <span className="wallbar__label">Year</span>
          <YearControl year={year} min={YEAR_MIN} max={YEAR_MAX} onChange={changeYear} busy={busyYears} />
        </div>
        <div className="wallbar__group">
          <span className="wallbar__label">Show</span>
          <Segmented label="Chamber" name="chamber" value={chamber} options={[{ value: "all", label: "Both" }, { value: "sen", label: "Senate" }, { value: "rep", label: "House" }]} onChange={setChamber} />
          <ChipSelect label="State" value={state} search searchLabel="Find a state" onChange={setState}
            options={[{ value: "", label: "All states", short: "All" }, ...states.map((s) => ({ value: s, label: stateName(s), short: s }))]} />
          <ChipSelect label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS} />
          <Switch label="Former members" on={former && year === null} disabled={year !== null}
            hint={year !== null ? "The year view already shows everyone serving that year" : undefined}
            onChange={(v) => {
              setFormer(v);
              if (v && !allRows) loadAll();
            }} />
        </div>
      </div>

      {status.years === "error" && year !== null && (
        <p className="wall__gap" role="status">The year index failed to load. Choose a year again to retry, or All years.</p>
      )}
      {busyYears && <p className="wall__scale" aria-busy="true">Loading the years…</p>}
      {gap && (
        <p className={`wall__gap wall__gap--${gap.level}`} role="status" data-testid="wall-gap">{gap.text}</p>
      )}
      {!noMarkers && (
        <p className="wall__scale">
          <span className="wall__scalebar" aria-hidden="true" /> Marker length is proportional to {m.label.toLowerCase()} {period};
          the longest {yearMode ? "in any year" : ""} is {m.fmt(max)}.
        </p>
      )}

      <Band rows={ghosts.length ? [...shown, ...ghosts.filter(keep)] : shown} measure={measure} max={max} sort={sort} m={m} size="sm"
        onShow={show} onHide={hide} label={yearMode ? `Members serving in ${year}` : "Current members"} period={period} noMarkers={noMarkers} />

      {former && year === null && (
        <section className="wall__former" aria-labelledby="former-h">
          <h2 id="former-h">Former members since {YEAR_MIN}</h2>
          {status.former === "error" ? (
            <p className="section__note">Former members failed to load. Switch off and on again to retry.</p>
          ) : !allRows ? (
            <p className="section__note" aria-busy="true">Loading former members…</p>
          ) : (
            <>
              <p className="section__note">Smaller prints; markers use their own scale, the longest is {m.fmt(formerMax)}.</p>
              <Band rows={formerShown} measure={measure} max={formerMax} sort={sort} m={m} size="xs" onShow={show} onHide={hide} label="Former members" period={period} />
            </>
          )}
        </section>
      )}

      {tip && (
        <div className={`wall__tip${tip.below ? " is-below" : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip" id="wall-tip">
          <strong>{tip.row.name}</strong>
          <span>
            <abbr className="party" title={PARTY_FULL[tip.row.party]}>{tip.row.party}</abbr> {seat(tip.row)}
            {yearMode ? ` · ${year}` : tip.row.current ? "" : " · former"}
          </span>
          {!noMarkers && <span className="mono">{m.long(tip.row[measure])}</span>}
        </div>
      )}
    </div>
  );
}

type BandProps = {
  rows: Ghost[]; measure: MeasureKey; max: number; sort: SortKey; m: (typeof MEASURES)[number]; size: "sm" | "xs";
  onShow: (r: WallRow, el: HTMLElement) => void; onHide: () => void; label: string; period: string; noMarkers?: boolean;
};

function Band({ rows, measure, max, sort, m, size, onShow, onHide, label, period, noMarkers }: BandProps) {
  const order = sorter(sort, measure);
  return (
    <div className={`wall__band wall__band--${size}${noMarkers ? " is-nomarkers" : ""}`} aria-label={label} role="region">
      {PARTY_ORDER.map((p) => {
        const list = rows.filter((r) => r.party === p).sort(order);
        return <Section key={p} p={p} list={list} measure={measure} max={max} sort={sort} m={m} size={size} onShow={onShow} onHide={onHide} period={period} noMarkers={noMarkers} />;
      })}
    </div>
  );
}

function summary(list: WallRow[], period: string): string {
  const cases = list.reduce((n, r) => n + r.cases, 0);
  const pac = list.reduce((n, r) => n + Math.max(0, r.pac), 0);
  return `${count(list.length)} ${list.length === 1 ? "member" : "members"} · ${count(cases)} ${cases === 1 ? "case" : "cases"} · ${shortMoney(pac)} from PACs ${period}`;
}

function Section({ p, list, measure, max, sort, m, size, onShow, onHide, period, noMarkers }: Omit<BandProps, "rows" | "label"> & { p: Party; list: Ghost[] }) {
  const real = list.filter((r) => !r.ghost);
  const parts: { key: string; title: string | null; rows: Ghost[] }[] =
    sort === "seat"
      ? [
          { key: "sen", title: "Senate", rows: list.filter((r) => r.chamber === "sen") },
          { key: "rep", title: "House", rows: list.filter((r) => r.chamber === "rep") },
        ].filter((x) => x.rows.length > 0)
      : [{ key: "all", title: null, rows: list }];
  return (
    <section className={`wall__party wall__party--${p}`} style={{ flexGrow: Math.max(real.length, 4) }} aria-labelledby={`wp-${size}-${p}`}>
      <h2 className="wall__head" id={`wp-${size}-${p}`}>
        <span className="wall__letter">{p}</span>
        <span className="wall__pname">{PARTY_FULL[p]}</span>
      </h2>
      <p className="wall__sum mono" data-testid={`wall-sum-${p}`}>{summary(real, period)}</p>
      {real.length === 0 && <p className="wall__empty">No members match.</p>}
      {parts.map((part) => (
        <div key={part.key} className="wall__group">
          {part.title && <h3 className="wall__sub">{part.title}</h3>}
          <ul className="wall__prints">
            {part.rows.map((r) => (
              <WallPrint key={r.id} r={r} value={r[measure]} max={max} m={m} size={size} onShow={onShow} onHide={onHide} ghost={Boolean(r.ghost)} noMarkers={noMarkers} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const WallPrint = memo(function WallPrint({ r, value, max, m, size, onShow, onHide, ghost, noMarkers }: {
  r: WallRow; value: number; max: number; m: (typeof MEASURES)[number]; size: "sm" | "xs";
  onShow: (r: WallRow, el: HTMLElement) => void; onHide: () => void; ghost: boolean; noMarkers?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const pct = value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <li className={ghost ? "is-leaving" : undefined} aria-hidden={ghost || undefined}>
      <Link
        ref={ref}
        href={boardHref({ s: r.current ? r.state : undefined, m: r.id })}
        className="wall__print"
        prefetch={false}
        tabIndex={ghost ? -1 : undefined}
        aria-label={`${r.name}, ${PARTY_FULL[r.party]}, ${seat(r)}${r.current ? "" : ", former"}${noMarkers ? "" : `: ${m.long(value)}`}. Open on the board`}
        onMouseEnter={() => ref.current && onShow(r, ref.current)}
        onMouseLeave={onHide}
        onFocus={() => ref.current && onShow(r, ref.current)}
        onBlur={onHide}
      >
        <Print id={r.id} name={r.name} photo={r.photo} size={size} />
        {!noMarkers && (
          <span className="wall__marker" aria-hidden="true">
            <span style={{ width: `${pct}%` }} data-value={value} />
          </span>
        )}
      </Link>
    </li>
  );
});
