// The member page's identity block: portrait, name, seat, header counts, the assumptions chip, the actions and the
// committees. Actions: one primary button (Open on the board), three per-item controls (Cite this, Save, Follow) and a
// "More" menu holding the rest (print, connections, RSS, embed, compare releases). Server component; the controls
// inside are client components. Wording: lib/copy.ts, lib/copy-ui.ts, lib/copy-discovery.ts.
import Link from "next/link";
import type { Committee, MemberSummary } from "@/lib/types";
import { COMPARE } from "@/lib/copy";
import { ACTIONS_UI } from "@/lib/copy-ui";
import { count, PARTY_NAMES, seat, served } from "@/lib/format";
import { TIMING } from "@/lib/copy";
import { boardHref, changesHref, embedHelpHref, memberFeedHref } from "@/lib/urls";
import { PartyTag, Print } from "@/components/shared/Print";
import { Explain } from "@/components/shared/Explain";
import { ActionMenu } from "@/components/shared/ActionMenu";
import { AssumeCount, PageAssumptionBar } from "@/components/shared/Assume";
import { FollowButton } from "@/components/shared/FollowButton";
import { ViewLink } from "@/components/shared/ViewLink";
import { ConnectLink } from "@/components/connect/ConnectLink";
import { MemberSave } from "@/components/saved/Savers";
import { MemberCite, type MemberCiteProps } from "@/components/member/MemberCite";
import { PrintButton } from "@/components/member/PrintButton";
import { SnapshotCount } from "@/components/member/SnapshotNote";

type Props = {
  m: MemberSummary & { committees: Committee[] };
  /** The permalink's release id, or null on the latest page (the header counts then carry snapshot notes). */
  release: string | null;
  /** The page is rendered from an archived release (pinned mode): "Compare data releases" applies. */
  hasReleases: boolean;
  nTrades: number;
  lateCount: number;
  cite: MemberCiteProps;
};

export function MemberHeader({ m, release, hasReleases, nTrades, lateCount, cite }: Props) {
  const current = m.committees.filter((c) => c.current);
  const past = m.committees.filter((c) => !c.current);
  const menu = "menu__item";
  return (
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
          <div><dt><Explain term="household">Household trades reported</Explain></dt><dd className="mono"><AssumeCount kind="trades" total={m.counts.trades} />{release && <SnapshotCount kind="trades" />}</dd></div>
          <div><dt>Organisations tied</dt><dd className="mono">{count(m.counts.orgs)}{release && <SnapshotCount kind="orgs" />}</dd></div>
          <div><dt>Members tied</dt><dd className="mono">{count(m.counts.members)}{release && <SnapshotCount kind="members" />}</dd></div>
          <div><dt>Cases</dt><dd className="mono"><AssumeCount kind="cases" total={m.counts.cases} /></dd></div>
          {nTrades > 0 && <div><dt>{TIMING.countLabel}</dt><dd className="mono">{count(lateCount)}</dd></div>}
        </dl>
        {nTrades > 0 && (
          <div className="no-print dossier__assume">
            <PageAssumptionBar scope={m.name} />
          </div>
        )}
        <div className="dossier__actions no-print">
          <ViewLink className="btn btn--paper" href={boardHref(m.current ? { s: m.state, m: m.id } : { m: m.id })}>Open on the board</ViewLink>
          <MemberCite {...cite} />
          <MemberSave member={cite.member} years={served(m.served)} party={m.party} counts={cite.counts} dates={cite.dates} limitations={cite.limitations} />
          <FollowButton kind="member" id={m.id} name={m.name} />
          <ActionMenu
            className="dossier__more"
            label={ACTIONS_UI.more}
            ariaLabel={ACTIONS_UI.moreAria(m.name)}
            testId="member-more"
            items={[
              <PrintButton key="print" className={menu} />,
              <ConnectLink key="connect" a={m.id} className={menu} />,
              <Link key="rss" className={menu} href={memberFeedHref(m.id)} prefetch={false} data-testid="member-feed-link">Subscribe (RSS)</Link>,
              <Link key="embed" className={menu} href={embedHelpHref()} data-testid="member-embed-link">Embed</Link>,
              ...(hasReleases ? [<Link key="compare" className={menu} href={changesHref(m.id)} data-testid="compare-releases-link">{COMPARE.link}</Link>] : []),
            ]}
          />
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
  );
}
