"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, OrgFileWire } from "@/lib/types";
import { decodeOrgTies, recordUrlFor, type TieEdge } from "@/lib/decode";
import { FAMILY_LABEL, TYPE_LABEL } from "@/lib/edges";
import { amountText, count, seat, yearSpan } from "@/lib/format";
import { boardHref, dataUrl, getJSON, IS_SAMPLE_CLIENT, loadSearchIndex, memberHref, ORG_KIND_LABEL, resolveTie, type BoardMember, type NameBook } from "@/lib/client";
import { orgShard } from "@/lib/hash";
import { EvidenceDrawer, ExternalIcon } from "./EvidenceDrawer";
import { PartyTag } from "./Print";
import { LineSample } from "./LineSample";

type Key = "member" | "type" | "amount" | "count" | "last";

/** The organisation page, rendered in the browser from the org shard. */
export function OrgView({ sources }: { sources: Record<string, string> }) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [file, setFile] = useState<OrgFileWire | null>(null);
  const [members, setMembers] = useState<Record<string, BoardMember>>({});
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "amount", dir: -1 });
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<Edge | null>(null);
  const [resolving, setResolving] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const raw = window.location.pathname.replace(/^\/o\//, "").replace(/\/$/, "");
    const id = decodeURIComponent(raw);
    setOrgId(id);
    let live = true;
    (async () => {
      try {
        const shard = await orgShard(id);
        const [body, idx] = await Promise.all([getJSON<Record<string, OrgFileWire>>(dataUrl(`orgs/${shard}.json`)), loadSearchIndex().catch(() => null)]);
        if (!live) return;
        const f = body[id];
        if (!f) return setStatus("missing");
        setFile(f);
        if (idx) setMembers(Object.fromEntries(idx.members.map((m) => [m.id, m])));
        setStatus("ok");
        document.title = `${f.org.name} · ties`;
      } catch {
        if (live) setStatus("error");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const ties = useMemo(() => (file ? decodeOrgTies(file) : []), [file]);
  const totalTies = useMemo(() => {
    const t = file?.ledger_totals ? Object.values(file.ledger_totals).reduce((n, x) => n + (x?.edges ?? 0), 0) : 0;
    return Math.max(t, ties.length);
  }, [file, ties.length]);
  const book: NameBook = useMemo(() => ({ members, orgs: file ? { [file.org.id]: file.org } : {} }), [members, file]);

  const memberOf = (e: TieEdge) => (e.from.kind === "member" ? e.from.id : e.to.id);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = ties.filter((e) => {
      if (!t) return true;
      const m = members[memberOf(e)];
      return (m?.name ?? memberOf(e)).toLowerCase().includes(t) || TYPE_LABEL[e.type].toLowerCase().includes(t) || (m?.state.toLowerCase() === t);
    });
    const val = (e: TieEdge): number | string => {
      switch (sort.k) {
        case "member": return members[memberOf(e)]?.last ?? memberOf(e);
        case "type": return TYPE_LABEL[e.type];
        case "amount": return e.amount.exact ?? e.amount.high ?? e.amount.low ?? -1;
        case "count": return e.count;
        case "last": return e.last ?? "";
      }
    };
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [ties, q, sort, members]);

  const openTie = useCallback((e: TieEdge, el: HTMLElement) => {
    trigger.current = el;
    setOpen(e);
    if (e._tie?.edge) {
      setResolving(true);
      resolveTie(e)
        .then((full) => setOpen((cur) => (cur?.id === e.id ? full : cur)))
        .catch(() => undefined)
        .finally(() => setResolving(false));
    }
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    trigger.current?.focus();
  }, []);

  if (status === "loading") {
    return (
      <div className="page page--narrow" aria-busy="true">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--table" />
      </div>
    );
  }
  if (status !== "ok" || !file) {
    return (
      <div className="page page--narrow">
        <h1>Organisation not found</h1>
        <p className="lede">
          {status === "error" ? "The records failed to load. Check your connection and reload." : `No organisation with the id “${orgId}” is tied to a member in this build.`}
        </p>
        <p className="lede"><Link href="/">Back to the board</Link></p>
      </div>
    );
  }
  const o = file.org;
  const record = IS_SAMPLE_CLIENT ? null : recordUrlFor(o.id);
  const th = (k: Key, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortbtn" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "member" || k === "type" ? 1 : -1 }))}>
        {label}
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className={sort.k === k ? `sorticon is-${sort.dir === 1 ? "up" : "down"}` : "sorticon"}>
          <path d="M2 4l3-3 3 3M2 6l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </th>
  );

  return (
    <article className="page page--narrow orgpage" data-testid="org-page">
      <header className="orghead">
        <h1>{o.name}</h1>
        <p className="dossier__seat">
          {ORG_KIND_LABEL[o.kind]}
          {o.ticker ? ` · ${o.ticker}` : ""}
          {o.sector ? ` · ${o.sector}` : ""}
          {o.cik ? ` · CIK ${o.cik}` : ""} · tied to {count(o.degree)} {o.degree === 1 ? "member" : "members"}
        </p>
        <div className="dossier__actions">
          <Link className="btn btn--paper" href={boardHref({ o: o.id })}>Open on the board</Link>
          {record && (
            <a className="btn" href={record} target="_blank" rel="noopener noreferrer">
              {record.includes("fec.gov") ? "FEC committee page" : "SEC filings"} <ExternalIcon />
            </a>
          )}
        </div>
      </header>

      {file.ledger_totals && Object.keys(file.ledger_totals).length > 0 && (
        <ul className="ledger__totals ledger__totals--wide">
          {Object.entries(file.ledger_totals).map(([t, v]) => (
            <li key={t}>
              <span>{TYPE_LABEL[t as keyof typeof TYPE_LABEL] ?? t}</span>
              <span className="mono">{count(v.edges)} members · {count(v.records)} records · {amountText(v) ?? "no amount"}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="section" aria-labelledby="ties-h">
        <h2 id="ties-h">Who is tied to it</h2>
        <p className="section__note">
          {totalTies > ties.length ? `Showing the largest ${count(ties.length)} of ${count(totalTies)} ties; the totals above cover all of them. ` : ""}
          Rows marked Evidence open the filed records; the rest link to the official record.
        </p>
        <div className="filters">
          <label className="filters__search">
            <span>Find a member</span>
            <input type="search" value={q} placeholder="Name, state code or kind of tie" onChange={(e) => { setQ(e.target.value); setLimit(100); }} />
          </label>
          <p className="filters__count mono" aria-live="polite">{count(rows.length)} ties</p>
        </div>
        <div className="tablewrap">
          <table className="ties">
            <caption className="visually-hidden">Members tied to {o.name}</caption>
            <thead>
              <tr>
                {th("member", "Member")}
                {th("type", "Tie")}
                {th("amount", "Amount", "num")}
                {th("count", "Records", "num")}
                {th("last", "Years")}
                <th scope="col"><span className="visually-hidden">Records</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((e) => {
                const mid = memberOf(e);
                const m = members[mid];
                return (
                  <tr key={e.id} className={open?.id === e.id ? "is-active" : undefined}>
                    <td data-label="Member">
                      <Link href={memberHref(mid)} className="ties__name">{m?.name ?? mid}</Link>
                      {m && (
                        <span className="ties__sub">
                          <PartyTag party={m.party} /> {seat(m, false)}
                          {m.current ? "" : " · former"}
                        </span>
                      )}
                    </td>
                    <td data-label="Tie">
                      <span className="ties__type">
                        <LineSample style={e.family === "context" ? "context" : "filed"} />
                        <span>{TYPE_LABEL[e.type]}</span>
                      </span>
                      <span className="ties__sub">{FAMILY_LABEL[e.family]}</span>
                    </td>
                    <td data-label="Amount" className="num mono">{amountText(e.amount) ?? <span className="nd">not disclosed</span>}</td>
                    <td data-label="Records" className="num mono">{count(e.count)}</td>
                    <td data-label="Years" className="mono">{yearSpan(e.first, e.last)}</td>
                    <td className="ties__act">
                      {e._tie?.edge || !e._tie ? (
                        <button type="button" className="btn btn--small" onClick={(ev) => openTie(e, ev.currentTarget)} aria-label={`Evidence: ${TYPE_LABEL[e.type]}, ${m?.name ?? mid}`}>
                          Evidence
                        </button>
                      ) : record ? (
                        <a href={record} target="_blank" rel="noopener noreferrer" className="ties__rec">
                          Official record <ExternalIcon />
                        </a>
                      ) : (
                        <span className="nd">summary only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <p className="more">
            <button type="button" className="btn btn--small" onClick={() => setLimit((l) => l + 200)}>Show more</button>
          </p>
        )}
      </section>
      <EvidenceDrawer edge={open} book={book} sources={sources} onClose={close} loading={resolving} />
    </article>
  );
}
