import type { Metadata } from "next";
import { IS_SAMPLE, getMeta, metaBuilt } from "@/lib/data";
import { metaSources } from "@/lib/meta";
import { FAMILY_LABEL, TYPE_LABEL, TYPE_RULE } from "@/lib/edges";
import { count, date } from "@/lib/format";
import { SITE } from "@/lib/site";
import type { EdgeType } from "@/lib/types";
import { LineSample } from "@/components/LineSample";

export const metadata: Metadata = {
  title: "Method and sources",
  description: "Where every string comes from: sources, revisions, row counts, unmatched records, the rule for each kind of tie, and the limits.",
};

const TYPES_BY_FAMILY: [keyof typeof FAMILY_LABEL, EdgeType[]][] = [
  ["holding", ["traded", "owns", "position", "traded_together"]],
  ["money", ["pac_money", "employee_money", "lobbyist_money", "outside_spending", "paid_travel", "funds", "fundraises_with", "shared_donors"]],
  ["people", ["revolving_door", "oversees", "shared_staff"]],
  ["context", ["sits_with", "legislates_with"]],
];

function label(k: string) {
  return k.replace(/_/g, " ").replace(/\.jsonl/g, "").replace(/^./, (c) => c.toUpperCase());
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function FlatCounts({ obj }: { obj: Record<string, unknown> }) {
  const rows: [string, number][] = [];
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (isNum(v)) rows.push([prefix + label(k), v]);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Record<string, unknown>, `${prefix}${label(k)}: `);
    }
  };
  walk(obj, "");
  if (!rows.length) return <p className="nd">None reported</p>;
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="mono">{count(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function MethodPage() {
  const meta = getMeta();
  const built = metaBuilt(meta);
  const sources = metaSources(meta);
  const exclusions = meta.exclusions;
  const coverage = (meta as Record<string, unknown>).coverage_notes ?? meta.coverage;
  const notes: string[] = Array.isArray(coverage) ? coverage.filter((x): x is string => typeof x === "string") : [];

  return (
    <div className="page page--read method">
      <h1>Method and sources</h1>
      <p className="lede">
        {SITE.name} draws a string between a member of Congress and an organisation or another member only when a filed public record names both, or when a published
        statistical rule is met. Every string carries the records behind it. {SITE.disclaimer}
      </p>
      <p className="method__built">
        This build: <span className="mono">{built ? `${date(built)} (${built})` : "build time not recorded"}</span>
        {IS_SAMPLE && <strong> · sample data: every value is invented</strong>}
      </p>

      <section className="section" aria-labelledby="src-h">
        <h2 id="src-h">Sources</h2>
        {sources.length === 0 ? (
          <p className="nd">meta.json lists no sources.</p>
        ) : (
          <ul className="sources">
            {sources.map((s) => {
              const files = Array.isArray(s.files) ? (s.files as { rows?: number }[]) : null;
              const rows = isNum(s.rows) ? s.rows : files ? files.reduce((n, f) => n + (isNum(f.rows) ? f.rows : 0), 0) : null;
              const licence = (s.licence ?? s.license) as string | undefined;
              return (
                <li key={s.id}>
                  <h3>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name ?? s.id}</a> : s.name ?? s.id}</h3>
                  <dl className="kv kv--inline">
                    <div><dt>Source id</dt><dd className="mono">{s.id}</dd></div>
                    {s.revision && <div><dt>Revision</dt><dd className="mono">{String(s.revision)}</dd></div>}
                    {s.retrieved && <div><dt>Retrieved</dt><dd className="mono">{String(s.retrieved)}</dd></div>}
                    {files && <div><dt>Files</dt><dd className="mono">{count(files.length)}</dd></div>}
                    {rows != null && rows > 0 && <div><dt>Rows read</dt><dd className="mono">{count(rows)}</dd></div>}
                    {isNum(s.unmatched) && <div><dt>Unmatched</dt><dd className="mono">{count(s.unmatched)}</dd></div>}
                  </dl>
                  {licence && <p className="sources__licence">{licence}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="counts-h">
        <h2 id="counts-h">What was built</h2>
        {meta.counts ? <FlatCounts obj={meta.counts as Record<string, unknown>} /> : <p className="nd">No counts recorded.</p>}
        <h3 className="method__h3">Unmatched records</h3>
        <p className="section__note">Matching is exact on a normalised name plus a hand-reviewed override list. Similar names are never matched automatically; what does not match stays its own node and is counted here.</p>
        {meta.unmatched ? <FlatCounts obj={meta.unmatched as Record<string, unknown>} /> : <p className="nd">None reported.</p>}
        <h3 className="method__h3">Excluded records</h3>
        {Array.isArray(exclusions) ? (
          <dl className="kv">
            {(exclusions as { reason?: string; count?: number }[]).map((x, i) => (
              <div key={i}><dt>{x.reason}</dt><dd className="mono">{count(x.count ?? 0)}</dd></div>
            ))}
          </dl>
        ) : exclusions && typeof exclusions === "object" ? (
          <dl className="kv">
            {Object.entries(exclusions as Record<string, { reason?: string; rows?: number }>).map(([k, v]) => (
              <div key={k}><dt>{v?.reason ?? label(k)}</dt><dd className="mono">{count(v?.rows ?? 0)}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="nd">None reported.</p>
        )}
      </section>

      <section className="section" aria-labelledby="rules-h">
        <h2 id="rules-h">The rule for each string</h2>
        <p className="section__note">A string is drawn solid when a filed record names both ends. Dashed strings are derived or thin; grey strings are context.</p>
        {TYPES_BY_FAMILY.map(([fam, types]) => (
          <div key={fam} className="rules">
            <h3 className="method__h3">{FAMILY_LABEL[fam]}</h3>
            <dl>
              {types.map((t) => (
                <div key={t}>
                  <dt>
                    <LineSample style={fam === "context" ? "context" : t === "shared_donors" || t === "traded_together" ? "derived" : "filed"} /> {TYPE_LABEL[t]}
                  </dt>
                  <dd>{meta.rules?.[t] ?? TYPE_RULE[t]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <h3 className="method__h3">Derived strings</h3>
        <p>
          A derived string (shared donors, trading the same securities at the same time) is drawn only when the count clears a published threshold over a baseline of what chance
          would produce. Each one shows the observed count, the expected count, the ratio and the method in its evidence drawer. A derived string is a pattern in the data, never a record of contact.
        </p>
        <h3 className="method__h3">Thin evidence</h3>
        <p>A string is marked thin (short dashes) when its records are incomplete: a missing date, an amount not disclosed, or a single record.</p>
        <h3 className="method__h3">Cases</h3>
        <p>
          A case is a member and an organisation with at least three distinct kinds of filed tie whose dates overlap. Context ties (same committee, co-sponsored bills) never count. Cases are ranked by the
          number of kinds, then by money, as a reading aid.
        </p>
        <h3 className="method__h3">Amounts</h3>
        <p>
          Trades are disclosed as ranges and shown as ranges: <span className="mono">$15,001–$50,000</span>. Sums add the low ends and the high ends separately; no midpoint is ever stored or shown.
          Missing values are shown as &ldquo;not disclosed&rdquo;, never as zero. An unlabelled owner is shown as unspecified, never assumed to be the member.
        </p>
      </section>

      <section className="section" aria-labelledby="limits-h">
        <h2 id="limits-h">Known limits</h2>
        <ul className="limits">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Periodic transaction reports exist only from July 2012, when the STOCK Act created them. Earlier years show &ldquo;no reports existed&rdquo;.</li>
          <li>Disclosures can be filed late, amended or filed on paper; the site shows the current version of each trade and marks amendments.</li>
          <li>Names are matched exactly. A company that files under several names may appear as more than one organisation.</li>
          <li>A tie shows that a record exists. It does not show intent, influence, a conflict of interest or any wrongdoing.</li>
        </ul>
      </section>

      <section className="section" aria-labelledby="use-h">
        <h2 id="use-h">Use of this data</h2>
        <p>
          Financial disclosure reports are made public under the Ethics in Government Act. Under <strong>5 U.S.C. 13107(c)</strong>, it is unlawful to obtain or use a report for any
          unlawful purpose, for any commercial purpose other than by news and communications media for dissemination to the general public, for determining or establishing the
          credit rating of any individual, or for use, directly or indirectly, in the solicitation of money for any political, charitable or other purpose.
        </p>
        <p>FEC data may not be used to solicit contributions or for commercial purposes (52 U.S.C. 30111(a)(4)).</p>
        <p><strong>Not investment advice.</strong> Nothing on this site is a recommendation to buy or sell any security.</p>
        <p>
          <strong>Corrections.</strong> If a record is wrong or mismatched, write to <a href={`mailto:${SITE.correctionsEmail}`}>{SITE.correctionsEmail}</a> with the page address and the record id.
          Corrections are made in the source data and noted in the next build.
        </p>
      </section>
    </div>
  );
}
