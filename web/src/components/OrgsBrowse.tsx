"use client";

import "@/app/reach.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import { orgHref, ORG_KIND_LABEL } from "@/lib/client";
import { count } from "@/lib/format";
import { PARTY_FULL, PARTY_ORDER, total, type IndexOrg, type OrgIndexData, type Parts, shortMoney } from "@/lib/party";
import { SplitBar } from "./SplitBar";

const STEP = 50;

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function OrgsBrowse({ data }: { data: OrgIndexData }) {
  const [q, setQ] = useState("");
  const t = norm(q);
  const match = (o: IndexOrg) => !t || norm(o.name).includes(t) || (o.ticker ? norm(o.ticker) === t : false);
  return (
    <div className="orgs" data-testid="orgs">
      <div className="filters">
        <label className="filters__search">
          <span>Find an organisation</span>
          <input type="search" value={q} placeholder="Name or ticker" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="orgs__lists">
        <RankList
          id="reach"
          title="Most members reached"
          note="Distinct current members with a PAC contribution or outside spending for or against them."
          list={data.byMembers}
          match={match}
          value={(o) => o.members}
          fmt={count}
          unit="members"
        />
        <RankList
          id="dollars"
          title="Most dollars given"
          note="PAC contributions to current members, all years."
          list={data.byDollars}
          match={match}
          value={(o) => o.dollars}
          fmt={shortMoney}
          unit=""
        />
      </div>
    </div>
  );
}

function RankList({ id, title, note, list, match, value, fmt, unit }: {
  id: string; title: string; note: string; list: IndexOrg[]; match: (o: IndexOrg) => boolean;
  value: (o: IndexOrg) => Parts; fmt: (n: number) => string; unit: string;
}) {
  const [limit, setLimit] = useState(STEP);
  const ranked = useMemo(() => list.map((o, i) => ({ o, rank: i + 1 })), [list]);
  const shown = ranked.filter(({ o }) => match(o));
  return (
    <section className="orgs__list" aria-labelledby={`ol-${id}`} data-testid={`orgs-${id}`}>
      <h2 id={`ol-${id}`}>{title}</h2>
      <p className="section__note">{note}</p>
      <p className="orgs__count mono" aria-live="polite">{shown.length === list.length ? `Top ${count(list.length)}` : `${count(shown.length)} of the top ${count(list.length)}`}</p>
      <ol className="orgs__rows">
        {shown.slice(0, limit).map(({ o, rank }) => {
          const v = value(o);
          return (
            <li key={o.id} className="orgs__row">
              <span className="orgs__rank mono">{rank}</span>
              <span className="orgs__main">
                <Link href={orgHref(o.id)} className="orgs__name">{o.name}</Link>
                <span className="orgs__kind">{ORG_KIND_LABEL[o.kind]}{o.ticker ? ` · ${o.ticker}` : ""}</span>
                <SplitBar inline values={v} label={`${title}, ${o.name}: ${PARTY_ORDER.map((p) => `${PARTY_FULL[p]} ${fmt(v[p])}`).join(", ")}`} />
                <span className="orgs__parts mono">
                  {PARTY_ORDER.map((p) => (
                    <span key={p} className={v[p] ? undefined : "is-zero"}>
                      <span className={`swatch seg--${p}`} aria-hidden="true" />
                      {p} {fmt(v[p])}
                    </span>
                  ))}
                </span>
              </span>
              <span className="orgs__total mono">{fmt(total(v))}{unit ? <small> {unit}</small> : null}</span>
            </li>
          );
        })}
      </ol>
      {shown.length === 0 && <p className="section__note">No organisation in this list matches.</p>}
      {shown.length > limit && (
        <p className="more">
          <button type="button" className="btn btn--small" onClick={() => setLimit((l) => l + 100)}>Show more</button>
        </p>
      )}
    </section>
  );
}
