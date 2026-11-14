# Data pipeline

Builds the JSON the site reads from `web/public/data/` out of filed public records: the member list, household
stock trades, FEC committee money, House annual disclosures (holdings) and, when switched on, lobbying reports. The
binding description of every output file, type and rule is [`docs/data-dictionary.md`](../docs/data-dictionary.md);
this file is the map of the code.

## Run

```bash
python3.13 -m venv pipeline/.venv
pipeline/.venv/bin/pip install -r pipeline/requirements.txt
pipeline/.venv/bin/python -m pipeline.run                    # every stage, then validation (about 5 minutes cached)
pipeline/.venv/bin/python -m pipeline.run --stage assemble   # one stage (repeat --stage for several)
pipeline/.venv/bin/python -m pipeline.validate               # validation only; exits 1 on failure
pipeline/.venv/bin/python -m pipeline.holdings.validate      # holdings checks (--no-pdf skips the PDF text check)
pipeline/.venv/bin/python -m pytest -q pipeline/tests        # unit tests
pipeline/.venv/bin/python -m pipeline.publish_r2 --verify    # upload web/public/data to R2 (skips without R2_* vars)
```

Run from the repository root. Downloads are cached in `pipeline/.cache/`; intermediate files go to `pipeline/build/`
(both gitignored). Environment variables, all optional:

| Variable | Effect |
|---|---|
| `SEC_USER_AGENT` | User-Agent for every request (default `congressional-trading-map-class-project research@example.org`) |
| `HF_REVISION`, `HF_HOLDINGS_REVISION` | pin the trades / holdings datasets to a commit (default: their current commit) |
| `PT_CACHE_ONLY=1` | reuse every cached download regardless of age (reproducible rebuilds, offline work) |
| `PT_OUT_DIR` | publish somewhere other than `web/public/data/` (dry runs, comparisons) |
| `PT_ENABLE_LDA=1`, `LDA_API_KEY` | switch the lobbying stage on (off by default; "off" also removes stale `lda.*` plug-in files) |

To check that a change is a pure refactor, rebuild into a copy and compare hashes:
`PT_CACHE_ONLY=1 PT_OUT_DIR=/tmp/out HF_REVISION=<sha> HF_HOLDINGS_REVISION=<sha> python -m pipeline.run` (the
revisions are in `meta.json.sources`); only `meta.json`'s build time, commit and retrieval times may differ.

## Data flow

```
congress-legislators ──► spine ──► spine.json, committees.json ─────────────────────────┐
HF trades dataset ─────► trades ─► trades.parquet ──► companies ──► ticker_orgs.json ───┤
SEC tickers + FSDS ──────────────────────────────────┘    │         companies.json      │
                                                           │         company_names.json  │
FEC bulk files ────────► fec ──────────────────────────────┴───────► edges/fec_*.jsonl   │
                         edges_trades (traded, traded_together) ───► edges/trades.jsonl  │  pipeline/build/
                         edges_committees (sits_with) ─────────────► edges/committees    │  (plug-in files:
HF holdings dataset ───► holdings (pass 1) ────────────────────────► edges/holdings_owns │   edges/, orgs/,
LDA API (off) ─────────► lda ──────────────────────────────────────► edges/lda.jsonl     │   sources/)
                                                                                         ▼
                         assemble ─► staging dir ─► swap ─► web/public/data/{members,trades,orgs,...}.json
                         holdings_publish (pass 2: overlaps vs this build) ─► web/public/data/holdings/
                         validate ─► exit 1 on any failure
```

## Stages

Times and peak memory (resident set of the whole process, which only grows) from a cached full run on 2026-11-14.

