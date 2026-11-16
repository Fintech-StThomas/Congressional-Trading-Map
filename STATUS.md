# Paper Trail: project status

**Read this first.** It is the single shared picture of the project for every teammate and every AI assistant (Claude, ChatGPT or any other), in any session.
**Rule:** whoever changes what is live, what is in progress, or what is planned updates this file in the same pull request. If this file and the code disagree, the code is right and this file must be fixed.

Last updated: 2026-11-16 (America/Chicago)

## What this is

Paper Trail maps every member of Congress who served since 2000 to the organisations and other members that filed public records tie them to: household stock trades, disclosed holdings, PAC money, outside spending, and money between members. Every tie links to its source record. The site reports what filings say and never asserts wrongdoing. Audience: journalists and curious citizens. Tagline: "Talk is cheap. Follow the money."

- Built by: Yuepheng Yang, Cole Pawlenty, Jacob Moreno, Nikhil Jangir
- Funding: none. Free, no ads, open source under the MIT licence (`LICENSE`)
- Live site: https://red-paper-trail.vercel.app/
- Repository: https://github.com/Fintech-StThomas/Congressional-Trading-Map
- Corrections: GitHub issues labelled `correction` (linked from every page)

## How it is wired

```
public sources ──> pipeline/ (Python, runs daily on GitHub Actions at 07:41 UTC)
                     │  builds ~4,000 JSON files, validates them (about 12 million checks)
                     ▼
               Cloudflare R2 bucket  (public: https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data)
                     ▲
web/ (Next.js on Vercel) reads the bucket: pages are built on first visit and refreshed at most hourly
```

