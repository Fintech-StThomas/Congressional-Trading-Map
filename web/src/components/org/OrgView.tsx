"use client";
// The organisation page (/o/<id>, one static shell): loads the org's shard in the browser and shows its party split,
// reach, ledger totals and every listed tie, with evidence loaded from member files on demand.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, OrgFileWire } from "@/lib/types";
import { decodeOrgTies, orgTieTotal, type TieEdge } from "@/lib/data/decode";
import { recordUrlFor, boardHref, dataUrl, memberHref, orgFeedHref } from "@/lib/urls";
import { ORG_FEED } from "@/lib/copy-discovery";
import { FollowButton } from "@/components/shared/FollowButton";
import { FAMILY_LABEL, TYPE_LABEL } from "@/lib/domain/edges";
import { PRECISE } from "@/lib/copy-precision";
import { amountText, count, seat, yearSpan } from "@/lib/format";
import { getJSON, IS_SAMPLE_CLIENT, loadSearchIndex, resolveTie } from "@/lib/data/fetch";
import { ORG_KIND_LABEL, type BoardMember, type NameBook } from "@/lib/domain/names";
import { orgShard } from "@/lib/hash";
import { EvidenceDrawer } from "@/components/shared/EvidenceDrawer";
import { ExternalIcon } from "@/components/shared/ExternalIcon";
import { PartyTag } from "@/components/shared/Print";
import { LineSample } from "@/components/shared/LineSample";
import { OrgReach, OrgSplit } from "./OrgReach";
import { ConnectLink } from "@/components/connect/ConnectLink";

/** Feed discovery for readers: <link rel="alternate"> to this organisation's feed (the page is one static shell, so it is added once the id is known). */
function addFeedAlternate(id: string, name: string) {
  document.head.querySelectorAll("link[data-org-feed]").forEach((n) => n.remove());
  const l = document.createElement("link");
  l.rel = "alternate";
  l.type = "application/rss+xml";
  l.title = ORG_FEED.alternateTitle(name);
  l.href = orgFeedHref(id);
  l.setAttribute("data-org-feed", "1");
  document.head.appendChild(l);
}

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
        addFeedAlternate(f.org.id, f.org.name);
      } catch {
        if (live) setStatus("error");
      }
    })();
    return () => {
      live = false;
      document.head.querySelectorAll("link[data-org-feed]").forEach((n) => n.remove());
    };
  }, []);

  const ties = useMemo(() => (file ? decodeOrgTies(file) : []), [file]);
  // Listed ties plus the money ties only ledger_totals counts (disjoint by contract).
  const totalTies = useMemo(() => (file ? orgTieTotal(file) : 0), [file]);
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
  const close = useCallback((restoreFocus = true) => {
    setOpen(null);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
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
          {file.chambers ? ` (${count(file.chambers.rep)} House, ${count(file.chambers.sen)} Senate)` : ""}
          {file.years ? ` · ${file.years[0] === file.years[1] ? file.years[0] : `${file.years[0]}–${file.years[1]}`}` : ""}
        </p>
        <div className="dossier__actions">
          <Link className="btn btn--paper" href={boardHref({ o: o.id })}>Open on the board</Link>
          <ConnectLink a={o.id} />
          <FollowButton kind="org" id={o.id} name={o.name} />
          <Link className="btn btn--small" href={orgFeedHref(o.id)} prefetch={false} title={ORG_FEED.subscribeTitle} data-testid="org-feed-link">{ORG_FEED.subscribe}</Link>
          {record && (
            <a className="btn" href={record} target="_blank" rel="noopener noreferrer">
              {record.includes("fec.gov") ? "FEC committee page" : "SEC filings"} <ExternalIcon />
            </a>
          )}
        </div>
      </header>

      <OrgSplit file={file} />
      <OrgReach file={file} ties={ties} members={members} record={record} onOpen={openTie} />

      {file.ledger_totals && Object.keys(file.ledger_totals).length > 0 && (
        <ul className="ledger__totals ledger__totals--wide">
          {Object.entries(file.ledger_totals).map(([t, v]) => (
            <li key={t}>
              <span>{TYPE_LABEL[t as keyof typeof TYPE_LABEL] ?? t}{t === "traded" ? ` (${PRECISE.household}, ${PRECISE.combined})` : ""}</span>
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
                        <LineSample style={e.family === "context" ? "context" : e.type === "outside_spending" && e.note !== "support" ? "against" : "filed"} />
                        <span>{TYPE_LABEL[e.type]}</span>
                      </span>
                      <span className="ties__sub">{FAMILY_LABEL[e.family]}{e.type === "traded" ? ` · ${PRECISE.household}, ${PRECISE.combined}` : ""}</span>
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
