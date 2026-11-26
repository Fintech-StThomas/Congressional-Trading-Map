// /method, "Review flags" and "SEC 8-K events": each rule's definition, thresholds, counts and baseline (when
// published), with an anchor per rule (#flag-<id>), the method version and the statement. Built from meta.json.flags
// and flags.json; a build without them shows neither section (missing is never zero). The SEC paragraph appears when
// meta.json lists the SEC submissions source.
import "@/styles/flags.css";
import Link from "next/link";
import type { Meta, MetaFlags, ReviewFlags } from "@/lib/types";
import { FLAGS, METHOD_FLAGS, RULE_IDS, RULE_LABEL } from "@/lib/copy-flags";
import { baselineText, statementOf } from "@/lib/domain/flags";
import { count, date } from "@/lib/format";
import { flagsHref } from "@/lib/urls";

function thresholdText(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function MethodFlags({ meta, flags }: { meta: Meta; flags: ReviewFlags | null }) {
  const mf = (meta as { flags?: MetaFlags }).flags;
  const sources = meta.sources && !Array.isArray(meta.sources) ? meta.sources : null;
  const sec = sources?.sec_edgar_submissions;
  if (!mf && !flags && !sec) return null;
  const version = flags?.method_version ?? mf?.method_version ?? null;
  return (
    <>
      {(mf || flags) && (
        <section className="section" id="review-flags" aria-labelledby="flags-h" data-testid="method-flags">
          <h2 id="flags-h">{METHOD_FLAGS.title}</h2>
          <p><strong>{statementOf(flags ?? mf)}</strong></p>
          {mf && <p>{METHOD_FLAGS.intro(count(mf.trades_counted), count(mf.trades_flagged))}</p>}
          <p>
            {version && `${METHOD_FLAGS.version(version)} `}
            {METHOD_FLAGS.listed} <Link href={flagsHref()}>{FLAGS.title}</Link>.
          </p>
          <div className="rules"><dl>
            {RULE_IDS.map((id) => {
              const r = flags?.rules.find((x) => x.id === id);
              const c = r?.counts ?? mf?.rules?.[id];
              if (!r && !c) return null;
              const base = r ? baselineText(r) : null;
              return (
                <div key={id} id={`flag-${id}`} className="method__flag">
                  <dt>{r?.label ?? RULE_LABEL[id]} <span className="mono sub">{id}</span></dt>
                  <dd>
                    {r?.definition && <p>{r.definition}</p>}
                    {r?.thresholds && Object.keys(r.thresholds).length > 0 && (
                      <p className="sub">
                        {METHOD_FLAGS.thresholds}: {Object.entries(r.thresholds).map(([k, v]) => `${k.replace(/_/g, " ")}: ${thresholdText(v)}`).join("; ")}
                      </p>
                    )}
                    {c && <p className="mono sub">{FLAGS.counts(count(c.met), count(c.evaluated), count(c.not_evaluated))}</p>}
                    {base && <p>{base}{r?.baseline?.method ? `. ${r.baseline.method}` : ""}</p>}
                    {r?.note && <p className="sub">{r.note}</p>}
                  </dd>
                </div>
              );
            })}
          </dl></div>
        </section>
      )}
      {sec && (
        <section className="section" id="sec-events" aria-labelledby="sec-h" data-testid="method-sec">
          <h2 id="sec-h">{METHOD_FLAGS.secTitle}</h2>
          <p>
            {METHOD_FLAGS.sec} {typeof sec.retrieved === "string" && METHOD_FLAGS.secRetrieved(date(sec.retrieved))}
          </p>
        </section>
      )}
    </>
  );
}
