# Paper Trail: project status

**Read this first.** It is the single shared picture of the project for every teammate and every AI assistant (Claude, ChatGPT or any other), in any session.
**Rule:** whoever changes what is live, what is in progress, or what is planned updates this file in the same pull request. If this file and the code disagree, the code is right and this file must be fixed.

Last updated: 2026-11-14

## What this is

Paper Trail maps every member of Congress who served since 2000 to the organisations and other members that filed public records tie them to: household stock trades, disclosed holdings, PAC money, outside spending, and money between members. Every tie links to its source record. The site reports what filings say and never asserts wrongdoing. Audience: journalists and curious citizens. Tagline: "Talk is cheap. Follow the money."

- Live site: https://red-paper-trail.vercel.app/
- Repository: https://github.com/Fintech-StThomas/Congressional-Trading-Map
- Corrections: GitHub issues labelled `correction` (linked from every page)

## How it is wired

```
public sources ──> pipeline/ (Python, runs daily on GitHub Actions at 07:41 UTC)
                     │  builds ~3,000 JSON files, validates them (about 12 million checks)
                     ▼
               Cloudflare R2 bucket  (public: https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data)
                     ▲
web/ (Next.js on Vercel) reads the bucket: pages are built on first visit and refreshed every 15 minutes
```

- Deploys: merging to `main` deploys the site. Working branches (`claude/*`) do not deploy.
- Vercel setting required: `DATA_BASE_URL` = the bucket URL above. Without it the build fails on purpose.
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

- Removing generated data from git (it now lives in R2).
- Security review and load test of the live site.

## Next, in order

1. Rewrite git history to drop the old data (owner must confirm timing; teammates must re-clone).
2. Lobbying: review attribution, finish the download, switch on.
3. Senate holdings.
4. Position timeline per asset (holdings snapshots joined with trades), and sector held versus sector overseen.
5. FEC spending files: leadership PAC categories, payments to family, loans to own campaign.
6. Votes, bills and hearings; then prediction-market odds.
7. Federal contracts; earmarks; sponsored travel.
8. Alerts, the conflict score, and returns measured from the disclosure date.

## Working rules

- Work on a branch, open a pull request, merge to `main`. Never push unfinished work to a branch with an open pull request.
- Before a pull request: `python -m pipeline.validate` reports 0 failures, `python -m pytest pipeline/tests` passes, and in `web/` both `npm run build` and `npm test` pass.
- Keep the layout described in `web/README.md` and `pipeline/README.md`. New code goes in the folder for its concern; every file starts with a short comment saying what it is for; shared helpers are reused, not copied.
- Change `docs/data-dictionary.md` first when the data shape changes.
- Update this file in the same pull request.
