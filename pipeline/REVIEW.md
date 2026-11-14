# Pipeline review, 2026-11-14

Scope: everything under `pipeline/`, `.github/workflows/data.yml`, `docs/data-dictionary.md`. Method: read every
module once; rebuilt the committed data from cache with the unchanged code (`PT_CACHE_ONLY=1`, pinned dataset
revisions) and compared SHA-256 manifests; queried the FEC DuckDB and the OpenFEC API for the two documented
anomalies; wrote a test for each fix. Line numbers refer to the code **before** this review (`git show HEAD:<path>`);
"now" names where the code lives after it.

Severity: **bug** = published output was wrong or the build was not reproducible; **risk** = could go wrong, or
weakens the method, without a current wrong number; **tidy** = readability, docs out of date.

## The two documented FEC anomalies (not pipeline bugs)

Both are differences between what givers reported (pas2, which we use) and the recipient's own summary (weball =
Form 3 line 11c, latest amendment). Checked against the OpenFEC `/committee/<id>/reports` and `/schedules/schedule_a`
endpoints for the recipient committees. Details and figures: `pipeline/fec/README.md`, "The weball comparison".

| Member-cycle | Ours | weball | Cause |
|---|---:|---:|---|
| Jim Jordan 2020 | $441,468 | $142,548 | In 2021 Jordan for Congress (C00416594) amended all 2019-20 reports; originals listed $418,576 from committees on line 11c, the amendments $142,548. Givers' reports were not amended. Ours is within 5.5% of the originals. One authorised committee; the JFC is excluded; no duplicates (re-reports removed by rule 4). |
| Ted Cruz 2022 | $90,080 | $68,080 | Recipient's itemised line 11C = $68,080.45 exactly. Residual = giver-reported rows the recipient never itemised: LANK PAC $10,000, Kansas Leadership PAC $10,000 (both `funds`), Apache PAC $2,500, PIA PAC $2,500. |
| Ted Cruz 2018 | $1,522,837 | $1,281,824 | Recipient's own itemised line 11C receipts total $1,463,824 (our pac_money: $1,471,837, +0.5%); its summary is $182,000 below its own itemisation. |

None of the candidate causes listed in the brief applies: no second authorised committee or leadership PAC is
counted as campaign money for these members, transaction dates fall in the cycle's two years, 24Z is $657 in total,
amended filings are already replaced in the bulk file and re-reports are removed, and JFC transfers are excluded as
givers. Not changed; documented, and the limitation is stated in `pipeline/README.md`.

## Findings, ranked

