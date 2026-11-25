# Data pipeline

Builds the JSON the site reads (written to `web/public/data/`, published to Cloudflare R2; not stored in git) out of
filed public records: the member list, household
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
pipeline/.venv/bin/python -m pipeline.publish_r2 --verify    # upload web/public/data to R2 (skips without R2_* vars;
                                                             # --require or PT_R2_REQUIRED=1 makes that an error)
```

Run from the repository root. Downloads are cached in `pipeline/.cache/`; intermediate files go to `pipeline/build/`;
the output goes to `web/public/data/` (all three gitignored). A clean checkout needs none of them: no stage reads a
previous build (the holdings overlaps are computed in the second holdings pass, against this build's member files),
so a run from the download cache alone reproduces the published tree byte for byte except `meta.json`'s build time,
commit and retrieval times. To get the published data without running the pipeline, point the site at the bucket
(`web/README.md`, "Data modes"). Environment variables, all optional:

| Variable | Effect |
|---|---|
| `SEC_USER_AGENT` | User-Agent for every request (default `congressional-trading-map-class-project research@example.org`) |
| `HF_REVISION`, `HF_HOLDINGS_REVISION` | pin the trades / holdings datasets to a commit (default: their current commit) |
| `PT_CACHE_ONLY=1` | reuse every cached download regardless of age (reproducible rebuilds, offline work) |
| `PT_OUT_DIR` | publish somewhere other than `web/public/data/` (dry runs, comparisons) |
| `PT_ENABLE_LDA=1`, `LDA_API_KEY` | switch the lobbying stage on (off by default; "off" also removes stale `lda.*` plug-in files) |
| `FEC_API_KEY` | OpenFEC key (the repository secret in the daily job): exact leadership-PAC sponsors and FEC purpose groups, 269 requests on a cold cache (about 5 min), about 58 on a normal day, about 270 once a week; absent or failing, both are skipped with a warning |
| `PT_ENABLE_CONGRESS=1`, `CONGRESS_API_KEY` | switch the Congress.gov sponsorship pilot on (off by default; unpublished, see "Congress.gov pilot") |

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
| `trades` | `trades.py`, `trade_amendments.py` | HF `austin-starks/congressional-stock-trades` (by commit) | `trades.parquet`, `sources/hf_trades.json` | 5 s | 1.2 GB |
| `companies` | `companies.py`, `sic.py` | SEC tickers (daily), FSDS `sub.txt`, `trades.parquet`, overrides | `ticker_orgs.json`, `companies.json`, `company_names.json`, `sources/sec.json` | 1 s | 1.2 GB |
| `fec` | `fec/` | FEC bulk files (see its README), `spine.json`, `company_names.json`, overrides | `edges/fec_*.jsonl`, `orgs/fec.jsonl`, `sources/fec.json`, `campaign_finance.json`, `sources/fec_spending.json` | 162 s (+ about 5 s per cycle for spending, not yet measured in a full run) | 1.9 GB |
| `edges_trades` | `edges_trades.py` | `trades.parquet`, `ticker_orgs.json`, `companies.json` | `trades_resolved.parquet`, `edges/trades.jsonl`, `orgs/trades.jsonl` | 23 s | 1.5 GB |
| `edges_committees` | `edges_committees.py` | `committees.json` | `edges/committees.jsonl` | 1 s | |
| `lda` | `lda/` | LDA API pages (off unless `PT_ENABLE_LDA=1`) | `edges/lda.jsonl`, `orgs/lda.jsonl`, `sources/lda.json` | 0 s | |
| `congress` | `congress/` | cached Congress.gov pages (off unless `PT_ENABLE_CONGRESS=1`) | `build/congress/` only (no plug-in file) | 0 s | |
| `holdings` | `holdings/` | HF `ZipLime/congress-trading` (by commit), build files | `web/public/data/holdings/`, `holdings-index.json`, `edges/holdings_owns.jsonl`, `orgs/holdings.jsonl`, `sources/holdings.json`, `holdings_rows.json` | 21-23 s | 1.7 GB |
| `assemble` | `assemble/` | every plug-in file, `trades_resolved.parquet` | every other file in `web/public/data/` (staging dir, then swap) | 84 s | 4.2 GB |
| `holdings_publish` | `run.py` | the newly published member files | the holdings files again, with this build's overlaps; `meta.json.reports.holdings` | 21-23 s | |
| `validate` | `validate.py` | `web/public/data/`, `trades*.parquet` | `validation_sample.csv` | 13 s | |

`delays.json` (disclosure timing) is written by the `assemble` stage from `assemble/delays.py`, from the same current-version
trade rows as `trades/<id>.json`; `validate.py` calls `validate_delays.py`, which re-derives it from the published trade
files. Contract: data dictionary, "Disclosure timing"; audit: `docs/validation/disclosure-timing-audit.md`. House reprints marked Amended or Deleted are folded into the trade they restate by `trade_amendments.py` (exact signals only; counts in `meta.json`), checked by `validate_trade_amendments.py`.

Whole run: 322-332 s, peak 4.3 GB (before this review: 294 s, 5.9 GB).

## Code layout

```
pipeline/
  run.py              stage list and order; `python -m pipeline.run`
  config.py           every tunable constant (caps, thresholds, windows, case rule, budget); echoed in meta.json
  contract.py         contract shapes: TypedDicts (Edge, Evidence, Case, Trade, ...), column lists, edge families
  util.py             paths, cached HTTP with retry, deterministic JSON, override file, name/ticker normalisation
  edges.py            range arithmetic (sum_amounts), by_year, evidence ranking, edge ids
  spine.py trades.py trade_amendments.py companies.py sic.py edges_trades.py edges_committees.py    core sources and edges
  fec/                download -> load (parse) -> refs (identities) -> build (rules, edges, orgs; conduits = the reviewed conduit lists) -> run (write, checks; crosscheck = weball);
                      spending + spending_oppexp + receipts + purposes_api + sponsors_api + totals_api (-> campaign_finance.json)
  holdings/           source (download) -> run (parse, resolve, emit) -> rules + address_rules (redaction) -> validate (+ address_check gate)
  lda/                download -> build (parse) -> match (identities) -> edges -> run (write, checks); off by default
  congress/           download -> facts (parse, exact ids) -> run (fact table, review sample); off by default, unpublished
  assemble/           plugins (load, merge) cases budget orgs wall members publish, run (the orchestrator)
  validate.py         output checks (+ validate_delays, validate_trade_amendments, validate_fec_spending/_receipts/_totals/_conduits)
  publish_r2.py       upload web/public/data to Cloudflare R2 (changed files only); run by the daily workflow
  publish_release.py  opt-in content-addressed archive (release_blobs, release_refs, release_history, release_store,
                      release_manifest, release_provider_check, release_repair, withdraw_release); served by worker/
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

