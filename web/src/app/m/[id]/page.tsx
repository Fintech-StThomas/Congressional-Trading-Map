import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IS_SAMPLE, getMemberFile, getMemberIndex, getMembers, getMeta, getOrgIndex, getTradeFile, metaBuilt, orgNodesOf } from "@/lib/data";
import { decodeLedger, decodeTradeFile, ledgerTotals } from "@/lib/decode";
import { sortEdges, TYPE_LABEL } from "@/lib/edges";
import { count, date, PARTY_NAMES, plural, seat, served } from "@/lib/format";
import { boardHref, dataUrl, toBoardMember, type NameBook } from "@/lib/client";
import { metaSources, sourceNames } from "@/lib/meta";
import { SITE } from "@/lib/site";
import type { Edge, OrgSummary } from "@/lib/types";
import { Print, PartyTag } from "@/components/Print";
import { TieSection } from "@/components/TieSection";
import { TradesTable } from "@/components/TradesTable";
import { LedgerTable } from "@/components/LedgerTable";
import { Timeline } from "@/components/Timeline";
import { PrintButton } from "@/components/PrintButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AssumeCase, AssumeCount, AssumptionProvider, PageAssumptionBar } from "@/components/assume/Assume";

export const dynamicParams = false;

export function generateStaticParams() {
  return getMembers().map((m) => ({ id: m.id }));
}

export async function generateMetadata({ params }: PageProps<"/m/[id]">): Promise<Metadata> {
  const { id } = await params;
  const m = getMemberIndex().get(id);
  if (!m) return {};
  return {
    title: `${m.name}: case file`,
    description: `${m.name}, ${seat(m)}. Ties to organisations and members from filed records: ${plural(m.counts.trades, "trade")}, ${plural(m.counts.orgs, "organisation")}, ${plural(m.counts.cases, "case")}.`,
  };
}

const EDGE_CAP = 80;

