"use client";

import "@/app/reach.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrgFileWire } from "@/lib/types";
import type { TieEdge } from "@/lib/decode";
import type { BoardMember } from "@/lib/client";
import { count, seat } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/edges";
import { PARTY_FULL, PARTY_ORDER, partsOf, splitSentence, total, type Measure, type Party, shortMoney } from "@/lib/party";
import { SplitBar } from "./SplitBar";
import { Print } from "./Print";

const REACH_TOP = 30;
const STRINGS_ALWAYS = 3;

type Row = { key: string; title: string; measure: Measure; i: 0 | 1 };
const BARS: Row[] = [
  { key: "given-n", title: "Members funded", measure: "given", i: 0 },
  { key: "given-d", title: "Dollars given", measure: "given", i: 1 },
  { key: "support-d", title: "Outside spending supporting", measure: "support", i: 1 },
  { key: "oppose-d", title: "Outside spending opposing", measure: "oppose", i: 1 },
  { key: "traded-n", title: "Members whose households traded its stock", measure: "traded", i: 0 },
];

/** Party split bars for one organisation, with the literal sentence for each measure. */
export function OrgSplit({ file }: { file: OrgFileWire }) {
  const split = file.org.split;
  const since = file.years?.[0] ?? null;
  const rows = BARS.filter((b) => {
    const p = partsOf(split, b.measure, b.i);
    return p && total(p) > 0;
  });
  if (!split || rows.length === 0) return null;
  const sentences = (["given", "support", "oppose", "traded"] as Measure[])
    .map((m) => {
      const n = partsOf(split, m, 0);
      if (!n || total(n) === 0) return null;
      return splitSentence(m, n, m === "traded" ? null : partsOf(split, m, 1), m === "traded" ? null : since);
    })
    .filter(Boolean) as string[];
  return (
    <section className="section splitsec" aria-labelledby="split-h" data-testid="org-split">
      <h2 id="split-h">Across the aisle</h2>
      <p className="section__note">
        Every tie in the records, current and former members, counted under each member&rsquo;s most recent party.
        D, I and R are told apart by letter and pattern: solid, dotted, hatched.
      </p>
      <div className="splitsec__said">
        {sentences.map((s) => (
          <p key={s}>{s}</p>
        ))}
      </div>
      <dl className="splitsec__bars">
        {rows.map((b) => {
          const v = partsOf(split, b.measure, b.i)!;
          const n = partsOf(split, b.measure, 0)!;
          const d = b.measure === "traded" ? null : partsOf(split, b.measure, 1);
          const labels = Object.fromEntries(
            PARTY_ORDER.map((p) => [p, b.i === 1 ? `${shortMoney(v[p])} · ${count(n[p])}` : d ? `${count(v[p])} · ${shortMoney(d[p])}` : count(v[p])]),
          );
          const aria = `${b.title}: ${PARTY_ORDER.map((p) => `${PARTY_FULL[p]} ${b.i === 1 ? shortMoney(v[p]) : count(v[p])}`).join(", ")}`;
          return (
            <div key={b.key} className="splitsec__row">
              <dt>{b.title}</dt>
              <dd>
                <SplitBar values={v} labels={labels} label={aria} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

type Reached = { id: string; m: BoardMember | undefined; tie: TieEdge; money: number; trades: number };

function memberOf(e: TieEdge): string {
  return e.from.kind === "member" ? e.from.id : e.to.id;
}

function caption(r: Reached): string {
  if (r.money > 0) return shortMoney(r.money);
  if (r.trades > 0) return `${count(r.trades)} ${r.trades === 1 ? "trade" : "trades"}`;
  return TYPE_LABEL[r.tie.type];
}

/**
 * The organisation pinned at the top and its largest tied members as prints in
 * three party sections beneath. A string is drawn only for the top few and for
 * the print under the pointer or keyboard focus.
 */
export function OrgReach({
  file, ties, members, record, onOpen,
}: {
  file: OrgFileWire;
  ties: TieEdge[];
  members: Record<string, BoardMember>;
  record: string | null;
  onOpen: (e: TieEdge, el: HTMLElement) => void;
}) {
  // Spending against members (or of a side this file does not record) is never drawn as a string.
  const apart = useMemo(() => {
    const by = new Map<string, Reached>();
    for (const e of ties) {
      if (e.type !== "outside_spending" || e.note === "support") continue;
      const id = memberOf(e);
      const size = e.amount.exact ?? e.amount.high ?? e.amount.low ?? 0;
      const cur = by.get(id) ?? { id, m: members[id], tie: e, money: 0, trades: 0 };
      cur.money += size;
      by.set(id, cur);
    }
    return [...by.values()].sort((a, b) => b.money - a.money || a.id.localeCompare(b.id)).slice(0, 24);
  }, [ties, members]);
  const reached = useMemo(() => {
    const by = new Map<string, Reached>();
    for (const e of ties) {
      if (e.type === "outside_spending" && e.note !== "support") continue;
      const id = memberOf(e);
      const size = e.amount.exact ?? e.amount.high ?? e.amount.low ?? 0;
      const cur = by.get(id) ?? { id, m: members[id], tie: e, money: 0, trades: 0 };
      if (e.family === "money") cur.money += size;
      if (e.type === "traded") cur.trades += e.count;
      const curSize = cur.tie.amount.exact ?? cur.tie.amount.high ?? cur.tie.amount.low ?? 0;
      if (size > curSize || (size === curSize && e._tie?.edge && !cur.tie._tie?.edge)) cur.tie = e;
      by.set(id, cur);
    }
    return [...by.values()]
      .filter((r) => r.money > 0 || r.trades > 0)
      .sort((a, b) => b.money - a.money || b.trades - a.trades || a.id.localeCompare(b.id));
  }, [ties, members]);
  const top = reached.slice(0, REACH_TOP);
  const groups = PARTY_ORDER.map((p) => ({ p, list: top.filter((r) => (r.m?.party ?? "I") === p) }));

  const wrap = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [lines, setLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number; hot: boolean }[]>([]);

  const alwaysKey = top.slice(0, STRINGS_ALWAYS).map((r) => r.id).join(" ");
  useLayoutEffect(() => {
    const measure = () => {
      const w = wrap.current, a = anchor.current;
      if (!w || !a) return;
      const box = w.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const x1 = ar.left + ar.width / 2 - box.left, y1 = ar.bottom - box.top - 4;
      // Stacked sections on narrow screens: the standing strings would cross other prints, so draw only the active one.
      const ids = new Set(alwaysKey && box.width >= 700 ? alwaysKey.split(" ") : []);
      if (hot) ids.add(hot);
      const out: { id: string; x1: number; y1: number; x2: number; y2: number; hot: boolean }[] = [];
      for (const id of ids) {
        const el = w.querySelector<HTMLElement>(`[data-reach="${CSS.escape(id)}"] .pin`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out.push({ id, x1, y1, x2: r.left + r.width / 2 - box.left, y2: r.top + r.height / 2 - box.top, hot: id === hot });
      }
      setLines(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [hot, alwaysKey]);

  if (top.length === 0) return null;
  const o = file.org;
  const rest = Math.max(0, reached.length - top.length);
  const hotRow = hot ? top.find((r) => r.id === hot) : null;

  return (
    <section className="section reach" aria-labelledby="reach-h" data-testid="org-reach">
      <h2 id="reach-h">Reach</h2>
      <p className="section__note">
        The {count(top.length)} members with the largest ties to it, by party. Open a print for the records behind that tie.
        {rest > 0 ? ` ${count(rest)} more are in the table below.` : ""}
      </p>
      <div className="reach__wall" ref={wrap} onMouseLeave={() => setHot(null)}>
        <svg className="reach__strings" aria-hidden="true">
          {lines.map((l) => (
            <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.hot ? "is-hot" : undefined} />
          ))}
        </svg>
        <p className="reach__readout mono" aria-live="polite">
          {hotRow ? `${hotRow.m?.name ?? hotRow.id} · ${hotRow.m ? seat(hotRow.m, false) : ""} · ${TYPE_LABEL[hotRow.tie.type]} · ${caption(hotRow)}` : "Point at or tab to a print to draw its string."}
        </p>
        <div className="reach__org" ref={anchor}>
          <span className="pin" />
          <span className="reach__orgname">{o.name}</span>
          <span className="reach__orgsub mono">{o.ticker ?? ""}{o.ticker ? " · " : ""}{count(o.degree)} members</span>
        </div>
        <div className="reach__parties">
          {groups.map(({ p, list }) => (
            <section key={p} className={`reach__party reach__party--${p}`} style={{ flexGrow: Math.max(list.length, 2) }} aria-label={`${PARTY_FULL[p]} members`}>
              <h3>
                <span className="reach__letter">{p}</span> {PARTY_FULL[p]}
                <span className="mono"> {count(list.length)}</span>
              </h3>
              {list.length === 0 ? (
                <p className="reach__empty">None among the largest {count(top.length)}.</p>
              ) : (
                <ul>
                  {list.map((r) => (
                    <ReachPrint key={r.id} r={r} p={p} record={record} onOpen={onOpen} onHot={setHot} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
      {apart.length > 0 && (
        <section className="reach__apart" aria-labelledby="reach-apart-h" data-testid="reach-apart">
          <h3 id="reach-apart-h">{apart.some((r) => r.tie.note === "oppose") ? "Members it spent against" : "Members in races where it spent independently"}</h3>
          <p className="section__note">Independent spending{apart.every((r) => r.tie.note === "oppose") ? " opposing these members" : " for or against these members (the side is not recorded in this file; open a print for the record)"}. Not a relationship, so no strings.</p>
          <ul>
            {apart.map((r) => (
              <li key={r.id}>
                <button type="button" className="reach__apartbtn" onClick={(ev) => onOpen(r.tie, ev.currentTarget)}>
                  <span className="reach__apartname">{r.m?.name ?? r.id}</span>
                  <span className="mono">{r.m ? seat(r.m, false) : ""} · {shortMoney(r.money)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function ReachPrint({ r, p, record, onOpen, onHot }: {
  r: Reached; p: Party; record: string | null; onOpen: (e: TieEdge, el: HTMLElement) => void; onHot: (id: string | null) => void;
}) {
  const name = r.m?.name ?? r.id;
  const label = `${name}${r.m ? `, ${seat(r.m, false)}` : ""}, ${PARTY_FULL[p]}: ${TYPE_LABEL[r.tie.type]}, ${caption(r)}`;
  const inner = (
    <>
      <Print id={r.id} name={name} photo={r.m?.photo ?? false} size="sm" className="print--reach" />
      <span className="reach__cap">
        <span className="reach__name">{r.m?.last ?? name}</span>
        <span className="mono">{caption(r)}</span>
      </span>
    </>
  );
  const common = {
    className: "reach__print",
    onMouseEnter: () => onHot(r.id),
    onFocus: () => onHot(r.id),
    onBlur: () => onHot(null),
  };
  const evidence = r.tie._tie?.edge || !r.tie._tie;
  return (
    <li data-reach={r.id}>
      {evidence ? (
        <button type="button" {...common} aria-label={`Evidence: ${label}`} onClick={(ev) => onOpen(r.tie, ev.currentTarget)}>
          {inner}
        </button>
      ) : record ? (
        <a {...common} href={record} target="_blank" rel="noopener noreferrer" aria-label={`Official record: ${label}`}>
          {inner}
        </a>
      ) : (
        <a {...common} href={`/m/${r.id}`} aria-label={label}>
          {inner}
        </a>
      )}
    </li>
  );
}
