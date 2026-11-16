// /cases and /cases/…/page/<n>: one page of 50 Cases from the ranking in cases.json, with filters by
// tie combination, chamber and party. Every filter and page is its own static path (lib/domain/casepages.ts),
// so each page carries only its 50 rows.
import Link from "next/link";
import { CASE_NOT_SHOWN, CASES_COPY, caseHoldingWords, caseRuleText, noCasesText } from "@/lib/copy";
import { latestData } from "@/lib/data/server";
import { caseMinTypes } from "@/lib/data/meta";
import { TYPE_LABEL } from "@/lib/domain/edges";
import { CHAMBERS, COMBOS, PARTIES, caseMatches, casesHref, pageOf, pageWindow, type CaseFilter, type CasesQuery } from "@/lib/domain/casepages";
import { count, money, seat, yearRange } from "@/lib/format";
import { boardHref, memberHref, orgHref } from "@/lib/urls";
import { Print, PartyTag } from "@/components/shared/Print";
import { PageJump } from "./PageJump";
import { ReleasePin } from "@/components/shared/ReleasePin";

export async function CasesView({ q }: { q: CasesQuery }) {
  const data = await latestData();
  const [cases, members, orgs, meta] = await Promise.all([data.getCases(), data.getMemberIndex(), data.getOrgIndex(), data.getMeta()]);
  const minTypes = caseMinTypes(meta);
  const pg = pageOf(cases, members, q);
  const filtered = Boolean(q.ties || q.chamber || q.party);

  // One row of options per filter; each count is for that option with the other filters kept.
  const option = (f: CaseFilter, label: string, on: boolean) => {
    const n = cases.reduce((k, c) => k + (caseMatches(c, members.get(c.member), f) ? 1 : 0), 0);
    return (
      <li key={label}>
        {n === 0 && !on ? (
          <span className="casefilter__opt is-empty">{label} <span className="casefilter__n mono">0</span></span>
        ) : (
          <Link className="casefilter__opt" href={casesHref({ ...f, page: 1 })} aria-current={on ? "true" : undefined}>
            {label} <span className="casefilter__n mono">{count(n)}</span>
          </Link>
        )}
      </li>
    );
  };
  const base: CaseFilter = { ties: q.ties, chamber: q.chamber, party: q.party };

  return (
    <div className="page page--narrow">
      <ReleasePin release={data.release} />
      <h1>Open cases</h1>
      <p className="lede">
        {caseRuleText(minTypes)} Each fact comes from a filed record; together they are a reason to read the filings. They are not a finding, and they say nothing about why.
        Ranked by the number of kinds of tie, then money, then trades.
      </p>
      {cases.length === 0 ? (
        <div className="emptycase">
          <p>
            <strong>No cases in this build.</strong> {noCasesText(minTypes)} As more sources are added (lobbying, travel), pairs that meet the rule will appear here.
          </p>
          <p>
            Meanwhile, the <Link href="/">board</Link> shows every member&rsquo;s strongest ties.
          </p>
        </div>
      ) : (
        <>
          <nav className="casefilter" aria-label={CASES_COPY.filterLabel} data-testid="case-filters">
            <div className="casefilter__row">
              <span className="casefilter__k">{CASES_COPY.ties}</span>
              <ul>
                {option({ ...base, ties: undefined }, CASES_COPY.any, !q.ties)}
                {(Object.keys(COMBOS) as (keyof typeof COMBOS)[]).map((k) => option({ ...base, ties: k }, COMBOS[k].label, q.ties === k))}
              </ul>
            </div>
            <div className="casefilter__row">
              <span className="casefilter__k">{CASES_COPY.chamber}</span>
              <ul>
                {option({ ...base, chamber: undefined }, CASES_COPY.both, !q.chamber)}
                {(Object.keys(CHAMBERS) as (keyof typeof CHAMBERS)[]).map((k) => option({ ...base, chamber: k }, CHAMBERS[k].label, q.chamber === k))}
              </ul>
            </div>
            <div className="casefilter__row">
              <span className="casefilter__k">{CASES_COPY.party}</span>
              <ul>
                {option({ ...base, party: undefined }, CASES_COPY.any, !q.party)}
                {(Object.keys(PARTIES) as (keyof typeof PARTIES)[]).map((k) => option({ ...base, party: k }, PARTIES[k].label, q.party === k))}
              </ul>
            </div>
            {filtered && (
              <p className="casefilter__reset">
                <Link href="/cases">{CASES_COPY.clear}</Link>
              </p>
            )}
          </nav>

          <p className="casecount" role="status" data-testid="case-count">
            {pg.total === 0 ? CASES_COPY.none : CASES_COPY.range(pg.first, pg.last, pg.total)}
            {filtered ? ` ${CASES_COPY.rankNote}` : ""}
          </p>

          <ol className="cases">
            {pg.rows.map(({ c, rank }) => {
              const m = members.get(c.member);
              const o = orgs.get(c.org);
              return (
                <li key={c.id} className="caserow">
                  <span className="caserow__rank mono">{rank}</span>
                  {m && <Print id={m.id} name={m.name} photo={m.photo} size="sm" />}
                  <div className="caserow__who">
                    <p className="caserow__pair">
                      <Link href={memberHref(c.member)}>{m?.name ?? c.member}</Link>
                      {m && <PartyTag party={m.party} />}
                      <span className="caserow__and">and</span>
                      <Link href={orgHref(c.org)}>{o?.name ?? c.org}</Link>
                    </p>
                    <p className="caserow__sub">
                      {m ? seat(m) : ""} · <span className="mono">{yearRange(c.years)}</span>
                    </p>
                    <p className="caserow__what">
                      Household {caseHoldingWords(c)}
                      {c.types.includes("pac_money") ? ` · received ${c.money ? money(Math.round(c.money)) : "money"} from its PAC (all years)` : ""}
                      {c.types.filter((t) => t !== "traded" && t !== "owns" && t !== "pac_money").map((t) => ` · ${TYPE_LABEL[t].toLowerCase()}`).join("")}
                    </p>
                    <p className="notshown">{CASE_NOT_SHOWN}</p>
                  </div>
                  <Link className="btn btn--small" href={boardHref({ s: m?.current ? m.state : undefined, m: c.member, focus: c.org })}>
                    Open on the board
                  </Link>
                </li>
              );
            })}
          </ol>

          {pg.pages > 1 && (
            <nav className="pager" aria-label={CASES_COPY.pagerLabel} data-testid="case-pager">
              {pg.page > 1 ? (
                <Link className="pager__step" rel="prev" href={casesHref({ ...base, page: pg.page - 1 })}>{CASES_COPY.prev}</Link>
              ) : (
                <span className="pager__step is-off" aria-hidden="true">{CASES_COPY.prev}</span>
              )}
              <ol className="pager__pages">
                {pageWindow(pg.page, pg.pages).map((p, i) =>
                  p === null ? (
                    <li key={`gap${i}`} className="pager__gap" aria-hidden="true">…</li>
                  ) : (
                    <li key={p}>
                      <Link className="pager__n mono" href={casesHref({ ...base, page: p })} aria-current={p === pg.page ? "page" : undefined} aria-label={CASES_COPY.pageLabel(p)}>
                        {p}
                      </Link>
                    </li>
                  ),
                )}
              </ol>
              {pg.page < pg.pages ? (
                <Link className="pager__step" rel="next" href={casesHref({ ...base, page: pg.page + 1 })}>{CASES_COPY.next}</Link>
              ) : (
                <span className="pager__step is-off" aria-hidden="true">{CASES_COPY.next}</span>
              )}
              <PageJump page={pg.page} pages={pg.pages} hrefs={Array.from({ length: pg.pages }, (_, i) => casesHref({ ...base, page: i + 1 }))} />
            </nav>
          )}
        </>
      )}
    </div>
  );
}
