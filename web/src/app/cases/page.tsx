import type { Metadata } from "next";
import Link from "next/link";
import { getCases, getMemberIndex, getOrgIndex } from "@/lib/data";
import { TYPE_LABEL } from "@/lib/edges";
import { seat } from "@/lib/format";
import { boardHref, memberHref, orgHref } from "@/lib/client";
import { Print, PartyTag } from "@/components/Print";

export const metadata: Metadata = {
  title: "Open cases",
  description: "Members of Congress and organisations tied by three or more kinds of filed record at once, ranked.",
};

export default function CasesPage() {
  const cases = getCases();
  const members = getMemberIndex();
  const orgs = getOrgIndex();
  return (
    <div className="page page--narrow">
      <h1>Open cases</h1>
      <p className="lede">
        A case is a member of Congress whose household traded a company&rsquo;s stock and who received money from that company&rsquo;s PAC in the same years. Both facts come from filed
        records; together they are a reason to read the filings. They are not a finding, and they say nothing about why. Ranked by the number of kinds of tie, then money, then trades.
      </p>
      {cases.length === 0 ? (
        <div className="emptycase">
          <p>
            <strong>No cases in this build.</strong> No member and organisation pair yet has three kinds of filed tie that overlap in time. As more sources are added (lobbying,
            annual holdings, travel), pairs that meet the rule will appear here.
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
                    {m ? seat(m) : ""} · <span className="mono">{c.years[0] === c.years[1] ? c.years[0] : `${c.years[0]}–${c.years[1]}`}</span>
                  </p>
                  <p className="caserow__what">
                    Household traded the stock{c.trades ? ` (${c.trades.toLocaleString("en-US")} ${c.trades === 1 ? "trade" : "trades"})` : ""} · received
                    {c.money ? ` $${Math.round(c.money).toLocaleString("en-US")}` : " money"} from its PAC (all years)
                    {c.types.filter((t) => t !== "traded" && t !== "pac_money").map((t) => ` · ${TYPE_LABEL[t].toLowerCase()}`).join("")}
                  </p>
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
