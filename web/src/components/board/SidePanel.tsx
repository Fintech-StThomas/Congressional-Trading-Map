"use client";
// The board's side panel: the state list, a state's delegation (senators, then House members),
// an organisation's facts, and the "Open cases" list. Each part gets its data as props from BoardApp.
import Link from "next/link";
import type { OrgSummary } from "@/lib/types";
import { money, plural, seat, stateName, yearRange } from "@/lib/format";
import { orgHref } from "@/lib/urls";
import type { BoardMember, NameBook } from "@/lib/domain/names";
import { CASE_NOT_SHOWN, caseRuleText, noCasesText } from "@/lib/copy";
import { Print, PartyTag } from "@/components/shared/Print";
import type { CaseLite } from "./types";

export function Delegation({ st, members, selected, onPick }: { st: string; members: BoardMember[]; selected: string | null; onPick: (id: string) => void }) {
  const sens = members.filter((m) => m.chamber === "sen");
  const reps = members.filter((m) => m.chamber === "rep");
  return (
    <div className="delegation" data-testid="delegation">
      <h2 className="side__h">
        {stateName(st)} <span className="mono">{members.length}</span>
      </h2>
      {sens.length > 0 && (
        <>
          <h3 className="side__sub">Senate</h3>
          <ul className="senators">
            {sens.map((m) => (
              <li key={m.id}>
                <button type="button" className={`pick pick--sen${selected === m.id ? " is-selected" : ""}`} aria-pressed={selected === m.id} onClick={() => onPick(m.id)} data-member={m.id}>
                  <Print id={m.id} name={m.name} photo={m.photo} size="lg" />
                  <span className="pick__name">{m.name}</span>
                  <span className="pick__meta">
                    <PartyTag party={m.party} /> Senator
                    {m.cases > 0 && <span className="tag tag--inline">{m.cases === 1 ? "Case" : `${m.cases} cases`}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {reps.length > 0 && (
        <>
          <h3 className="side__sub">
            House <span className="mono">{reps.length}</span>
          </h3>
          <ul className="reps">
            {reps.map((m) => (
              <li key={m.id}>
                <button type="button" className={`pick pick--rep${selected === m.id ? " is-selected" : ""}`} aria-pressed={selected === m.id} onClick={() => onPick(m.id)} data-member={m.id}>
                  <Print id={m.id} name={m.name} photo={m.photo} size="sm" />
                  <span className="pick__text">
                    <span className="pick__name">{m.name}</span>
                    <span className="pick__meta">
                      <PartyTag party={m.party} /> {seat(m, false).replace("Rep. · ", "")}
                      {m.cases > 0 && <span className="tag tag--inline">Case</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function StateList({ states, onPick }: { states: Record<string, string[]>; onPick: (s: string) => void }) {
  const list = Object.keys(states).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  return (
    <div>
      <h2 className="side__h">States</h2>
      <p className="side__note">Every state and territory with a current member. The map works the same way.</p>
      <ul className="statelist">
        {list.map((s) => (
          <li key={s}>
            <button type="button" className="statebtn" onClick={() => onPick(s)}>
              <span>{stateName(s)}</span>
              <span className="mono">{states[s].length}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrgSide({ org, total, shown }: { org: OrgSummary; total: number; shown: number }) {
  return (
    <div>
      <h2 className="side__h">{org.name}</h2>
      <dl className="facts facts--side">
        <div>
          <dt>Kind</dt>
          <dd>{org.kind.replace("_", " ")}</dd>
        </div>
        {org.ticker && (
          <div>
            <dt>Ticker</dt>
            <dd className="mono">{org.ticker}</dd>
          </div>
        )}
        {org.sector && (
          <div>
            <dt>Sector</dt>
            <dd>{org.sector}</dd>
          </div>
        )}
        <div>
          <dt>Members tied</dt>
          <dd className="mono">{org.degree}</dd>
        </div>
      </dl>
      <p className="side__note">
        The board shows the {shown} largest of {total} ties. <Link href={orgHref(org.id)}>See every tie</Link>.
      </p>
    </div>
  );
}

export function CaseList({ cases, total, minTypes, book, onOpen }: { cases: CaseLite[]; total: number; minTypes: number; book: NameBook; onOpen: (c: CaseLite) => void }) {
  if (!cases.length) return <p className="side__note">{noCasesText(minTypes)}</p>;
  return (
    <div>
      <h2 className="side__h">Open cases</h2>
      <p className="side__note">
        {caseRuleText(minTypes)} It is a reason to read the filings, not a finding.
      </p>
      <ol className="caselist">
        {cases.map((c) => {
          const m = book.members[c.member];
          return (
            <li key={c.id}>
              <button type="button" className="casebtn" onClick={() => onOpen(c)}>
                <span className="casebtn__who">
                  {m?.name ?? c.member} {m && <PartyTag party={m.party} />}
                </span>
                <span className="casebtn__org">{c.orgName}</span>
                <span className="casebtn__meta mono">
                  {c.trades ? `${plural(c.trades, "trade")} · ` : ""}
                  {c.money ? `${money(Math.round(c.money))} PAC · ` : ""}
                  {yearRange(c.years)}
                </span>
                <span className="casebtn__not">{CASE_NOT_SHOWN}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="side__note">
        <Link href="/cases">All {total} cases, ranked</Link>
      </p>
    </div>
  );
}
