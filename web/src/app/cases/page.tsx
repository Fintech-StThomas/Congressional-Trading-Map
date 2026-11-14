// /cases: every Case (a member and an organisation tied by several kinds of filed record in the same
// years), ranked as cases.json orders them. Server-rendered from cases.json.
import type { Metadata } from "next";
import Link from "next/link";
import { CASE_NOT_SHOWN, caseHoldingWords, caseRuleText, noCasesText } from "@/lib/copy";
import { getCases, getMemberIndex, getMeta, getOrgIndex } from "@/lib/data/server";
import { caseMinTypes } from "@/lib/data/meta";
import { TYPE_LABEL } from "@/lib/domain/edges";
import { money, seat, yearRange } from "@/lib/format";
import { boardHref, memberHref, orgHref } from "@/lib/urls";
import { Print, PartyTag } from "@/components/shared/Print";

export const metadata: Metadata = {
  title: "Open cases",
  description: "Members of Congress and organisations tied by two or more kinds of filed record in the same years, ranked.",
};

export default function CasesPage() {
  const cases = getCases();
  const members = getMemberIndex();
  const orgs = getOrgIndex();
  const minTypes = caseMinTypes(getMeta());
  return (
    <div className="page page--narrow">
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
        <ol className="cases">
          {cases.map((c, i) => {
            const m = members.get(c.member);
            const o = orgs.get(c.org);
            return (
              <li key={c.id} className="caserow">
                <span className="caserow__rank mono">{i + 1}</span>
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
      )}
    </div>
  );
}
