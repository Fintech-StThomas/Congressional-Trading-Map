// /status: when the published data was last updated, the sources and revisions it was built from, and how the last
// daily update ran. Server-rendered; remote modes refresh it hourly with the data, local builds are static. The run
// result is fetched from GitHub on the server only (no token, 5 s limit); any failure degrades to "unavailable".
import type { Metadata } from "next";
import Link from "next/link";
import { STATUS } from "@/lib/copy";
import { IS_SAMPLE, latestData } from "@/lib/data/server";
import { metaBuild, metaCoverageNotes, metaSources } from "@/lib/data/meta";
import { REVALIDATE_SECONDS } from "@/lib/data/remote";
import { readLatestRun, type DailyRun } from "@/lib/domain/runstatus";
import { count, date, releaseShort } from "@/lib/format";
import { correctionsLogUrl, dailyRunApiUrl, safeHttpUrl } from "@/lib/urls";
import { ReleasePin } from "@/components/shared/ReleasePin";
import { RelativeAge } from "@/components/shared/RelativeAge";

export const metadata: Metadata = { title: STATUS.title, description: STATUS.description };

type Run = { kind: "run"; run: DailyRun } | { kind: "unavailable" } | { kind: "sample" };

/** The newest daily-update run, or "unavailable" on any failure (network, timeout, rate limit, odd shape). Never throws. */
async function latestRun(): Promise<Run> {
  if (IS_SAMPLE) return { kind: "sample" };
  try {
    const res = await fetch(dailyRunApiUrl(), {
      headers: { "User-Agent": "paper-trail-status", Accept: "application/vnd.github+json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { kind: "unavailable" };
    const run = readLatestRun(await res.json());
    return run ? { kind: "run", run } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export default async function StatusPage() {
  const data = await latestData();
  const [meta, run] = await Promise.all([data.getMeta(), latestRun()]);
  const build = metaBuild(meta);
  const sources = metaSources(meta);
  const notes = metaCoverageNotes(meta);
  const runHref = run.kind === "run" ? run.run.url : null;

  return (
    <div className="page page--read status" data-testid="status-page">
      <ReleasePin release={data.release} />
      <h1>{STATUS.title}</h1>
      <p className="lede">{STATUS.lede}</p>

      <section className="section" aria-labelledby="st-up">
        <h2 id="st-up">{STATUS.updatedHeading}</h2>
        <dl className="kv status__kv">
          <div>
            <dt>{STATUS.updatedAt}</dt>
            <dd className="mono" data-testid="status-built">
              {build.time ? date(build.time) : "not recorded"}
              <RelativeAge built={build.time} />
            </dd>
          </div>
          {build.commit && <div><dt>{STATUS.pipelineCommit}</dt><dd className="mono" title={build.commit}>{build.commit.slice(0, 12)}</dd></div>}
          {build.contract && <div><dt>{STATUS.contract}</dt><dd className="mono">{build.contract}</dd></div>}
          {data.release && <div><dt>{STATUS.release}</dt><dd className="mono" title={data.release}>{releaseShort(data.release)}</dd></div>}
        </dl>
        {data.release && <p className="section__note">{STATUS.releaseNote}</p>}
        {IS_SAMPLE && <p className="section__note"><strong>Sample data.</strong> Every value on this build is invented.</p>}
      </section>

      <section className="section" aria-labelledby="st-run">
        <h2 id="st-run">{STATUS.runHeading}</h2>
        {run.kind === "run" ? (
          <>
            <dl className="kv status__kv" data-testid="status-run">
              <div><dt>{STATUS.runStatus}</dt><dd className="mono">{run.run.status.replace(/_/g, " ")}</dd></div>
              {run.run.conclusion && <div><dt>{STATUS.runConclusion}</dt><dd className="mono">{STATUS.conclusions[run.run.conclusion] ?? run.run.conclusion.replace(/_/g, " ")}</dd></div>}
              {run.run.when && <div><dt>{STATUS.runWhen}</dt><dd className="mono">{date(run.run.when)}</dd></div>}
            </dl>
            {runHref && <p><a href={runHref} target="_blank" rel="noopener noreferrer">{STATUS.runLink}</a></p>}
          </>
        ) : (
          <p className="nd" data-testid="status-run-unavailable">{run.kind === "sample" ? STATUS.runSample : STATUS.runUnavailable}</p>
        )}
      </section>

      <section className="section" aria-labelledby="st-src">
        <h2 id="st-src">{STATUS.sourcesHeading}</h2>
        <p className="section__note">{STATUS.sourcesNote}</p>
        {sources.length === 0 ? (
          <p className="nd">{STATUS.noSources}</p>
        ) : (
          <ul className="sources" data-testid="status-sources">
            {sources.map((s) => {
              const files = Array.isArray(s.files) ? (s.files as { rows?: unknown }[]) : null;
              const rows = isNum(s.rows) ? s.rows : files ? files.reduce((n, f) => n + (isNum(f.rows) ? f.rows : 0), 0) : null;
              const href = safeHttpUrl(s.url);
              const name = typeof s.name === "string" && s.name ? s.name.split(" (")[0] : s.id;
              return (
                <li key={s.id}>
                  <h3>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{name}</a> : name}</h3>
                  <dl className="kv kv--inline">
                    {s.retrieved && <div><dt>{STATUS.retrieved}</dt><dd className="mono">{date(String(s.retrieved))}</dd></div>}
                    {s.revision && <div><dt>{STATUS.revision}</dt><dd className="mono">{String(s.revision).slice(0, 40)}</dd></div>}
                    {rows != null && rows > 0 && <div><dt>{STATUS.rows}</dt><dd className="mono">{count(rows)}</dd></div>}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {notes.length > 0 && (
        <section className="section" aria-labelledby="st-cov">
          <h2 id="st-cov">{STATUS.coverageHeading}</h2>
          <ul className="status__list">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      <section className="section" aria-labelledby="st-what">
        <h2 id="st-what">{STATUS.explainHeading}</h2>
        {STATUS.explain.map((t) => <p key={t}>{t}</p>)}
        <p>
          <Link href="/method">{STATUS.methodLink}</Link> · <a href={correctionsLogUrl()} target="_blank" rel="noopener noreferrer">{STATUS.correctionsLink}</a>
        </p>
      </section>
    </div>
  );
}
