// Reads the one workflow run /status shows from GitHub's "list workflow runs" response. Defensive: anything that is not
// the expected shape is "no run" (the page then says run history is unavailable), never a guess. Pure.
import { safeHttpUrl } from "../urls.ts";

export type DailyRun = {
  /** queued, in_progress or completed (GitHub's words). */
  status: string;
  /** success, failure, cancelled ... or null while the run is not completed. */
  conclusion: string | null;
  /** ISO time the run started (or was created). */
  when: string | null;
  /** The run's page on github.com (http/https only), or null. */
  url: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The newest run in a `{ workflow_runs: [...] }` response, or null. */
export function readLatestRun(json: unknown): DailyRun | null {
  const runs = (json as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const r = runs[0] as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const status = str(r.status);
  if (!status) return null;
  return { status, conclusion: str(r.conclusion), when: str(r.run_started_at) ?? str(r.created_at), url: safeHttpUrl(r.html_url) };
}
