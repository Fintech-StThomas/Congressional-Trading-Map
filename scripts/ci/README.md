<!-- CI checks, local equivalents, and the distinction between fixtures and published-data validation. -->
# Pull-request verification

`.github/workflows/checks.yml` runs on pull requests and manual dispatch, with read-only repository access and
no production credentials. Pipeline tests use temporary data and moto's fake object storage. Web tests build
the invented fixtures, run lint/type checks, and exercise a local Chromium browser (including CSP assertions).
Playwright is pinned in the web lockfile; CI installs its browser and system dependencies explicitly.

The status policy compares the PR head with its merge base. Code, tests, workflow, configuration and asset
changes require an added/modified `STATUS.md`. Markdown, `docs/`, LICENSE and NOTICE changes alone are exempt.
Deleting STATUS or renaming code into documentation cannot bypass the rule. Manual dispatch runs policy tests
but has no PR to evaluate. Branch protection must require all three workflow jobs after their first successful run;
this file does not assert that protection is configured.

Local equivalents, from the repository root:

```bash
python -m unittest scripts.ci.test_check_status
python scripts/ci/check_status.py origin/main HEAD
python -m pytest -q pipeline/tests
cd web
npm ci
npx playwright install chromium
PT_DATA=fixtures npm run build
npm run typecheck
PT_DATA=fixtures npm test
```

The policy checks committed branch changes, not an uncommitted working tree. Browser tests needing real members
report an explicit skip on fixtures. Neither those skips nor fake storage validate original filings or live R2
conditional-write behavior. Before merging production data changes, run the full pipeline validators on a real
generated tree and the required real-data integration checks from `AGENTS.md` and `STATUS.md`.