## Congress.gov pilot (off, unreviewed, unpublished)

`pipeline/congress/` tests a bills source on five hand-listed current members before any bulk ingestion. With
`PT_ENABLE_CONGRESS=1` set, `python -m pipeline.congress.run --download --sample` fetches their sponsored and cosponsored
legislation from the Congress.gov API (about 40 requests, cached raw under `pipeline/.cache/congress/`), writes a
member -> bill fact table and `report.json` to `pipeline/build/congress/`, and a review CSV that is copied to
`docs/validation/congress-sample.csv` once, with empty reviewer columns. Without the variable it prints one line and does
nothing; the `congress` stage in `run.py` is then a no-op, and even when enabled it reads the cache only and writes no
file the assembler reads, so nothing reaches `web/public/data`. Members are matched by exact bioguide id only. No human
has reviewed the sample. Contract: data dictionary, "Congress.gov bill sponsorship pilot". Survey of the other
candidate sources: `docs/SOURCE-EXPANSION.md`.

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
filled in by people and are never overwritten (see `docs/validation/README.md`). Validation re-reads the trades source
from the download cache, so `--stage validate` alone needs the cache the build used (the daily job runs both in one step).

## Daily workflow

`.github/workflows/data.yml` runs daily (07:41 UTC) and on manual dispatch, one run at a time per branch:
unit tests -> `python -m pipeline.run` (every stage, then `validate.py`) -> `python -m pipeline.holdings.validate
--no-pdf` -> `python -m pipeline.publish_r2 --verify` (upload, then check that the public URL serves the new
`meta.json` build time). It commits nothing: the job has only `contents: read`, and checkout keeps no credentials.
Each step runs only when every earlier one succeeded, so a build that failed a test, a stage or either validator is
never published; the failing step exits non-zero with its reason in the log, a final step adds an error annotation,
and GitHub emails the owner. On the default branch of the main repository the workflow sets `PT_R2_REQUIRED=1`, so
missing R2 secrets fail the publish step (exit 2) instead of skipping it; forks and other branches skip the upload.
Actions are pinned to commit SHAs; each secret is given only to the step that needs it (the pipeline step: `LDA_API_KEY`,
`FEC_API_KEY`, `SEC_USER_AGENT`; the publish step: the `R2_*` secrets) and never printed. Downloads are cached between runs
(`pipeline/.cache`), each source refetching on its own schedule, so the cache never freezes data; the run needs no previous build.

