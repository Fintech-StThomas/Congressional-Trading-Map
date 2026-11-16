<!-- Handoff for the unfinished parts of the product-plan continuation on this branch. Delete it in the PR that finishes them. -->
# Handoff

Branch: `claude/gallant-allen-60we8b` (no pull request opened yet). Everything below is committed and pushed.

## Done on this branch
All product-plan packets R1.2 (operations), R1.3, R1.4, R2.1, R2.2, R3.1, R3.2, R3.3 and R4.1, plus the source-expansion
survey and an unpublished Congress.gov pilot. Details and limits per item are in `STATUS.md` ("In progress") and the
execution log at the end of `docs/PRODUCT-PLAN.md`.

## Not verified (could not be run in the session)
- `python -m pipeline.validate` and `python -m pipeline.holdings.validate --no-pdf`: there is no generated dataset in a
  fresh checkout. Run them on a real build before merging; the new `delays.json` checks fail on any tree built
  before this branch, so the first daily job after merge is the real test.
- Anything against the real R2 bucket, Vercel, or GitHub Actions (the two workflows were only parsed).
- Real-data browser tests passed on 2026-11-16 against the live bucket (build `2026-11-15T15:02:21Z`): `npm test` 228 passed,
  5 skipped (one needs `PT_HOLDINGS_DIR`; one needs position timelines, which that bucket build predates; three need the
  sample fixtures), 0 failed. A manual pass covered citations, view switching, `/connect`, `/saved`, feeds, embed and the
  share image with real members. Still unchecked: print output, clipboard, a real cross-site iframe for `/embed`, and an
  RSS validator for `/feed/*.xml`.
- The bucket's latest build (`2026-11-15T15:02:21Z`) is older than today's 07:41 UTC scheduled run should have produced,
  and it has no `holdings/positions/` files: check whether the 2026-11-16 daily run failed before merging.
- The public `r2.dev` address answered 429 (rate limited) on the first live-data build; a retry a few minutes later
  passed. Vercel builds use the same address, so a custom domain on the bucket (STATUS "Optimisations") would make
  builds more reliable.

## Next commands
```
python -m pip install -r pipeline/requirements.txt pytest
python -m pytest -q pipeline/tests scripts/ci
cd web && npm ci && npm run build && npm test && npm run test:pinned
DATA_BASE_URL=https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data PT_DIST_DIR=.next-remote npm run build   # then restore web/tsconfig.json with git checkout
```
Local Playwright note: if `chromium.launch()` cannot find revision 1234, point `PLAYWRIGHT_BROWSERS_PATH` at a folder
with `chromium_headless_shell-1234` symlinked to the installed revision (or set `PT_CHROMIUM` for the pinned test).

## Blockers needing the owner
1. Release activation: run **Release staging and rollback** → `provider-check`, then follow `docs/RELEASE-OPERATIONS.md`
   (set `PT_PUBLISH_RELEASES=1`, observe a daily run, try `RELEASE_BASE_URL` on a Preview, then Production).
2. Retention policy for archived releases (about 225 MiB a day, about 86 GB a year with no thinning).
3. Owner questions in `docs/SOURCE-EXPANSION.md` section 5 (Senate eFD terms, a `legislates_with` rule, FEC payee privacy).
4. Human reviews: `docs/validation/congress-sample.csv`; the open questions in `docs/validation/disclosure-timing-audit.md`.