export default async function MemberPage({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  const file = getMemberFile(id);
  if (!file) notFound();
  const m = file.member;
  const meta = getMeta();
  const orgIndex = getOrgIndex();
  const memberIndex = getMemberIndex();
  const sources = sourceNames(meta);

  // Names for every node the page can show, slimmed to what the tables print.
  const book: NameBook = { members: {}, orgs: {} };
  const fileOrgs = orgNodesOf(file);
  const slimOrg = (id: string): OrgSummary | null => {
    if (fileOrgs[id]) return fileOrgs[id];
    const o = orgIndex.get(id);
    return o ? { id, name: o.name, kind: o.kind, ticker: o.ticker, cik: null, sector: null, degree: o.degree } : null;
  };
  const addNode = (kind: "member" | "org", nid: string) => {
    if (kind === "member") {
      const x = memberIndex.get(nid);
      if (x && !book.members[nid]) book.members[nid] = toBoardMember(x);
    } else if (!book.orgs[nid]) {
      const o = slimOrg(nid);
      if (o) book.orgs[nid] = o;
    }
  };
  addNode("member", id);
  for (const e of file.edges) for (const n of [e.from, e.to]) addNode(n.kind, n.id);

  const caseEdgeIds = new Set(file.cases.flatMap((c) => c.edges));
  const sorted = sortEdges(file.edges);
  const shown: Edge[] = sorted.length > EDGE_CAP ? [...sorted.filter((e) => caseEdgeIds.has(e.id)), ...sorted.filter((e) => !caseEdgeIds.has(e.id)).slice(0, EDGE_CAP)] : sorted;

  const ledger = decodeLedger(file);
  const ledgerNames: Record<string, string> = {};
  for (const r of ledger) {
    const nm = r.otherKind === "member" ? memberIndex.get(r.other)?.name : file.nodes?.[r.other]?.name ?? orgIndex.get(r.other)?.name;
    if (nm) ledgerNames[r.other] = nm;
    if (r.via) {
      const vid = r.via.id.replace(/:(support|oppose)$/, "");
      const vn = file.nodes?.[vid]?.name ?? orgIndex.get(vid)?.name;
      if (vn) ledgerNames[r.via.id] = vn;
    }
  }
  const totals = ledgerTotals(file);
  const ledgerTotalRows = Object.values(totals).reduce((n, t) => n + (t?.edges ?? 0), 0);
  const ledgerPartial = ledgerTotalRows > ledger.length;

  const ts = file.trade_summary;
  const nTrades = ts?.count ?? 0;
  const initialTrades = nTrades ? decodeTradeFile(getTradeFile(m.id), 60) : [];
  const tradeByYear: Record<number, number> = {};
  for (const [y, n] of Object.entries(ts?.by_year ?? {})) if (/^\d{4}$/.test(y)) tradeByYear[Number(y)] = n;
  const moneyByYear: Record<number, number> = {};
  for (const e of file.edges) if (e.family === "money") for (const b of e.by_year) moneyByYear[b.y] = (moneyByYear[b.y] ?? 0) + b.n;

  const orgName = (oid: string) => orgIndex.get(oid)?.name ?? oid;
  const built = metaBuilt(meta);
  const current = m.committees.filter((c) => c.current);
  const past = m.committees.filter((c) => !c.current);
  const lateCount = ts?.late ?? 0;
  const owners = ts?.by_owner ?? {};
  const ownTrades = owners.self ?? 0;

  // Only what the assumption switches need: traded strings and case orgs.
  const tradedEdges = file.edges.filter((e) => e.type === "traded").map((e) => ({ id: e.id, type: e.type, from: e.from, to: e.to }));
  const caseOrgs = file.cases.map((c) => c.org);

  return (
    <AssumptionProvider member={m.id} hasTrades={nTrades > 0} edges={tradedEdges} caseOrgs={caseOrgs}>
    <article className="page dossier" data-testid="member-page">
      <header className="dossier__head">
        <Print id={m.id} name={m.name} photo={m.photo} size="xl" />
        <div className="dossier__id">
          <h1>
            {m.name} <PartyTag party={m.party} />
          </h1>
          <p className="dossier__seat">
            {seat(m)} · {PARTY_NAMES[m.party]} · {m.current ? "Serving" : "Former member"}, {served(m.served)}
          </p>
          <dl className="dossier__counts">
            <div><dt>Household trades reported</dt><dd className="mono"><AssumeCount kind="trades" total={m.counts.trades} /></dd></div>
            <div><dt>Organisations tied</dt><dd className="mono">{count(m.counts.orgs)}</dd></div>
            <div><dt>Members tied</dt><dd className="mono">{count(m.counts.members)}</dd></div>
            <div><dt>Cases</dt><dd className="mono"><AssumeCount kind="cases" total={m.counts.cases} /></dd></div>
            {nTrades > 0 && <div><dt>Disclosed late</dt><dd className="mono">{count(lateCount)}</dd></div>}
          </dl>
          {nTrades > 0 && (
            <div className="no-print dossier__assume">
              <PageAssumptionBar scope={m.name} />
            </div>
          )}
          <div className="dossier__actions no-print">
            {m.current ? (
              <Link className="btn btn--paper" href={boardHref({ s: m.state, m: m.id })}>Open on the board</Link>
            ) : (
              <Link className="btn btn--paper" href={boardHref({ m: m.id })}>Open on the board</Link>
            )}
            <PrintButton />
          </div>
        </div>
        <section className="dossier__cmte" aria-labelledby="cmte-h">
          <h2 id="cmte-h">Committees</h2>
          {current.length === 0 && past.length === 0 ? (
            <p className="nd">None on file</p>
          ) : (
            <ul>
              {current.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.role && <span className="sub"> · {c.role}</span>}
                </li>
              ))}
              {past.map((c) => (
                <li key={c.id} className="is-past">
                  {c.name} <span className="sub">· past</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </header>

      {file.cases.length > 0 && (
        <section className="section" id="cases" aria-labelledby="cases-h">
          <h2 id="cases-h">Cases</h2>
          <p className="section__note">Companies whose stock this member&rsquo;s household traded while the member received money from the company&rsquo;s PAC, in the same years. A reason to read the filings, not a finding.</p>
          <ol className="dossier__cases">
            {file.cases.map((c) => (
              <AssumeCase key={c.id} org={c.org}>
                <span className="tag">Case</span>
                <span className="dossier__casename">{orgName(c.org)}</span>
                <span className="dossier__casetypes">
                  {c.trades ? `${count(c.trades)} ${c.trades === 1 ? "trade" : "trades"}` : TYPE_LABEL.traded}
                  {c.money ? ` · $${count(Math.round(c.money))} from its PAC, all years` : ` · ${TYPE_LABEL.pac_money}`}
                </span>
                <span className="mono">{c.years[0] === c.years[1] ? c.years[0] : `${c.years[0]}–${c.years[1]}`}</span>
                <Link className="no-print" href={boardHref({ s: m.current ? m.state : undefined, m: m.id, focus: c.org })}>On the board</Link>
              </AssumeCase>
            ))}
          </ol>
        </section>
      )}

      <section className="section" aria-labelledby="ties-h">
        <h2 id="ties-h">Ties</h2>
        <p className="section__note">
          Every tie with its records attached, grouped by kind. Open a row to read the filings.
          {sorted.length > shown.length ? ` The ${shown.length} largest of ${sorted.length} are listed first.` : ""}
        </p>
        <ErrorBoundary label="ties table">
          <TieSection
            edges={shown}
            selfId={m.id}
            book={book}
            sources={sources}
            caseEdges={[...caseEdgeIds]}
            total={sorted.length}
            fullUrl={dataUrl(`members/${m.id}.json`)}
          />
        </ErrorBoundary>
      </section>

      {(ledger.length > 0 || ledgerTotalRows > 0) && (
        <section className="section" aria-labelledby="ledger-h">
          <h2 id="ledger-h">Further ties</h2>
          <p className="section__note">
            Smaller money ties and shared committee seats, summarised from the same filings without individual records attached. Each row links to the committee&rsquo;s filings where an official page exists.
            {ledgerPartial ? ` This list holds the ${count(ledger.length)} largest of ${count(ledgerTotalRows)}; the totals cover all of them.` : ""}
          </p>
          <ErrorBoundary label="ledger">
            <LedgerTable rows={ledger} names={ledgerNames} totals={totals} />
          </ErrorBoundary>
        </section>
      )}

      <section className="section" aria-labelledby="time-h">
        <h2 id="time-h">Activity by year</h2>
        <p className="section__note">Bars show trades reported and itemised money records per year. Shading shows how complete the underlying data is for that year.</p>
        <Timeline tradeByYear={tradeByYear} moneyByYear={moneyByYear} coverage={file.coverage} served={m.served} />
      </section>

      <section className="section" aria-labelledby="trades-h">
        <h2 id="trades-h">Trades reported by this member&rsquo;s household</h2>
        <p className="section__note">
          {nTrades > 0 && (
            <>
              Of {count(nTrades)} trades, {count(ownTrades)} {ownTrades === 1 ? "is" : "are"} marked as the member&rsquo;s own; the rest belong to a spouse, a dependent child, a joint account, or an owner the filing does not state.{" "}
            </>
          )}
          Periodic transaction reports as filed. Amounts are the disclosed ranges. A report is late when the public could see it more than 45 days after the trade.
          Missing values say &ldquo;not disclosed&rdquo;; they are never filled in.
        </p>
        <ErrorBoundary label="trades table">
          <TradesTable initial={initialTrades} total={nTrades} fullUrl={dataUrl(`trades/${m.id}.json`)} />
        </ErrorBoundary>
        {nTrades > initialTrades.length && <p className="print-only">The full list of {count(nTrades)} trades is on the website; this dossier prints the {initialTrades.length} most recent.</p>}
      </section>

      <footer className="provenance">
        <h2>Provenance</h2>
        <p>
          Built {built ? date(built) : "date unknown"} from: {metaSources(meta).map((s) => `${s.name ?? s.id}${s.revision ? ` (revision ${String(s.revision).slice(0, 24)})` : ""}`).join("; ") || "sources listed on /method"}.
          {IS_SAMPLE ? " SAMPLE DATA: every value on this page is invented." : ""}
        </p>
        <p>
          {SITE.disclaimer} Not investment advice. Use is restricted by 5 U.S.C. 13107(c): no commercial use other than by news media, and no use for soliciting money.
        </p>
        <p className="dossier__fullfile">
          <Link href={`/m/${m.id}/records`} className="no-print">Open the full file</Link>
          <span className="print-only">The full file (every record, unfiltered): /m/{m.id}/records</span>
          <span className="sub"> · every record held for this member, unfiltered, with CSV downloads</span>
        </p>
        <p className="mono">
          {SITE.name} · member {m.id}
          {m.fec_ids.length ? ` · FEC ${m.fec_ids.join(", ")}` : ""}
        </p>
      </footer>
    </article>
    </AssumptionProvider>
  );
}