After the legacy publish step, a step "Warm the site cache" (`scripts/ops/warm_cache.py`, repository variable `SITE_URL`;
skipped when unset; never fails the job) requests the main pages and the 10 members with the most trades. Then an opt-in step "Archive immutable release" runs `python -m pipeline.publish_release
--dir web/public/data --activate`. It runs only when the repository variable `PT_PUBLISH_RELEASES` is exactly `1`
and only on the default branch of the main repository; the R2 secrets are passed to that step alone. It is off by
default. If it fails, the legacy data is already published and unaffected. Activation order, rollback and
withdrawal: [`docs/RELEASE-OPERATIONS.md`](../docs/RELEASE-OPERATIONS.md). A separate manual workflow,
`.github/workflows/release-staging.yml` (`workflow_dispatch`, default branch only), runs the provider check or a
rollback to a named release.

Manual dispatch has one input, `cache_only` (boolean, default off): the same run with `PT_CACHE_ONLY=1`, so the tree
is rebuilt from the restored download cache with no downloads, then validated and published (about 5 minutes of
pipeline). Use it to re-sync the bucket by hand (Actions tab -> "Daily data refresh" -> "Run workflow"; or
`gh workflow run data.yml -f cache_only=true`).

## Publishing to R2

The next release architecture and acceptance gates are in [`docs/PRODUCT-PLAN.md`](../docs/PRODUCT-PLAN.md).
The current uploader below still uses mutable URLs; publishing `meta.json` last is a completion marker, not
atomic multi-file isolation. Clients can observe mixed versions during an upload or through independent caches.

For the offline release descriptor foundation, after validating a generated data tree:

```bash
python -m pipeline.release_manifest --dir web/public/data --output /tmp/paper-trail-release.json
python -m pytest -q pipeline/tests/test_release_manifest.py
```

This command hashes the tree without modifying it and writes a deterministic descriptor outside it. It needs no
credentials and performs no uploads. It does not validate source accuracy, sign data, archive a build, or provide
permanent citation URLs. The exact format and reserved paths are in the data dictionary. Keep the input tree
unchanged while generating a descriptor. Archive publication is opt-in below; release-pinned readers and
production cutover remain gated by the product plan.

### Optional immutable archive publisher

After the full data/privacy validators pass, the separate publisher stores each distinct file once as
`releases/blobs/<sha256>` and writes the release descriptor `releases/<release_id>/release.json` after every blob is
verified, outside the legacy uploader's cleanup scope. Only changed files are uploaded each day:

```bash
python -m pipeline.publish_release --dir web/public/data
python -m pipeline.publish_release --dir web/public/data --activate --measure
python -m pipeline.publish_release --release <existing-release-id> --activate [--full-verify]
```

`--measure` prints files, blobs new/reused, new bytes and total archive bytes (one listing of `releases/blobs/`), the
real storage-growth figure. With `--activate`, a tree whose files other than `meta.json` equal the current release's
creates no release and leaves the pointer alone ("no data change; release <id> stays current", exit 0). New blobs
are read back and hashed; reused blobs and rollback targets are checked by HEAD (existence and size), plus a full read
of `meta.json`; `--full-verify` hashes every blob. The Worker in `worker/` serves the archive to the site.