| Stage | Code | Reads | Writes (under `pipeline/build/` unless noted) | Time | Peak RSS |
|---|---|---|---|---:|---:|
| `spine` | `spine.py` | congress-legislators (daily) | `spine.json`, `committees.json`, `sources/legislators.json` | 1 s | 0.1 GB |
| `trades` | `trades.py` | HF `austin-starks/congressional-stock-trades` (by commit) | `trades.parquet`, `sources/hf_trades.json` | 5 s | 1.2 GB |
| `companies` | `companies.py`, `sic.py` | SEC tickers (daily), FSDS `sub.txt`, `trades.parquet`, overrides | `ticker_orgs.json`, `companies.json`, `company_names.json`, `sources/sec.json` | 1 s | 1.2 GB |
| `fec` | `fec/` | FEC bulk files (see its README), `spine.json`, `company_names.json`, overrides | `edges/fec_*.jsonl`, `orgs/fec.jsonl`, `sources/fec.json` | 162 s | 1.9 GB |
| `edges_trades` | `edges_trades.py` | `trades.parquet`, `ticker_orgs.json`, `companies.json` | `trades_resolved.parquet`, `edges/trades.jsonl`, `orgs/trades.jsonl` | 23 s | 1.5 GB |
| `edges_committees` | `edges_committees.py` | `committees.json` | `edges/committees.jsonl` | 1 s | |
| `lda` | `lda/` | LDA API pages (off unless `PT_ENABLE_LDA=1`) | `edges/lda.jsonl`, `orgs/lda.jsonl`, `sources/lda.json` | 0 s | |
| `holdings` | `holdings/` | HF `ZipLime/congress-trading` (by commit), build files | `web/public/data/holdings/`, `holdings-index.json`, `edges/holdings_owns.jsonl`, `orgs/holdings.jsonl`, `sources/holdings.json`, `holdings_rows.json` | 21-23 s | 1.7 GB |
| `assemble` | `assemble/` | every plug-in file, `trades_resolved.parquet` | every other file in `web/public/data/` (staging dir, then swap) | 84 s | 4.2 GB |
| `holdings_publish` | `run.py` | the newly published member files | the holdings files again, with this build's overlaps; `meta.json.reports.holdings` | 21-23 s | |
| `validate` | `validate.py` | `web/public/data/`, `trades*.parquet` | `validation_sample.csv` | 13 s | |

Whole run: 322-332 s, peak 4.3 GB (before this review: 294 s, 5.9 GB).

## Code layout

```
pipeline/
  run.py              stage list and order; `python -m pipeline.run`
  config.py           every tunable constant (caps, thresholds, windows, case rule, budget); echoed in meta.json
  contract.py         contract shapes: TypedDicts (Edge, Evidence, Case, Trade, ...), column lists, edge families
  util.py             paths, cached HTTP with retry, deterministic JSON, override file, name/ticker normalisation
  edges.py            range arithmetic (sum_amounts), by_year, evidence ranking, edge ids
  spine.py trades.py companies.py sic.py edges_trades.py edges_committees.py    core sources and edges
  fec/                download -> load (parse) -> refs (identities) -> build (rules, edges, orgs) -> run (write, checks)
  holdings/           source (download) -> run (parse, resolve, emit) -> rules (redaction) -> validate
  lda/                download -> build (parse) -> match (identities) -> edges -> run (write, checks); off by default
  assemble/           plugins (load, merge) cases budget orgs wall members publish, run (the orchestrator)
  validate.py         output checks; holdings/validate.py for holdings
  publish_r2.py       upload web/public/data to Cloudflare R2 (changed files only); run by the daily workflow
  crosswalk/org_overrides.csv   hand-reviewed org matches
  tests/              one test file per module: test_edges, test_trades, test_fec, test_assemble, test_holdings, ...
```

Every source module has the same shape: **download/cache** (through `util.fetch`: temporary file, rename, retries,
a `.meta.json` sidecar with sha256 and Last-Modified) -> **parse** (assert row counts) -> **resolve identities**
(exact ids and exact normalised names only, plus reviewed overrides) -> **emit plug-in files** -> **self-check**.

## Adding a source

1. Create `pipeline/<source>/` (or one module) that downloads through `util.fetch`, parses with explicit column lists
   and asserts row counts at each join.
2. Map members by an exact id (bioguide, FEC candidate id) or the strict rules in `lda/match.py`; map orgs by exact
   ticker, exact `util.normalise_name`, or `util.read_overrides`. Never fuzzy-match.