| # | Severity | Where (before) | What was wrong | How confirmed | Fixed |
|---|---|---|---|---|---|
| 1 | bug | `holdings/run.py:347` (asset text only street-address redacted) | Holdings files published beneficiaries' names, including minors': custodial accounts such as "Maverick Mast UTMA/FL", "f/b/o Taylor Rose Trott UTA", "FBO Isabella MacArthur", "Carmen G Scott UTMA". 1,762 asset rows. | `grep` over `web/public/data/holdings/*.json`; trades files have none (checked). | Yes: `holdings/rules.redact_beneficiary` (FBO / f/b/o / for the benefit of / custodian for + name; "First [Middle] Last" before UTMA/UGMA/UTA, not "UTA DTD"); holdings validator and `validate.py` (trade text) check it; tests. |
| 2 | bug | `holdings/run.py:558` (org label) | `other` orgs first seen in holdings were named after the whole account path: "Sara J Jacobs 1999 Trust ⇒ Merrill Lynch - SJ BP ⇒ DWS RREEF ...", "[street address redacted] Trust ⇒ ...". Personal trust names became organisation names in `orgs.json`, org files and member `nodes`. | Compared `orgs/*.jsonl` across plug-ins: 1,507 multi-file orgs with differing names; holdings-only names carry paths. | Yes: label = last path segment (the issuer). 4,136 holdings org rows renamed. |
| 3 | bug | `run.py:53` order + `holdings/run.py:392` | Holdings overlaps read the *previous* build's member files (the stage ran before `assemble`), so output depended on the last published tree and a rebuild was not a fixed point. | Rebuilding the committed inputs with the unchanged code changed 10 holdings files, only in `overlaps` (e.g. B000589 gains a 2013 pac_money overlap with co:36104). | Yes: new `holdings_publish` stage reruns holdings after `assemble` and updates `meta.reports.holdings`. |
| 4 | bug | `fec/download.py:45`, `data.yml:33-38` | FEC bulk files were never refetched once cached, and the workflow restores the cache every day, so FEC money froze at the date the cache was first saved (the SEC company file used for FEC company orgs likewise). | Code read; cached zips dated 2026-11-13 02:25 and `meta.sources.fec.revision` 2026-11-12 while the workflow "refreshed" on 11-14. | Yes: FEC uses the shared `util.fetch`; two latest cycles refetch after a day, older after a week, SEC/legislator fallbacks after a day. `PT_CACHE_ONLY=1` for reproducible rebuilds. |
| 5 | bug | `holdings/validate.py:139-141`; `lda/run.py` `write_sample` | The validators overwrote `docs/validation/holdings-sample.csv` (and, when LDA is on, `lda-sample.csv`) on every run, erasing people's `checked_by` / `matches_filing` entries. | Code read. | Yes: samples go to `pipeline/build/`; the docs copy is created only if absent. |
| 6 | bug | `holdings/run.py:246` (documents query without ORDER BY) | Report lists in `meta.json` (`reports.holdings.exclusions.*.docs`, `top_filers`) came out in a different order on identical runs. | Two runs on the same inputs differed in those keys only. | Yes: `ORDER BY f.doc_id`. |
| 7 | bug | `assemble.py:431` (`min(levels, ...)`) | For a year served in both chambers, trade coverage took the *stronger* chamber's level (money took the weaker). Edward Markey 2013 read `full` although the dataset has no House filings for 2013. | Unit test; scan of all member-years: one affected. | Yes: weaker level; dictionary updated. Changes `members/M000133.json`. |
| 8 | risk | `util.py:69-96` | `fetch` did not retry `ChunkedEncodingError` (a stream cut mid-body) and did not compare bytes received with Content-Length. | Code read; tests with a fake session. | Yes: retries every `RequestException`; a short body is retried and never cached. |
| 9 | risk | `companies.py:69` | Any 4xx from SEC (including 403 rate limiting) was taken as "quarter not published", silently reducing SIC codes and therefore `traded_together` eligibility. | Code read. | Yes: only 404 skips a quarter. |
| 10 | risk | `fec/load.py:102-106` | `strict_mode=false, null_padding=true`: an inserted or added FEC column would shift or be dropped silently; only rows = lines was asserted. | Code read; checked that delimiters = lines x (columns-1) holds for all 70 cached file-cycles. | Yes: that equality is now asserted when a file is loaded. |
| 11 | risk | `assemble.py` (all edges with evidence in memory), `edges_trades.py:107-126` (200 permutations in Python lists) | Peak RSS 5.91 GB (assemble); edges_trades alone 4.15 GB. | `resource.getrusage` per stage. | Yes: two-pass evidence (assemble 4.15 GB, output identical); permutations in batches of 25 (edges_trades 1.51 GB, output identical). |
| 12 | risk | `run.py:24-36` | With `PT_ENABLE_LDA` unset, `lda.*` plug-in files left by an earlier enabled run would still be merged, publishing lobbying ties while the stage is "off". | Code read (assembler merges every file in `edges/`). | Yes: "off" deletes them; test. |
| 13 | risk | `holdings/run.py:405-407` | Holdings files were written into the live `web/public/data/holdings/` after `rmtree` (readers could see it empty). | Code read. | Yes: written to `holdings.tmp/` and swapped. |
| 14 | risk | `data.yml` | Actions on moving tags; `contents: write` for the whole workflow; secrets in the job env (visible to `pip install` and tests); unused `FEC_API_KEY`; holdings validator not run. Concurrency, timeout, commit-only-data, no-change-no-commit and skip-commit-on-failure were already right. | Read; resolved tag SHAs with `git ls-remote`. | Yes: SHA-pinned, job-level write, secrets on the pipeline step only, `FEC_API_KEY` dropped, holdings validation step, step timeouts. |
| 15 | risk | `run.py:62-67` | Validation runs after `assemble` has swapped the new tree in, so a failed build stays in `web/public/data/` locally until the next run (CI never commits it). | Code read. | No (open question): validating the staging tree before the swap needs `validate.py` to take a root; documented in Known limitations. |
| 16 | risk | `edges_trades.py:166` | `traded_together` keep rule `(tickers >= 3 or obs >= 5) and obs >= 5` reduces to `obs >= 5`: the 3-tickers clause only sets `weak`, so a pair trading one ticker five times is drawn (weak). Matches the contract's wording literally. | Read; constants equal. | No (owner decision): noted in the module docstring. |
| 17 | risk | `fec/build.py:369` | Outside-spending evidence labels name the payee ("paid to ..."), which for some independent expenditures is an individual (canvasser, consultant). Not a donor and not an address, but a private person's name. | 314,093 of 886,438 non-memo IE rows in pas2 (35%) carry `ENTITY_TP = IND` (21,040 names; some are firms keyed as IND); published labels contain 23,171 "paid to" phrases. | No (open question). |
| 18 | risk | `assemble.py:291-304`, `org_index` | Party split and org index count a member under the latest term's party for all years (Van Drew, Sinema, Manchin). Documented in the contract. | Read. | No (documented). |
| 19 | tidy | `assemble.py:102-111` | `merge_edges` ranks merged evidence by date only, not size then date like `top_evidence`. Inert today: no plug-in emits duplicate keys (`edges_after_merge` = sum of `edges_read`). | meta.assembly. | No; documented in `assemble/plugins.py`. |
| 20 | tidy | `README.md`, data dictionary | Docs out of date: overrides "without a reviewer is an error" (they are ignored); org merge "first non-null field wins" (the later file's name wins); holdings "runs after assemble" (it ran before); constants "at the top of assemble.py"; `docs/validation/README.md` said `validate` writes `trade-sample.csv`; no type for `meta.json`. | Read against code. | Yes. |
| 21 | tidy | `fec/download.py`, `fec/refs.py:30-63`, `fec/run.py:37-49`, `lda/run.py:34-42`, four CSV readers of the override file | Per-module copies of the HTTP helper, name normalisation (with an import-time self-test to detect drift), EDGAR name cleaning, JSON-lines writers (LDA's was unsorted and non-atomic) and override parsing. | Read. | Yes: one implementation each in `util.py`. |
| 22 | tidy | `validate.py` | Not checked: the Case rule itself, cases per member vs counts, by_year order, the per-member money cap, meta counts vs files. | Read. | Yes: added (12.05 M checks, was 11.79 M). |

Privacy and law, otherwise: no stage reads the FEC individual-contributions file or emits a contributor; street
addresses and residences are removed from holdings (existing rules, validated); 5 U.S.C. 13107(c) is in
`pipeline/README.md`, `meta.sources.hf_trades.licence` and the holdings source licence; the FEC sale-and-use notice
(52 U.S.C. 30111(a)(4)) is in `meta.sources.fec.licence` and is now also in `pipeline/README.md`.

## Output changes in this review

All explained by findings 1, 2, 3 and 7; every other file is byte-identical to a rebuild with the old code.
Compared with a rebuild by the old code on the same cached inputs (that rebuild itself already differs from the
committed tree in 10 holdings files and `holdings-index.json`, finding 3):

| Files | Change | Finding |
|---|---|---|
| `holdings/<id>.json` (17) | beneficiary names redacted in asset text and portfolio names | 1 |
| `orgs.json`, all 256 `orgs/<shard>.json` | 2,811 `other` org names (holdings-only `tk:` nodes) are now the issuer, not the account path; 2,757 of them contained a `⇒` path | 2 |
| `members/<id>.json` (425) | `nodes[...].name` of those orgs only | 2 |
| `members/M001193.json`, `members/M001199.json` | `owns` evidence `record` lists the first 5 rows of a report year in value-then-text order; redacted text reorders ties | 1 |
| `members/M000133.json` | coverage 2013 trades `full` -> `none` | 7 |
| `holdings/<id>.json` (11 vs the committed tree), `holdings-index.json` | overlaps now computed against this build's member files | 3 |
| `meta.json` | build time, commit, holdings report (redaction counter, overlap counts, order of lists) | 1, 3, 6 |

`org-index.json`, `wall.json`, `wall-years.json`, `cases.json`, `member-ties.json`, `board.json`, `members.json`,
every `trades/<id>.json` and the other 1,143 member files are byte-identical. Against the committed tree: 712 files
changed (27 holdings files, `holdings-index.json`, 426 member files, `orgs.json`, 256 org shards, `meta.json`). Validation: 12,053,968 checks, 0
failures (the old validator's 11,786,569 checks also pass); holdings validator 0 failures.

## Open questions for the owner

1. Validate the staging tree before the swap (finding 15)? It costs a `validate.py` refactor to take a root folder.
2. Should the `traded_together` rule require 3 distinct tickers to draw an edge, not only to mark it strong (16)?
3. Outside-spending payees who are individuals (17): keep, or replace with "an individual payee"?
4. Party split by party at the time of each tie instead of the latest party (18)?
5. The beneficiary rule also removes adults' names (spouses, the member) after FBO; acceptable?
