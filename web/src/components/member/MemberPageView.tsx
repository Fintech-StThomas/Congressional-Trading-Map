// The member page ("case file") for one data reader: header and counts, cases, ties with evidence, the ledger of
// further ties, activity by year, holdings, trades, and the print-only case file. Shared by the latest route
// (app/m/[id], with its live twin) and the release permalink (app/r/[release]/m/[id]), which adds a banner.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IS_SAMPLE, metaBuilt, orgNodesOf, type Data } from "@/lib/data/server";
import { decodeLedger, decodeTradeFile, ledgerTotals } from "@/lib/data/decode";
import { countByBasis, countWire } from "@/lib/domain/datebasis";
import { sortEdges, TYPE_LABEL } from "@/lib/domain/edges";
import { count, date, money, PARTY_NAMES, plural, seat, served, stateName, yearRange } from "@/lib/format";
import { boardHref, changesHref, embedHelpHref, memberFeedHref, memberHref, recordsHref, releaseRecordsHref } from "@/lib/urls";
import { toBoardMember, type NameBook } from "@/lib/domain/names";
import { caseMinTypes, metaSources, sourceNames } from "@/lib/data/meta";
import { CASE_NOT_SHOWN, COMPARE, CORRECTIONS, caseRuleText, RELEASE, SITE, TIMING } from "@/lib/copy";
import type { Edge, OrgSummary } from "@/lib/types";
import { Print, PartyTag } from "@/components/shared/Print";
import { TieSection } from "@/components/member/TieSection";
import { TradesTable } from "@/components/member/TradesTable";
import { LedgerTable } from "@/components/member/LedgerTable";
import { Timeline } from "@/components/member/Timeline";
import { PrintButton } from "@/components/member/PrintButton";
import { CaseFile, caseNumber } from "@/components/member/CaseFile";
import { pickAgainst, pickBoard } from "@/lib/domain/pick";
import { ownTradeCount } from "@/lib/domain/assume";
import "@/styles/casefile.css";
import "@/styles/positions.css";
import { PositionsPanel } from "@/components/member/PositionsPanel";
import { HoldingsSection } from "@/components/member/HoldingsSection";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { CorrectionLink, CorrectionProvider } from "@/components/shared/CorrectionLink";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { ReleaseBanner } from "@/components/shared/ReleaseBanner";
import { AssumeCase, AssumeCount, AssumptionProvider, PageAssumptionBar } from "@/components/shared/Assume";
import { CiteEnvProvider } from "@/components/shared/CiteEnv";
import { CoverageNote } from "@/components/shared/CoverageNote";
import { MemberCite, MemberCitePrint, type MemberCiteProps } from "@/components/member/MemberCite";
import { MemberSave } from "@/components/saved/Savers";
import { coverageFacts, coverageMeta, tradeValueStats } from "@/lib/domain/coverage";
import "@/styles/cite.css";
import { ConnectLink } from "@/components/connect/ConnectLink";
import { ViewSwitch } from "@/components/shared/ViewSwitch";
import { ViewBar, ViewPrintLine } from "@/components/shared/ViewBar";
import { ViewLink } from "@/components/shared/ViewLink";

/** Page metadata for a member; a permalink is not indexed and names the latest page as canonical. */
export async function memberMetadata(data: Data, id: string, pinned: boolean): Promise<Metadata> {
  const m = (await data.getMemberIndex()).get(id);
  if (!m) return {};
  return {
    title: `${m.name}: case file`,
    description: `${m.name}, ${seat(m)}. Ties to organisations and members from filed records: ${plural(m.counts.trades, "trade")}, ${plural(m.counts.orgs, "organisation")}, ${plural(m.counts.cases, "case")}.`,
    ...(pinned ? { robots: { index: false }, alternates: { canonical: memberHref(id) } } : {}),
  };
}

const EDGE_CAP = 80;