3. Build edges with `edges.make_edge` / `by_year` / `top_evidence` and write `edges/<source>.jsonl`,
   `orgs/<source>.jsonl` (`util.write_jsonl`) and `sources/<source>.json` (`util.write_source_meta`) as in the data
   dictionary's "Intermediate plug-in format". Every evidence `source` must be a key of your `sources` object.
4. Add the stage to `STAGES` in `run.py` before `assemble`. The assembler needs no change: it merges every file in
   `edges/`, `orgs/` and `sources/`, and drops (and counts) edges with unknown endpoints or unlisted sources.
5. Add thresholds to `config.py`, rules to the data dictionary, tests to `tests/test_<source>.py`, and run
   `python -m pipeline.run` to 0 validation failures.

## Overrides

`crosswalk/org_overrides.csv` (`source, source_id_or_name, org_id, note, reviewed_by, reviewed_on`) holds matches a
person checked. `util.read_overrides` is the only reader: rows without `reviewed_by` are ignored (never applied).
`source` = `ticker` (applied by `companies.py` and, for printed tickers, by `holdings/`), `fec` / `fec_committee` /
`fec_connected_org` (FEC payers, by committee id or connected-organisation name), `lda_registrant` / `lda_client`.

## Validation

`python -m pipeline.run` ends with `validate.py` (12 million checks: schemas, row counts across joins, evidence and
endpoints, by_year sums, ledger completeness and caps, the Case rule re-derived from published edges, cross-file
counts, no minor's name in trade text). `python -m pipeline.holdings.validate` checks the holdings files. Both
exit 1 on any failure. The hand-check samples are written to `pipeline/build/`; the copies in `docs/validation/` are
filled in by people and are never overwritten (see `docs/validation/README.md`).

## Daily workflow

`.github/workflows/data.yml` runs tests, the whole pipeline and the holdings validator daily (07:41 UTC) and on manual
dispatch, one run at a time per branch. Any failure (a stage, validation) skips the commit step. It commits only
`web/public/data/`, and only when a file other than `meta.json` changed. Then it publishes the same tree to R2 (below).
Actions are pinned to commit SHAs; the job alone has `contents: write`; each secret is given only to the step that
needs it (the pipeline step: `LDA_API_KEY`, `SEC_USER_AGENT`; the publish step: the `R2_*` secrets) and never printed.
Downloads are cached between runs, and each source refetches on its own schedule, so the cache never freezes data.

Manual dispatch has one input, `publish_only` (boolean, default off): it skips the cache, pipeline, holdings
validation and commit, and uploads the committed `web/public/data/` to R2 (Actions tab -> "Daily data refresh" ->
"Run workflow" -> tick `publish_only`; or `gh workflow run data.yml -f publish_only=true`). Use it for the first
upload and to re-sync the bucket by hand.

## Publishing to R2

First stage of moving generated data out of git: the site still reads `web/public/data/` from the repository, and the
workflow still commits it. `pipeline/publish_r2.py` uploads the tree to Cloudflare R2 through the S3-compatible API
(boto3, region `auto`, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`) under the key prefix `data/`, so
`web/public/data/members/A000001.json` becomes `<R2_PUBLIC_URL>/data/members/A000001.json`.

| GitHub secret | Use |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id (only in the endpoint host) |
| `R2_BUCKET` | bucket name |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | an R2 API token with object read and write on that bucket |
| `R2_PUBLIC_URL` | public base URL of the bucket (custom domain or r2.dev), used only to verify the upload |

Without the first four the script prints "R2 upload skipped" and exits 0 (local runs, forks). What it does:

1. Hashes every file (path -> SHA-256) and reads the previous manifest `data/_manifest.json`
   (`{build_time, prefix, files: {path: sha256}}`); when it is missing or unreadable, every file is uploaded.
2. Uploads only files whose hash changed (16 at a time, each retried on network errors, 429 and 5xx), as plain JSON
   with `Content-Type: application/json` and `Cache-Control: public, max-age=300, stale-while-revalidate=86400` (the
   same URLs are overwritten daily). No gzip and no Content-Encoding: plain JSON objects (Cloudflare can compress
   responses on a custom domain; that is not relied on).
3. Uploads `meta.json` after every other data file, then the new manifest. Readers can treat `meta.json`'s
   `build.time` as the switch: when it changes, every file of that build is in place.
4. Only after all of that succeeded, deletes objects under `data/` that are not in the build (refusing to delete more
   than half the bucket in one run unless `--allow-mass-delete`).
5. With `--verify`, fetches `<R2_PUBLIC_URL>/data/meta.json` (cache-busting query) and compares the build time.

Any failed upload exits 1 before `meta.json`, the manifest and deletions, so the bucket keeps the previous manifest
and `meta.json`; files that did upload are sent again next run because the old manifest still lists their old hashes.
The script never prints secrets or the endpoint. Tests: `pipeline/tests/test_publish_r2.py` (moto's fake S3).

## Privacy

Public data stays public: everything here comes from public filings (FEC reports, House and Senate disclosure
reports, congress-legislators), and adults named in them are published as filed. Only minors are redacted, because
they did not choose public life.

- **Published as filed:** members and their spouses; adults named in account titles (an IRA "FBO" an adult, trusts
  named after adults, the member's or spouse's own name); FEC committees, and independent-expenditure payees
  (the vendors and consultants a committee paid, individuals and organisations alike, in the "(paid to ...)"
  evidence labels and `meta.json.reports.fec.review_large_funds_rows`); liability creditors and types (no change
  to the creditor name, whether a bank or a person).
- **Redacted (minors only):** a beneficiary's name becomes `[name redacted]` only when the filing row itself
  indicates a minor: (1) a custodial account form (`UTMA`, `UGMA`, `UTA` but not `UTA DTD`, "custodian (for)",
  "cust", "minor" / "a minor"); (2) a 529 or education-savings account (`529`, Coverdell, `ESA`, "education
  savings") naming a beneficiary; (3) any row whose owner is filed as a dependent child (owner `dependent`), where
  person-shaped names in the account title are redacted as well. On rows (1) and (2) the name after `FBO`, `f/b/o`,
  "for the benefit of", "custodian for" or "beneficiary", and a "First [M.] Last" name directly before
  `UTMA`/`UGMA`/`UTA`, are redacted. When the filing gives no way to tell and the owner is not a dependent child, the
  text is published as filed. Counts per rule: `meta.json.reports.holdings` (`asset_minor_name_redacted_<rule>`).
- **Never published:** street addresses (locations are cut to "City, ST"; street addresses in asset, creditor and
  liability-type text become `[street address redacted]`) and personal residences (rows that name a personal
  residence or non-rental second home are dropped). The pipeline never reads the FEC individual-contributions file,
  so no individual contributor is published.

Both validators check that no published asset or trade text still carries a minor's name under these indicators.

The binding version is the data dictionary's "Privacy" section; the code is `holdings/rules.py`
(`minor_rule`, `redact_beneficiary`, `redact`, `city_state`, `is_personal_residence`).

## Sources and licences

| Source id | What | Revision recorded | Licence |
|---|---|---|---|
| `legislators` | [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators): current and historical legislators, current committees and membership | gh-pages commit SHA (via `git ls-remote`), file SHA-256s | CC0 / public domain |
| `hf_trades` | [austin-starks/congressional-stock-trades](https://huggingface.co/datasets/austin-starks/congressional-stock-trades) on Hugging Face: House Clerk and Senate eFD periodic transaction reports | dataset commit SHA, `snapshot.json` time, each parquet file's SHA-256 (checked against `snapshot.json`) | Public records with a statutory use restriction (below) |
| `sec` | SEC `company_tickers_exchange.json` and the Financial Statement Data Sets (`sub.txt`, for SIC codes) | Last-Modified, SHA-256, quarters used | U.S. government work |
| `fec` | FEC bulk data (see `pipeline/fec/`) | per-file Last-Modified and SHA-256 | U.S. government work |
| `lda` | [LDA REST API](https://lda.gov/api/) (LD-203 contribution reports, LD-2 filings with covered positions); the Senate Office of Public Records cannot vouch for the data | posting cutoff dates and a SHA-256 manifest of cached slices | Public records; [LDA API terms](https://lda.gov/api/tos/) |

**Use restriction (from the trades dataset's LICENSE_DATA.md).** The trade data is derived from financial disclosure
reports made public by the Clerk of the House and the Secretary of the Senate. It is not under an open licence. Under
5 U.S.C. 13107(c) it is unlawful to obtain or use a covered report (1) for any unlawful purpose; (2) for any commercial
purpose, other than by news and communications media for dissemination to the general public; (3) for determining or
establishing the credit rating of any individual; or (4) directly or indirectly in the solicitation of money for any
political, charitable, or other purpose. This site is a free, non-commercial public information project and must stay
that way: no ads, no paid tiers, no fundraising, no credit uses. The pipeline never visits efdsearch.senate.gov and
never accepts a site's click-through terms; it only reads the published dataset.

**FEC sale-and-use restriction.** Under 52 U.S.C. 30111(a)(4), information copied from FEC reports may not be sold or
used to solicit contributions or for any commercial purpose (using the name and address of a political committee
to solicit contributions to it is allowed). The pipeline reads only committee-level files, never the individual
contributions file (`indiv`), and publishes no individual contributor; the notice is also in
`meta.json.sources.fec.licence`.

## Known limitations

- **House coverage starts in 2014.** The trade dataset's House filings begin 2014-01-02, so House trades from
  2012-2013 are mostly missing (a few appear because they were filed late). Coverage marks those years `none`.
- **Most House rows have no asset type.** House filings before about 2017, and many after, give no asset type code,
  so 69% of trades have `asset_class = "unknown"`. We do not infer classes from names. For `traded_together` only,
  an unlabelled trade counts when its ticker resolves to an SEC operating company (with a SIC code and not a fund or
  commodity pool).
- **Owner is often not stated** (26% of trades, mostly House). Those stay `unspecified`. They are never shown as the member's own trades.
- **Tickers come from the dataset.** About 45% are printed on the filing and 55% were resolved by the dataset from the
  asset name (`ticker_source`); 18% of trades have no ticker and get no org.
- **SEC matching uses today's tickers.** Delisted, merged and renamed companies (FB, CELG, ATVI, TWTR, ...) stay as
  `tk:` nodes. Symbols that now belong to a different issuer are vetoed. The veto also catches some renames of the
  same company (ATNI, UHAL, MD), which can be fixed in `org_overrides.csv`.
- **Amounts are ranges.** Sums keep lows and highs apart. An open-ended range ("over $1,000,000") or a missing amount
  makes the upper bound null.
- **Committees are current only.** `sits_with` reflects the current Congress. Historical assignments are not loaded.
- **Publication budget.** Not every money tie is published with its evidence (see the data dictionary). Every tie
  stays in `pipeline/build/`, and totals cover all of them.
- **Late flag.** `late` compares public availability with the transaction date (more than 45 days). The legal
  deadline runs from the notification date, so a few flagged trades may have been filed on time.
- **Memory.** Assembly holds every edge (without evidence) in memory: about 4.2 GB peak with the full FEC plug-in.
- **FEC totals are what givers reported.** They can differ from the recipient's own summary (weball) when the
  recipient amended its reports or never itemised a receipt; see `pipeline/fec/README.md` (Jordan 2020, Cruz 2018 and
  2022 are worked through there).
- **Party at the time.** `OrgSummary.split` and `org-index.json` count each tie year under the party of the member's
  term in that year; years outside every term go to the nearest term (counted in `meta.json.assembly.party_split`).
  `MemberSummary.party` and the wall stay the latest term's.
- **Validation runs after the swap.** `python -m pipeline.run` validates the tree it has just published, so after a
  failed validation `web/public/data/` holds the failed build until the next run (the daily workflow never commits
  it). Restore with `git checkout -- web/public/data` locally.
