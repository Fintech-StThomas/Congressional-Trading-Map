# Handoff: where the work stopped

Written 2026-11-16 00:30 UTC for a new session or AI assistant with no memory of the earlier work.
Read `STATUS.md` first (what the project is, what is live, settled decisions), then `AGENTS.md` (working rules), then this file.
**Delete this file in the pull request that finishes the work described here**, and move anything still open into `STATUS.md`.

## State in one paragraph

`main` is healthy and deployed: https://red-paper-trail.vercel.app/ serves from the R2 bucket. The working branch `claude/vigilant-edison-wovcu2` is 2+ commits ahead of `main` with **unfinished, unverified** work from two tasks that were interrupted by a usage limit. No pull request is open. The daily data job on `main` is **failing** (see below); the site keeps serving the build from 2026-11-15 15:02 UTC until that is fixed.

## Task A: security and capacity fixes, and pull-request checks (unfinished)

Source of the findings: `docs/SECURITY-REVIEW.md`. The brief was: fix the open findings, add `.github/workflows/checks.yml`, and fix the failing daily job.

Done on the branch, **not yet verified together**:
- Daily job fix: `PT_R2_REQUIRED` moved from job level to the publish step in `.github/workflows/data.yml`; `pipeline/tests/test_publish_r2.py` no longer depends on the surrounding environment.
- Id validation before any bucket fetch: `web/src/lib/data/ids.ts`, used by the member, records, board-member, board-data and cases routes and their `/live` twins.
- Security headers: `web/src/lib/security-headers.ts`, wired in `web/next.config.ts`.
- Single-flight for cold fetches: `web/src/lib/data/flight.ts`.
- Edge caching: `Cache-Control` with `s-maxage=3600` in `pipeline/publish_r2.py` and a `/data/*` header rule in `web/next.config.ts`.
- `installCommand: npm ci` in `web/vercel.json`; unguarded link fixed in `RecordsView.tsx`; `npm run test:unit` (`web/scripts/test-unit.mjs`); `web/tests/security.test.mjs`.

Not done:
- `.github/workflows/checks.yml` and `scripts/ci/` (the STATUS.md check script and its test) do not exist yet.
- GitHub Actions in `data.yml` still need bumping to versions that target Node 24, with new pinned commit SHAs.
- Browser caching for `/portraits` and `/geo`, and lazy loading of off-screen portraits: check whether present.
- The manifest "header policy version" so a `Cache-Control` change re-uploads unchanged files once: check whether present.
- A browser run proving **zero Content-Security-Policy violations** on every main page, in local mode and in remote mode against the real bucket. Do not ship the headers without this.
- `docs/SECURITY-REVIEW.md` and the "Security and capacity" section of `STATUS.md` updated with fixed / partly / open per finding.
- Owner instructions for branch protection and for moving the R2 secrets into a GitHub Environment.

## Task B: position timeline, net worth change, leverage (unfinished)

Uses only data already held (House holdings 2013 to 2025 plus trades). Rules are in the brief summarised here: join yearly holdings snapshots with trades per asset; classify each year-to-year transition as consistent, unexplained appearance, unexplained disappearance, or band change with no trade; report disagreements as facts about the records, never accusations; a gap in reports is "no report available", not "sold".

Done on the branch, **not yet run end to end**:
- `pipeline/holdings/positions.py`, `profile.py` (net worth change, leverage), `ranges.py`, `validate_positions.py`, edits to `run.py` and `validate.py`.
- Tests: `pipeline/tests/test_holdings_positions.py`, `test_holdings_profile.py`.
- Site logic: `web/src/lib/domain/positions.ts`; a small uncommitted-at-the-time edit to `web/src/lib/copy.ts` (now committed with this file).

Not done:
- The positions validator was being written when the work stopped; confirm it is complete and wired in.
- A full `PT_CACHE_ONLY=1 python -m pipeline.run` with both validators at 0 failures.
- The site: the "Positions over time" timeline, "Change since first report", and the "Liabilities" panel on the member page; the transition table with CSV in the records view; screenshots reviewed.
- Sanity numbers (distribution of transition classes; the most common assets with unexplained appearances, expected to be index funds and money-market funds).
- `docs/data-dictionary.md`, the READMEs and `STATUS.md` updated.

## How to verify before opening a pull request

From the repository root (the Python environment is `pipeline/.venv`; generated data is not in git, see `web/README.md` "Run locally" for the three ways to get data):

```
python -m pytest -q pipeline/tests
PT_CACHE_ONLY=1 python -m pipeline.run          # needs pipeline/.cache; otherwise drop PT_CACHE_ONLY and allow downloads
python -m pipeline.validate && python -m pipeline.holdings.validate
cd web && npm ci && npm run build && npm test   # local mode needs data in web/public/data, or set DATA_BASE_URL
```

Remote mode check: build with `DATA_BASE_URL=https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data` from a copy of `web/` that has no `public/data`.

## After the pull request merges, in this order

1. Confirm the merge on GitHub (do not take anyone's word for it), then check the live site.
2. Trigger the "Daily data refresh" workflow on `main` and confirm it succeeds and the bucket's `data/meta.json` shows a new build time.
3. **Rewrite git history** (the owner approved this on 2026-11-15): remove `web/public/data` from every commit so old data, including unredacted names of minors, is gone and the repository shrinks. Conditions: no open pull requests; nobody mid-work; force-push `main` once; tell all four teammates to delete their copies and clone again; draft a message for the owner to send GitHub Support asking them to purge cached views and unreachable commits (closed pull requests #1 to #5 still reference the old commits). Tool: `git filter-repo --path web/public/data --invert-paths`.
4. Lobbying: review the attribution, finish the download, set `PT_ENABLE_LDA=1`. Then continue down "Next, in order" in `STATUS.md`.

## Things the owner has been asked and not yet done

- Complete `docs/validation/trade-sample.csv`: fill `matches_filing` on every checked row, reword informal comments, and re-check the McCaul Pioneer Natural Resources amount (checker says $1,000,001 to $5,000,000; data says $15,001 to $50,000).
- Sign off the 205 company matches in `pipeline/crosswalk/org_overrides.csv`.
- Protect `main` once the checks workflow exists.
- Vercel Pro ends 2026-11-26; downgrade a few days early to confirm the site runs on the free plan.

## Lessons from this build (keep doing these)

- Never push to a branch that has an open pull request; verify merges on GitHub before continuing.
- Anything that runs only on GitHub (workflows) is unverified until it has actually run there: trigger it by hand after merging.
- Two AI agents at most in parallel; they share one usage limit, and a limit cuts work off mid-file.
- The agents' checkpoints are committed as "work in progress"; treat them as untested until the commands above pass.