/** `pinned`: render as the permalink of `data.release` (banner, noindex-style provenance) rather than as the latest page. */
export async function MemberPageView({ data, id, pinned }: { data: Data; id: string; pinned: boolean }) {
  const file = await data.getMemberFile(id);
  if (!file) notFound();
  const m = file.member;
  const [meta, orgIndex, memberIndex, tradeFile, holdings] = await Promise.all([
    data.getMeta(), data.getOrgIndex(), data.getMemberIndex(), (file.trade_summary?.count ?? 0) > 0 ? data.getTradeFile(file.member.id) : null, data.getHoldings(file.member.id),
  ]);
  const sources = sourceNames(meta);
  const minTypes = caseMinTypes(meta);

  // Names for every node the page can show, slimmed to what the tables print.
  const book: NameBook = { members: {}, orgs: {} };
  const fileOrgs = orgNodesOf(file, orgIndex);
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
  const initialTrades = nTrades ? decodeTradeFile(tradeFile, 60) : [];
  // Trades per year under each date basis, from the trade rows themselves (never mixed; undated counted apart).
  const none = countByBasis([], "event");
  const tradeCounts = countWire(tradeFile) ?? { event: none, public: none };
  const moneyByYear: Record<number, number> = {};
  for (const e of file.edges) if (e.family === "money") for (const b of e.by_year) moneyByYear[b.y] = (moneyByYear[b.y] ?? 0) + b.n;

  const orgName = (oid: string) => orgIndex.get(oid)?.name ?? oid;
  const built = metaBuilt(meta);
  const current = m.committees.filter((c) => c.current);
  const past = m.committees.filter((c) => !c.current);
  const lateCount = ts?.late ?? 0;
  const owners = ts?.by_owner ?? {};
  const ownTrades = ownTradeCount(owners);

  // Only what the assumption switches need: traded strings and case orgs.
  const tradedEdges = file.edges.filter((e) => e.type === "traded").map((e) => ({ id: e.id, type: e.type, from: e.from, to: e.to }));
  const caseOrgs = file.cases.map((c) => c.org);

  const caseNo = caseNumber(m.id, built);
  const nameOf = (x: string) => memberIndex.get(x)?.name ?? file.nodes?.[x]?.name ?? ledgerNames[x] ?? orgIndex.get(x)?.name ?? x;

  const release = pinned ? data.release : null;
  // Coverage limits that apply to this member, shown beside the measures they qualify and recorded in citations.
  const facts = coverageFacts({
    member: m, coverage: file.coverage, tradeSummary: ts, edges: file.edges, ledgerTotals: file.ledger_totals,
    holdings, meta: coverageMeta(meta), tradeValues: tradeValueStats(tradeFile),
  });
  const cite: MemberCiteProps = {
    member: { id: m.id, name: m.name }, hasTrades: nTrades > 0, limitations: facts.map((f) => f.text),
    counts: { trades: m.counts.trades, organisations: m.counts.orgs, members: m.counts.members, cases: m.counts.cases },
    dates: { first: ts?.first ?? null, last: ts?.last ?? null },
  };
  // The release comes from the server for latest pages too: a latest page rendered from release R can name R's permalink.
  const citeSources = metaSources(meta).map((s) => ({
    id: s.id, name: typeof s.name === "string" ? s.name : s.id, url: typeof s.url === "string" ? s.url : null,
    revision: s.revision ? String(s.revision) : null, retrieved: s.retrieved ? String(s.retrieved) : null,
  }));
  const recordsLink = release ? releaseRecordsHref(release, m.id) : recordsHref(m.id);

  const page = (
    <AssumptionProvider member={m.id} hasTrades={nTrades > 0} edges={tradedEdges} caseOrgs={caseOrgs}>
    <CiteEnvProvider release={data.release} built={built} sources={citeSources}>
    <article className="page dossier" data-testid="member-page">
      <ReleasePin release={data.release} />
      {release && <ReleaseBanner release={release} built={built} latestHref={memberHref(m.id)} />}
      <nav className="crumbs crumbs--page no-print" aria-label="Breadcrumb">
        <Link href="/">United States</Link> <span aria-hidden="true">/</span>{" "}
        {m.current ? <Link href={boardHref({ s: m.state })}>{stateName(m.state)}</Link> : <Link href="/wall?former=1">Former members</Link>}{" "}
        <span aria-hidden="true">/</span> <span aria-current="page">{m.name}</span>
      </nav>
      <ViewSwitch current="case" member={m.id} state={m.current ? m.state : null} release={release} />
      <ViewPrintLine />
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
            {nTrades > 0 && <div><dt>{TIMING.countLabel}</dt><dd className="mono">{count(lateCount)}</dd></div>}
          </dl>
          {nTrades > 0 && (
            <div className="no-print dossier__assume">
              <PageAssumptionBar scope={m.name} />
            </div>
          )}
          <div className="dossier__actions no-print">
            {m.current ? (
              <ViewLink className="btn btn--paper" href={boardHref({ s: m.state, m: m.id })}>Open on the board</ViewLink>
            ) : (
              <ViewLink className="btn btn--paper" href={boardHref({ m: m.id })}>Open on the board</ViewLink>
            )}
            <PrintButton />
            <MemberCite {...cite} />
            <MemberSave member={cite.member} years={served(m.served)} party={m.party} counts={cite.counts} dates={cite.dates} limitations={cite.limitations} />
            <ConnectLink a={m.id} />
            <Link className="btn btn--small" href={memberFeedHref(m.id)} prefetch={false} data-testid="member-feed-link">Subscribe (RSS)</Link>
            <Link className="btn btn--small" href={embedHelpHref()} data-testid="member-embed-link">Embed</Link>
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

      <ViewBar />

      {file.cases.length > 0 && (
        <section className="section" id="cases" aria-labelledby="cases-h">
          <h2 id="cases-h">Cases</h2>
          <p className="section__note">{caseRuleText(minTypes)} A reason to read the filings, not a finding.</p>
          <ol className="dossier__cases">
            {file.cases.map((c) => (
              <AssumeCase key={c.id} org={c.org}>
                <span className="tag">Case</span>
                <span className="dossier__casename">{orgName(c.org)}</span>
                <span className="dossier__casetypes">
                  {c.trades ? plural(c.trades, "trade") : c.types.includes("traded") ? TYPE_LABEL.traded : TYPE_LABEL.owns}
                  {c.money ? ` · ${money(Math.round(c.money))} from its PAC, all years` : ` · ${TYPE_LABEL.pac_money}`}
                </span>
                <span className="mono">{yearRange(c.years)}</span>
                <ViewLink className="no-print" href={boardHref({ s: m.current ? m.state : undefined, m: m.id, focus: c.org })}>On the board</ViewLink>
                <span className="notshown dossier__notshown">{CASE_NOT_SHOWN}</span>
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
        <CoverageNote facts={facts} scopes={["money", "orgs"]} label="Coverage for ties and money" testId="coverage-ties" />
        <ErrorBoundary label="ties table">
          <TieSection
            edges={shown}
            selfId={m.id}
            book={book}
            sources={sources}
            caseEdges={[...caseEdgeIds]}
            total={sorted.length}
            fullUrl={data.fileUrl(`members/${m.id}.json`)}
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
        <Timeline trades={tradeCounts} moneyByYear={moneyByYear} coverage={file.coverage} served={m.served} />
      </section>

      <HoldingsSection h={holdings} facts={facts} memberId={m.id} />
      {holdings && <PositionsPanel memberId={m.id} available={!!holdings.positions_summary} />}

      <section className="section" aria-labelledby="trades-h">
        <h2 id="trades-h">Trades reported by this member&rsquo;s household</h2>
        <p className="section__note">
          {nTrades > 0 && (
            <>
              Of {count(nTrades)} trades, {count(ownTrades)} {ownTrades === 1 ? "is" : "are"} marked as the member&rsquo;s own or jointly owned; the rest belong to a spouse, a dependent child, or an owner the filing does not state.{" "}
            </>
          )}
          Periodic transaction reports as filed. Amounts are the disclosed ranges. {TIMING.tradesNote}
          Missing values say &ldquo;not disclosed&rdquo;; they are never filled in.
        </p>
        <CoverageNote facts={facts} scopes={["trades", "owner", "values"]} label="Coverage for trades" testId="coverage-trades" />
        <ErrorBoundary label="trades table">
          <TradesTable initial={initialTrades} total={nTrades} fullUrl={data.fileUrl(`trades/${m.id}.json`)} />
        </ErrorBoundary>
        {nTrades > initialTrades.length && <p className="print-only">The full list of {count(nTrades)} trades is on the website; this dossier prints the {initialTrades.length} most recent.</p>}
      </section>

      <style>{`@media print { @page { @top-left { content: "${SITE.name} · ${caseNo}"; } } }`}</style>
      <CaseFile file={file} board={pickBoard(m.id, file.edges)} against={pickAgainst(file.edges)} names={nameOf} ledger={ledger} trades={initialTrades} sources={metaSources(meta)} built={built} orgName={orgName} caseMinTypes={minTypes} />
      <MemberCitePrint {...cite} />

      <footer className="provenance">
        <h2>Provenance</h2>
        <p>
          Built {built ? date(built) : "date unknown"} from: {metaSources(meta).map((s) => `${s.name ?? s.id}${s.revision ? ` (revision ${String(s.revision).slice(0, 24)})` : ""}`).join("; ") || "sources listed on /method"}.
          {IS_SAMPLE ? " SAMPLE DATA: every value on this page is invented." : ""}
        </p>
        {release && <p className="mono">{RELEASE.provenance(release)}</p>}
        <p>
          {SITE.disclaimer} Not investment advice. Use is restricted by 5 U.S.C. 13107(c): no commercial use other than by news media, and no use for soliciting money.
        </p>
        <p className="dossier__fullfile">
          <ViewLink href={recordsLink} className="no-print">Open the full file</ViewLink>
          <span className="print-only">The full file (every record, unfiltered): {recordsLink}</span>
          <span className="sub"> · every record held for this member, unfiltered, with CSV downloads</span>
          {data.release && <> <span className="sub no-print">·</span> <Link href={changesHref(m.id)} className="no-print" data-testid="compare-releases-link">{COMPARE.link}</Link></>}
        </p>
        <p className="no-print">
          <CorrectionLink what={`${m.name} (${m.id})`} details={[`Member: ${m.name} (bioguide ${m.id})`]} /> <span className="sub">· {CORRECTIONS.note} Members and their offices can reply the same way.</span>
        </p>
        <p className="mono">
          {SITE.name} · member {m.id}
          {m.fec_ids.length ? ` · FEC ${m.fec_ids.join(", ")}` : ""}
        </p>
      </footer>
    </article>
    </CiteEnvProvider>
    </AssumptionProvider>
  );
  // The layout's correction links name the latest build; on a permalink they name this release's.
  return release ? <CorrectionProvider built={built}>{page}</CorrectionProvider> : page;
}