The first command stages and verifies the release without changing `releases/current.json`. Activation updates
that single pointer only after verification and only if its captured ETag still matches (or it is still absent).
The third command verifies an existing release before promoting it or rolling back to it. All commands require
the same four R2 credentials as the legacy publisher; there is no silent credential skip. Neither publish command deletes
archives or overwrites a conflicting immutable object. Interrupted uploads can be rerun; matching objects are
read and reused without retransmitting their bodies. The descriptor is the final immutable object written.

Successful activation also maintains the mutable history list `releases/index.json` (newest first, one entry per
release, at most 10,000 as a safety bound (the site only serves permalinks for listed releases), written with the same conditional discipline as the pointer; shape in the data dictionary).
The pointer stays the only authority. If the index update fails after the pointer moved, the command exits 1 and
says that the pointer WAS activated; re-running the same command repairs the index and is idempotent.

Two more commands, both using the same `R2_*` variables:

```bash
python -m pipeline.release_provider_check
python -m pipeline.withdraw_release --release <id> --reason privacy|legal|other --confirm <id> \
    [--exposed-path <file in the release> ...] [--also-withdraw <id> ...]
```

`release_provider_check` verifies, under a disposable `release-provider-check/<random id>/` prefix, that the
provider rejects a second `If-None-Match: *` create and a stale `If-Match`, and round-trips `Content-Type`,
`Cache-Control` and bytes, and that HEAD and prefix listings report exact sizes and deleting a missing key succeeds; it deletes only the keys it created, prints PASS/FAIL per check, and exits 0 only when
all pass (2 when configuration is missing). `withdraw_release` is for discovered privacy or legal exposure only: it
refuses the current release, writes the tombstone `releases/withdrawn/<id>.json`, deletes the blobs no other live
release references and the descriptor, and removes the index entry. Blobs are shared between releases: bytes that
hold the exposed data and are shared make those releases exposed too, so the command lists them and refuses unless
`--also-withdraw` names them all (`--exposed-path` narrows what counts as exposed). Re-running finishes an
interrupted withdrawal; `publish_release` refuses withdrawn releases. It is the only command that deletes archive
objects.

The daily workflow's archive step is gated off by default, and its commands have been exercised against fake S3,
not the production provider. Before enabling `PT_PUBLISH_RELEASES`, run the provider check and follow the
activation checklist in `docs/RELEASE-OPERATIONS.md`; release-pinned readers must be deployed before the site
reads the archive. Tests: `python -m pytest -q pipeline/tests/test_release_manifest.py pipeline/tests/test_publish_release.py
pipeline/tests/test_release_blobs.py pipeline/tests/test_release_history.py pipeline/tests/test_withdraw_release.py
pipeline/tests/test_release_provider_check.py`; the Worker: `node --test worker/test`; the ops scripts:
`python -m pytest -q scripts/ops` (cache warming after the legacy publish via the repository variable `SITE_URL`, and
the 6-hourly freshness alert `.github/workflows/freshness.yml`).