- Deploys: merging to `main` deploys the site. Working branches (`claude/*`) do not deploy.
- Vercel setting required: `DATA_BASE_URL` = the bucket URL above. Without it the build fails on purpose.
- Visitor counts: Vercel Web Analytics (cookie-free), viewed in the Vercel dashboard under Analytics.
- Node version: pinned to 24 in `web/package.json`.
- Secrets (GitHub repository secrets, never in code or chat): `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `LDA_API_KEY`, `CONGRESS_API_KEY`, `FEC_API_KEY`.

## Where things are

| Path | What it holds | Start with |
|---|---|---|
| `web/` | The site | `web/README.md` (directory map, "where to change X") |
| `pipeline/` | The data build | `pipeline/README.md` (data flow, stages, how to add a source) |
| `docs/data-dictionary.md` | The contract: every file and field the pipeline writes and the site reads | Change this first when a field changes |
| `docs/validation/` | Human spot-checks of the data against original filings | `docs/validation/README.md` |
| `web/REVIEW.md`, `pipeline/REVIEW.md` | Findings from the November 2026 code reviews | |
| `.github/workflows/data.yml` | The daily data job | |
| `CLAUDE.md`, `AGENTS.md` | Working rules for AI assistants | |

## Data sources

**Live on the site**

| Source | Gives | Coverage |
|---|---|---|
| unitedstates/congress-legislators | Members, terms, parties, current committees | Served since 2000 |
| austin-starks/congressional-stock-trades (Hugging Face) | Household trade reports | July 2012 on; House mostly 2014 on |
| FEC bulk files | PAC money, outside spending for and against, member-to-member money, joint fundraising | 2000 to 2026 cycles |
| ZipLime/congress-trading (Hugging Face) | Disclosed holdings, liabilities, net worth range | House only, report years 2013 to 2025 |
| SEC company list | Company identity and sector for tickers | Current registrants only |
| unitedstates/images | Official portraits | 1,294 of 1,569 members |

**Built but switched off**

| Source | State | To turn on |
|---|---|---|
| Lobbying disclosures (lda.gov) | Module done; contributions downloaded for 2021 to 2026, revolving-door filings for 2026 only. Attribution not yet reviewed | Review the matches, finish the download, set `PT_ENABLE_LDA=1` |

**Not started** (keys are in place where one is needed)

| Source | Would add |
|---|---|
| Senate annual reports | Holdings and net worth for senators (the largest gap; the Senate site requires accepting terms of use) |
| Votes and bills (Congress.gov, Senate and House roll calls) | A vote on a bill affecting a held or donor company |
| Committee hearings | Trades shortly before a hearing on that industry |
| Historical committee membership | Sector held versus sector overseen, for past years |
| Federal contracts (USAspending) | Federal money won by companies a member holds or is funded by |
| FEC spending files | Leadership PAC spending by category; campaign payments to family or member-owned firms; loans a member made to their own campaign |
| Earmarks (2022 on) | Money a member directed to a named recipient |
| Sponsored travel | Who paid for trips (records vanish after four years) |
| SEC insider filings | Family members who are corporate insiders |
| Stock prices | Returns on disclosed trades measured from the disclosure date |
| Prediction markets (Kalshi) | Odds on pending bills (needs bills first) |

## Decisions already made (do not reopen without the owner)

- **Free, no ads, no donation prompts on data pages.** Disclosure data may not be used commercially (other than by news media) or for solicitation: 5 U.S.C. 13107(c).
- **Privacy:** adults named in public filings are published as filed. Minors are redacted where the filing indicates one. Street addresses and personal residences are never published.
- **Wording:** never "corrupt", "insider trading" or any claim of wrongdoing. Trades belong to the household unless the filing says the member owns the asset; joint counts as the member's own.
- **Amounts** are the disclosed ranges. No midpoints are stored.
- **A tie is drawn only when a filed record names both ends,** or a published statistical rule is met. Names are never matched by similarity.
- **Red means a tie and nothing else.** Party is shown by letter and pattern. Spending against a member is not drawn as a tie.
- **Party** is the member's party at the time of each record.
- **Two AI agents at most** run in parallel (usage limits).

## Known gaps and issues

- No holdings data for senators.
- About 21% of PAC dollars attach to a named public company; delisted tickers do not resolve.
- Index funds appear on boards as if they were companies unless the "exclude funds" switch is on.
- Old data (including unredacted names of minors) remains in the repository's git history until the history is rewritten.
- Team spot-checks in `docs/validation/trade-sample.csv` are incomplete; one claimed mismatch (McCaul, Pioneer Natural Resources amount) is unresolved.
- The 205 company matches in `pipeline/crosswalk/org_overrides.csv` await human sign-off.

## In progress

- State-outline reliability: map topology is compiled into the server bundle so ISR no longer depends on excluded `public/geo` files. Missing/incomplete geometry fails the build. The regression reproduced the old failure and now passes two forced homepage regenerations without geometry files. The replacement for PR #9 preserves the newer release-mode documentation and was verified against `main` at `a220679`: fixture build/lint/typecheck passed; web tests: 219 passed, 17 real-data skips. Production-data validation was not repeated because this checkout has no generated `web/public/data/meta.json`; the fix changes no data or pipeline logic. Production receives the fix on deployment after merge.
- Product implementation is sequenced in [`docs/PRODUCT-PLAN.md`](docs/PRODUCT-PLAN.md): release reliability → immutable citations and coverage → disclosure/change analysis → investigation views and saved boards → distribution and source expansion. This supersedes the feature ordering below; that list remains the broader backlog.
- Disclosure timing (plan packet R2.1) is implemented: the pipeline writes and validates `delays.json` (elapsed days from transaction to public availability, as counts in bands), and the site has a `/delays` page ("Timing" in the navigation) plus a timing line above each member's trades table. Trade wording changed from "late" to "public over 45 days after the trade": these are observed days, not a compliance finding. The pipeline half is tested on synthetic rows only; the published bucket has no `delays.json` until the next daily job after merge, and until then `/delays` says the figures are not available. The date audit and its open questions (which date an amended trade carries; House and Senate instructions not re-verified) are in `docs/validation/disclosure-timing-audit.md`.
- Citations and coverage (plan packet R1.4) are implemented: a "Cite this" control on the evidence drawer, the member page and the full file gives copyable text and a JSON packet (record ids, source links, dates and ranges as filed, data build, assumptions, method version, coverage limits). It offers a permanent link only when the page was served from an archived release; otherwise it says none exists. Coverage notes now sit beside the ties, trades and holdings sections (senators see the Senate holdings gap stated outright). Checked by unit tests, the fixture build and screenshots; copying (with and without clipboard access) and print were checked in a browser on 2026-11-16.
- Investigation tools (plan packets R2.2, R3.2, R3.3) are implemented, checked by unit tests, the fixture build and a browser pass on the sample site:
  - `/changes` compares one member's records between two archived data releases, separating filing amendments, same-version changes (source or extraction), additions and removals. It works only once release archiving is switched on; until then it says so. A removed record is described only as "no longer in the data", never as a sale.
  - `/saved` keeps boards of saved members and ties in the reader's browser only (no account, nothing uploaded), with private notes, side-by-side comparison, JSON and citation export, import, and share links that carry only ids (never notes). "Save" sits beside "Cite this" in the evidence drawer and on member pages.
  - `/connect` lists documented paths of up to three published ties between two members or organisations, each step with its records, years and direction; statistical ties and very widely tied organisations are off by default, and there is no score. Linked from member and organisation pages.
- Synchronized views (plan packet R3.1) are implemented: the board, case file and full file share one address-bar view state (years `y`, tie families `f`, assumptions `as`, selected tie `e`, organisation `o`, date basis `d=event|public`), carried by a "Board · Case file · Full file" switcher. Trades can be counted by transaction date or by date made public, never mixed; undated trades are shown in their own bucket (the old timeline silently left them out). Money and holdings have no publication date and stay by record year, as the page says. Checked by unit and smoke tests on the sample site; print layout not checked by eye.
- Feeds, embeds and exports (plan packet R4.1) are implemented: RSS at `/feed/trades.xml` (recent trades from members with recent activity, bounded to 60 member files) and `/feed/m/<id>.xml`; an embeddable member card at `/embed/m/<id>` (script-free; only `/embed/*` may be framed, every other page keeps its anti-framing headers); member share images; and `/export`, a versioned JSON bundle of a member's published rows with the file paths, permanent release URLs when archived, and SHA-256 of the bytes downloaded. Help at `/embed`; linked from `/method` and member pages. Not yet checked in a real cross-site iframe or a feed validator.
- Data-source expansion: `docs/SOURCE-EXPANSION.md` surveys every not-started source (access, terms, exact identifiers, coverage, privacy), with the three reachable APIs (Congress.gov, OpenFEC, LDA) checked live on 2026-11-16. Recommended order: FEC spending and loans; votes and bills; hearings with historical committee membership; Senate annual reports (waits on an owner/counsel decision about the Senate site's terms, not on engineering); then contracts, earmarks, travel, prices, insider filings. A Congress.gov bill sponsorship pilot (`pipeline/congress/`, off unless `PT_ENABLE_CONGRESS=1`) builds an unpublished member-to-bill fact table for 5 members; its review sample `docs/validation/congress-sample.csv` awaits a human reviewer. Nothing from it is published. Owner questions are in section 5 of the survey.
- Verification before merging (branch `claude/gallant-allen-60we8b`, 2026-11-16): pipeline and CI-script tests 242 passed; web build and lint clean; sample-site `npm test` 216 passed, 17 skipped (need real data); real-data `npm test` against the live bucket 228 passed, 5 skipped (one needs `PT_HOLDINGS_DIR`; one needs position timelines, which the bucket build predates; three need the sample fixtures); pinned end-to-end 7 passed; GitHub pull-request checks green. Also checked: both RSS feeds are well-formed RSS 2.0; the embed renders inside a cross-origin iframe while `/about` refuses to be framed; printed case file and full file carry the citation and the active-filter line. A remote-mode build makes 550 bucket requests (101 MB), the same as `main`. Fixed along the way: member pages could be panned sideways on phones (an existing timeline bug). Real-data pipeline: **Daily data refresh** dispatched on this branch (run 43875101026; branches never publish) built the full tree including `delays.json` (306 MB, 3,811 files), and `python -m pipeline.validate` reported 12,129,847 checks, 0 failures; holdings validation 3,473,065 checks, 0 failures.
- Release operations tooling is implemented, all off by default: a storage-provider check (`pipeline/release_provider_check.py`), a release history index (`releases/index.json`), a withdrawal command for privacy/legal exposure, a manual **Release staging and rollback** workflow, and an opt-in archive step in the daily job that runs only when the repository variable `PT_PUBLISH_RELEASES` is `1`. None of it has run against the real bucket or on GitHub. The owner's activation checklist, rollback, withdrawal policy and storage arithmetic (about 225 MiB per daily release, no cross-release de-duplication; retention is an open owner decision) are in `docs/RELEASE-OPERATIONS.md`.
- Release-pinned site readers (plan packet R1.3) are implemented as a third, opt-in data mode: with `RELEASE_BASE_URL` set, every server and browser read is bound to one immutable release, and `/r/<release>/m/<id>` (and its full file) are permanent pages that answer "not available" rather than fall back to the latest data. Production is unchanged: it stays on `DATA_BASE_URL` until the owner follows `docs/RELEASE-OPERATIONS.md`. Verified only against a fake local bucket (`npm run test:pinned`), never on Vercel or the real bucket. Known limits: other links from a pinned page lead to the latest data; a member missing from a valid release shows the same "not available" page; `/about` does not pin the header search.
- Pull request #8 adds deterministic release manifests and an opt-in immutable archive publisher. It is not wired into the daily job and production remains unchanged. Release-pinned readers, citation UI, contextual coverage, provider staging checks and a withdrawal policy remain required before activation.
- The financial-history and security/CI continuation is now on `main`: House member pages include asset timelines, change since the first disclosed report and debt history; full files include transition CSV. Automated checks run on every PR, and this branch extends the site job to run Chromium/CSP tests.
- The latest daily job inspected in this session succeeded (run 43784027285 on 2026-11-15 Central time). Branch protection could not be inspected with the available GitHub token.
- Branch protection and moving R2 upload secrets into a `production` GitHub Environment remain owner setup; instructions are in `docs/SECURITY-REVIEW.md`.

## Security and capacity (reviewed 2026-11-15; full report in `docs/SECURITY-REVIEW.md`)

The findings below describe that review's baseline. Local code now implements identifier checks, headers,
asset caching, edge-cache policy invalidation, and source-link validation; deployment/browser verification and
platform configuration remain separate gates in `docs/PRODUCT-PLAN.md`. Capacity figures are from the earlier
report, not measurements repeated in this session.

- No high-severity findings. The live site served 100 concurrent users (277 requests a second) with no errors.
- The limit is Vercel's free-plan monthly quotas, not speed: roughly 300 to 400 first-time visitors a day as configured. The fixes below should raise that to roughly 1,000 to 2,000. A day of news-level traffic needs the paid plan.
- Fixed in code: malformed/unknown member ids are rejected before per-member reads; CSP and other browser headers; safe source links; browser caching for portraits/map files and lazy off-screen portraits; hourly data revalidation, per-process fetch single-flight, and bucket cache-policy invalidation.
- Partly fixed: cost amplification from cold requests (single-flight does not span serverless instances, and query-string variants/rate limiting remain open). Hourly bucket caching needs a successful publish and public-header confirmation.
- Open owner configuration: restrict R2 upload secrets to `main` with a GitHub Environment; protect `main` once the new checks have run. See the finding-by-finding table and setup instructions in `docs/SECURITY-REVIEW.md`.
- Load test scripts teammates can re-run: `scripts/loadtest/` (test only your own deployment).

## Next, in order

**Housekeeping**
1. Coordinate the approved git-history cleanup after this PR merges (see the release checklist below; teammates must re-clone).
2. Protect `main` using the implemented checks so failing checks prevent merging (owner setup in `docs/SECURITY-REVIEW.md`).
3. Complete the remaining deployment checks and security/capacity configuration listed above.

**Data and features: a fuller financial profile**
4. Lobbying: review attribution, finish the download, switch on.
5. Senate holdings.
6. Sector held versus sector overseen: share of a member's disclosed portfolio in industries their committees regulate (needs historical committee membership).
7. FEC spending and summary files: loans a member made to their own campaign and their repayment; campaign payments to family members or member-owned firms; leadership PAC spending by category.
8. Returns measured from the disclosure date: what copying each trade on the day it became public would have earned, against a benchmark.
9. Outside income, positions and gifts (other schedules of the annual reports; needs our own parsing of the House PDFs).
10. Votes, bills and hearings; then prediction-market odds on pending bills.
11. Federal contracts; earmarks; sponsored travel; SEC insider filings.
12. Alerts and explainable overlap indicators (individual measures and methods, without a composite conflict score).

**Release checklist**
1. Before enabling immutable publishing, verify R2 conditional writes on a staging prefix or bucket and deploy compatible release-pinned readers. Keep the current daily publisher in place until the reader migration is verified.
2. After merges that affect generated data, dispatch **Daily data refresh** on `main`; confirm the job succeeds, `data/meta.json` advances, timelines and `delays.json` are available, and bucket/proxied data headers allow an hour of edge caching. As of 2026-11-16 the bucket still holds the 2026-11-15 15:03 UTC build: the next `main` run (43761542434) failed on a test-environment leak since fixed in `data.yml`, and no run on `main` has published since, so the position timelines merged earlier are not live yet.
   Then switch on archived releases in the order in `docs/RELEASE-OPERATIONS.md` (provider check → `PT_PUBLISH_RELEASES=1` → one observed archived run → `RELEASE_BASE_URL` on a Vercel Preview → Production), after deciding retention (about 225 MiB per daily release, about 86 GB a year unthinned).
3. Move the R2 secrets into a `production` GitHub Environment restricted to `main`, and enable the workflow environment as coordinated in `docs/SECURITY-REVIEW.md`. Confirm other branches cannot publish or access those environment credentials.
4. Rewrite history to remove `web/public/data` from every commit. The owner approved this on 2026-11-15, but first coordinate a time with no open PRs and nobody mid-work. Use `git filter-repo --path web/public/data --invert-paths`, force-push `main` once, and have all four teammates delete their copies and re-clone. Prepare an owner message to GitHub Support requesting cached views and unreachable commits be purged, including closed PRs #1–#6. Do not rewrite while this PR is open.
5. Continue with lobbying attribution review/downloads, then the remaining feature list. Human review of the new 20-timeline sample remains open; automated checks are not human sign-off. Complete the existing trade sample/McCaul recheck and the 205 company override approvals.
6. Vercel Pro ends 2026-11-26: the owner should downgrade a few days early and confirm the free-plan deployment works.

**Optimisations**
- A custom domain on the R2 bucket (the current r2.dev address is rate-limited by Cloudflare and meant for development; on 2026-11-16 it answered 429 to a local build, which passed on retry, and Vercel builds read the same address).
- Dated snapshots of the data, so any past figure can be cited and reproduced.
- Split the largest files (the 7.5 MB trades file by year; the organisations index).
- Automatic dependency updates and security alerts.
- An uptime check on the site and on the daily job.

## Working rules

- Work on a branch, open a pull request, merge to `main`. Never push unfinished work to a branch with an open pull request.
- Before a pull request: `python -m pipeline.validate` reports 0 failures, `python -m pytest pipeline/tests` passes, and in `web/` both `npm run build` and `npm test` pass.
- Keep the layout described in `web/README.md` and `pipeline/README.md`. New code goes in the folder for its concern; every file starts with a short comment saying what it is for; shared helpers are reused, not copied.
- Change `docs/data-dictionary.md` first when the data shape changes.
- Update this file in the same pull request.
