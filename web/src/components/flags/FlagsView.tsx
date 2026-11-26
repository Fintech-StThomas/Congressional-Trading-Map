// /flags ("Review flags"): the statement, how to read it, the five rules with their counts (and baseline when published),
// and the table of flagged trades. Everything comes from flags.json through the Data reader; when the file is absent
// (builds before review flags) the page says so and shows no numbers. The table gets compact rows plus name maps,
// so the page ships no more than it lists.
import "@/styles/flags.css";
import Link from "next/link";
import type { Data } from "@/lib/data/server";
import { FLAGS } from "@/lib/copy-flags";
import { baselineText, decodeFlagRows, isRuleId, ruleMask } from "@/lib/domain/flags";
import { count, date } from "@/lib/format";
import { flagMethodHref } from "@/lib/urls";
import type { FlagRule, ReviewFlags } from "@/lib/types";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { FlagsTable, type FlagsTableData } from "./FlagsTable";

function Statement({ text }: { text: string }) {
  return (
    <aside className="fl-statement" aria-labelledby="fl-how-h" data-testid="flags-statement">
      <p className="fl-statement__text">{text}</p>
      <h2 id="fl-how-h">{FLAGS.howTitle}</h2>
      <ul>
        {FLAGS.how.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </aside>
  );
}

function Rule({ r }: { r: FlagRule }) {
  const base = baselineText(r);
  return (
    <div className="fl-rule" id={`rule-${r.id}`} data-testid="flags-rule">
      <dt>
        <span className="flagchip flagchip--lg">{r.label}</span>
      </dt>
      <dd>
        <p>{r.definition}</p>
        {r.counts && <p className="fl-rule__counts mono">{FLAGS.counts(count(r.counts.met), count(r.counts.evaluated), count(r.counts.not_evaluated))}</p>}
        {base && <p className="fl-rule__base" data-testid="flags-baseline">{base}</p>}
        {r.note && <p className="fl-rule__note">{r.note}</p>}
        <p><Link href={flagMethodHref(r.id)}>{FLAGS.methodLink}</Link></p>
      </dd>
    </div>
  );
}

/** Compact rows and name maps for the client table. */
async function tableData(data: Data, f: ReviewFlags): Promise<FlagsTableData> {
  const [members, orgIndex] = await Promise.all([data.getMemberIndex(), data.getOrgIndex()]);
  const rows = decodeFlagRows(f);
  const names: FlagsTableData["members"] = {};
  const orgs: FlagsTableData["orgs"] = {};
  for (const r of rows) {
    if (!names[r.member]) {
      const m = members.get(r.member);
      names[r.member] = m ? `${m.name} (${m.party}-${m.state})` : r.member;
    }
    if (r.org && !orgs[r.org]) orgs[r.org] = orgIndex.get(r.org)?.name ?? r.org;
  }
  return {
    buildDate: f.build_date,
    members: names,
    orgs,
    rows: rows.map((r) => [r.member, r.id, r.date, r.available, r.ticker, r.org, r.action, r.low, r.high, ruleMask(r.rules)]),
    labels: Object.fromEntries(f.rules.filter((r) => isRuleId(r.id)).map((r) => [r.id, r.label])),
  };
}

export async function FlagsView({ data, flags }: { data: Data; flags: ReviewFlags | null }) {
  const head = (
    <>
      <ReleasePin release={data.release} />
      <h1>{FLAGS.title}</h1>
    </>
  );
  if (!flags) {
    return (
      <div className="page page--narrow flags">
        {head}
        <div className="fl-unavailable" role="status" data-testid="flags-unavailable">
          <h2>{FLAGS.unavailableTitle}</h2>
          <p>{FLAGS.unavailableBody}</p>
        </div>
      </div>
    );
  }
  const td = await tableData(data, flags);
  return (
    <div className="page flags">
      {head}
      <Statement text={flags.statement} />
      <section className="fl-sec" aria-labelledby="fl-rules-h">
        <h2 id="fl-rules-h">{FLAGS.rulesTitle}</h2>
        <p className="fl-sub">{FLAGS.rulesNote(flags.method_version)}</p>
        <dl className="fl-rules">
          {flags.rules.map((r) => <Rule key={r.id} r={r} />)}
        </dl>
      </section>
      <section className="fl-sec" aria-labelledby="fl-table-h">
        <h2 id="fl-table-h">{FLAGS.tableTitle}</h2>
        <p className="fl-sub">
          {flags.selection?.rule} {FLAGS.recentTo(date(flags.build_date))}
          {flags.selection?.truncated ? ` ${FLAGS.truncated(count(flags.selection.rows_published))}` : ""}{" "}
          <a href="/feed/flags.xml">{FLAGS.feedLink}</a>
        </p>
        <FlagsTable data={td} />
      </section>
    </div>
  );
}