The bucket is where the data lives: the production site reads it (`DATA_BASE_URL`), and `web/public/data/` is not
in git. Public base URL: `https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data`. `pipeline/publish_r2.py` uploads the tree to Cloudflare R2 through the S3-compatible API
(boto3, region `auto`, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`) under the key prefix `data/`, so
`web/public/data/members/A000001.json` becomes `<R2_PUBLIC_URL>/data/members/A000001.json`.

| GitHub secret | Use |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id (only in the endpoint host) |
| `R2_BUCKET` | bucket name |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | an R2 API token with object read and write on that bucket |
| `R2_PUBLIC_URL` | public base URL of the bucket (custom domain or r2.dev), used only to verify the upload |

Without the first four the script prints "R2 upload skipped" and exits 0 (local runs, forks); with `--require` (or
`PT_R2_REQUIRED=1`, set by the workflow on the default branch) it prints "R2 publish FAILED" and exits 2, as it does
when `--verify` is asked for without `R2_PUBLIC_URL`. What it does:

1. Hashes every file (path -> SHA-256) and reads the previous manifest `data/_manifest.json`
   (`{build_time, prefix, cache_control, files: {path: sha256}}`); when it is missing, unreadable, or has a different cache policy, every file is uploaded.
2. Uploads only files whose hash changed (16 at a time, each retried on network errors, 429 and 5xx), as plain JSON
   with `Content-Type: application/json` and `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` (the
   same URLs are overwritten daily). No gzip and no Content-Encoding: plain JSON objects (Cloudflare can compress
   responses on a custom domain; that is not relied on).
3. Uploads `meta.json` after every other data file, then the new manifest. Its `build.time` marks completed
   data-file uploads; it does not isolate readers from partial uploads or independently cached versions.
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
  liability-type text become `[street address redacted]`, rules and build gate in `docs/privacy-redaction.md`) and personal residences (rows that name a personal
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
| `fec_spending` | FEC `weball` (loans) and `oppexp` (leadership PAC operating expenditures, streamed); see `pipeline/fec/README.md` | per-file Last-Modified and SHA-256 (listed under `fec`) | U.S. government work |
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
- **Late flag.** `late` compares the trade's first public availability with the transaction date (more than 45 days). The legal
  deadline runs from the notification date, so a few flagged trades may have been filed on time. A House row marked Amended that changes a key field (date, owner, action, amount, asset) cannot be tied to its original exactly: both stay, and the amended one's lag is withheld (`TradeFile.lag_withheld`, delays bucket `amended_unmatched`). A trade a later House filing marks Deleted stays listed but is counted nowhere (`TradeFile.not_counted`).
- **Memory.** Assembly holds every edge (without evidence) in memory: about 4.2 GB peak with the full FEC plug-in.
- **Campaign finance block.** `MemberFile.campaign_finance` (loans as the FEC summarises them, leadership PAC spending
  by FEC category and by the FEC's purpose groups) comes from `pipeline/fec/spending.py` in the `fec` stage and writes
  `build/campaign_finance.json`; the assembler copies each member's block (null when absent) and `pipeline/validate_fec_spending.py`
  checks it (no payee or address text; only aggregates are read). The OpenFEC parts need `FEC_API_KEY` (see `pipeline/fec/README.md`).
- **FEC totals are what givers reported.** They can differ from the recipient's own summary (weball line 11c): amended recipient reports, a December check received in January, refunds the giver nets. `docs/fec-conduits.md` works through Jordan 2020 and Cruz 2018 and 2022 and replaces the older paragraphs in `pipeline/fec/README.md`.
- **Conduit PACs.** The 24K rows of the PACs listed by exact id and cycle in `fec/conduits.py` (they forward contributions earmarked by individuals) are not counted, their own direct gifts included; a conduit not yet on the list still counts as PAC money (`build/fec_conduit_review.json` lists candidates; counts in `meta.json.reports.fec.conduit_review`).
- **24G rows.** A contribution the giver coded 24G (transfer to an affiliated committee) is not in pas2, so it is never seen (AFSCME to Pelosi, 2005-10-27, $5,000).
- **Party at the time.** `OrgSummary.split` and `org-index.json` count each tie year under the party of the member's
  term in that year; years outside every term go to the nearest term (counted in `meta.json.assembly.party_split`).
  `MemberSummary.party` and the wall stay the latest term's.
- **Validation runs after the swap.** `python -m pipeline.run` validates the tree it has just published, so after a
  failed validation `web/public/data/` holds the failed build until the next run (the daily workflow never publishes
  it). There is no copy in git to restore from: fix and rerun, or run the site against the published data
  (`DATA_BASE_URL`, see `web/README.md`).

## Financial history derived from annual reports

`holdings/positions.py` joins annual asset rows to the published household trades;
`profile.py` derives first/latest disclosed range change and debt history, using
`ranges.py` for the same unknown/open-ended band rules. `holdings_publish` rebuilds
these after assembly so the timelines use this run's trades. The extra public files
are `holdings/positions/<id>.json`; summaries, change and leverage are in each
`holdings/<id>.json` and selected summary columns in `holdings-index.json`.
See the [contract](../docs/data-dictionary.md#position-timelines) before editing.
`python -m pipeline.holdings.validate` invokes `validate_positions.py` to check the
annual row partition, trade identity, complete transition set, citations, summaries
and derived financial profile; run it in addition to `python -m pipeline.validate`.
It writes `pipeline/build/timeline-sample.csv` for human review without overwriting
an existing reviewed sample in `docs/validation/`.
