// "Excluded records" on /method: rows left out of the data, and (apart) rows that are kept and counted, so a count of
// kept rows is never read as a count of exclusions. Wording in lib/copy-amend.ts; the rows come from meta.json.
import { METHOD_AMEND } from "@/lib/copy-amend";
import { splitExclusions, type ExclusionRow } from "@/lib/domain/method-build";
import { count } from "@/lib/format";

function Rows({ rows }: { rows: ExclusionRow[] }) {
  return (
    <dl className="kv">
      {rows.map((r) => (
        <div key={r.key}><dt>{r.reason}</dt><dd className="mono">{count(r.rows)}</dd></div>
      ))}
    </dl>
  );
}

export function Exclusions({ exclusions }: { exclusions: unknown }) {
  const { excluded, kept } = splitExclusions(exclusions);
  if (!excluded.length && !kept.length) return <p className="nd">None reported.</p>;
  return (
    <>
      {excluded.length > 0 && <Rows rows={excluded} />}
      {kept.length > 0 && (
        <div data-testid="method-kept">
          <h4 className="method__h3">{METHOD_AMEND.keptHeading}</h4>
          <p className="section__note">{METHOD_AMEND.keptNote}</p>
          <Rows rows={kept} />
        </div>
      )}
    </>
  );
}
