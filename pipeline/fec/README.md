# pipeline/fec: committee-level campaign finance

Builds the money edges `pac_money`, `outside_spending`, `funds` and `fundraises_with` from FEC bulk
data, following the "Intermediate plug-in format" in `docs/data-dictionary.md`.

```
python -m pipeline.fec.run                      # all cycles 2000-2026, about 3 minutes once cached
python -m pipeline.fec.run --cycles 2022,2024   # quick test
python -m pipeline.fec.run --min-total 5000     # optional size threshold (see "Output size")
python -m pipeline.fec.run --no-shared          # ignore spine.json / company_names.json, use upstream fallbacks
python -m pipeline.fec.run --out-dir /tmp/x     # write outputs somewhere else (for tests)
```

Needs `duckdb` (2.x) and network access to www.fec.gov (redirects to an S3 bucket),
unitedstates.github.io and www.sec.gov (fallbacks only). Peak memory is about 1.9 GB (DuckDB is capped at 1.5 GB).

Shape (the same as every source module): `download.py` (cache; files of the two latest cycles are refetched after a
day, older cycles after a week, `PT_CACHE_ONLY=1` reuses the cache) -> `load.py` (parse into DuckDB; rows = lines and
delimiters = lines x (columns - 1) are asserted, so an upstream column change stops the run) -> `refs.py` and
`build.prepare_reference_tables` / `build.resolve_orgs` (identities) -> `build.classify_rows` (one rule per row) ->
`build.aggregate` / `build.fundraises_with` / `build.org_records` (plug-in files, written by `run.py`) -> the
self-checks and the weball comparison in `run.py`. HTTP, JSON writing, name normalisation and the override file
use the shared helpers in `pipeline/util.py`.

Outputs:

| File | Contents |
|---|---|
| `pipeline/build/edges/fec_pac_money.jsonl` | org -> member |
| `pipeline/build/edges/fec_outside_spending.jsonl` | org -> member, support and oppose kept apart |
| `pipeline/build/edges/fec_funds.jsonl` | member -> member |
| `pipeline/build/edges/fec_fundraises_with.jsonl` | member <-> member |
| `pipeline/build/orgs/fec.jsonl` | an OrgSummary (without `degree`) for every org endpoint above, `pac:` and `co:` |
| `pipeline/build/sources/fec.json` | source metadata (`fec`) plus the full audit report |
| `pipeline/.cache/fec/` | downloads (with `.meta.json` sidecars: url, retrieved, Last-Modified, sha256), extracted text, `fec.duckdb` |

Output is deterministic: two full runs give byte-identical files. Lines are key-sorted JSON, ordered
by recipient member id and then by edge key (`fundraises_with` and orgs are fully sorted).

## Sources

| File | URL pattern | Cycles available (checked 2026-11-13) |
|---|---|---|
| Candidate master `cn` | `https://www.fec.gov/files/bulk-downloads/{YYYY}/cn{YY}.zip` | every even year 2000-2026 |
| Committee master `cm` | `.../cm{YY}.zip` | 2000-2026 |
| Candidate-committee linkage `ccl` | `.../ccl{YY}.zip` | 2000-2026 |
| Contributions from committees to candidates and independent expenditures `pas2` | `.../pas2{YY}.zip` (member `itpas2.txt`) | 2000-2026 |
| All-candidates summary `weball` (sanity check, the loans in `spending.py` and the per-cycle receipts in `receipts.py`: `docs/campaign-receipts.md`) | `.../weball{YY}.zip` | 2000-2026 |
| Operating expenditures `oppexp` (streamed, leadership PACs only) | `.../oppexp{YY}.zip` (member `oppexp.txt`, 25 columns) | 2004-2026 (2000 and 2002 answer 404); 50-65 MB each, 430 MB unpacked for 2024 |
| Leadership PACs and sponsors | `https://www.fec.gov/files/bulk-downloads/data.fec.gov/leadership{YYYY}.csv` | 2010-2026 only (404 before 2010) |
| Members (fallback) | congress-legislators `legislators-current.json`, `legislators-historical.json` | |
| Company names (fallback) and company org records | `https://www.sec.gov/files/company_tickers.json` | |

Column lists are taken from the FEC header files (`data_dictionaries/<name>_header_file.csv`) and hard-coded in
`load.py`. Every file is read as text with no quoting; each load asserts rows parsed = lines in the file (it held
for all 70 file-cycles). All files decoded as UTF-8.

Not used: individual contributions (`indiv`, which is very large and carries the sale-and-use restriction) and the
`oth` any-transaction file. The only API calls are the two OpenFEC listings below (leadership-PAC sponsors and purpose
groups); without `FEC_API_KEY` they are skipped and everything else is built from the bulk files.

Members come from `pipeline/build/spine.json` when it exists; otherwise from congress-legislators with the same rule
(any term ending on or after 2000-01-01). Candidate id -> bioguide comes from the `fec` id lists; an id claimed by two
people would be dropped (none are). Company names come from `pipeline/build/company_names.json` when it exists;
otherwise SEC names normalised with the contract rule (`refs.normalise_name`, the same as `pipeline/util.py`, with a
self-test that fails if they diverge), keeping only unique names. Both paths give the same counts
(1,569 members, 1,738 candidate ids, 7,982 unique company names).

## Rules, in the order they are applied to each pas2 row

Every pas2 row gets exactly one label in `p_rules`. The audit below is a group-by over that table, so the rows add up.

1. **Transaction type.** Contributions: `24K` (contribution to a nonaffiliated committee), `24Z` (in-kind),
   `24P` (to a possible federal candidate). Support: `24E` (independent expenditure for), `24F` (Form 7
   communication cost for). Oppose: `24A`, `24N`. Out of scope: `24C` coordinated party expenditure (neither a
   contribution nor independent), `24H` honorarium, `24R` recount.
2. **Memo items (`MEMO_CD = X`) dropped.** In pas2 these are re-statements of entries already reported
   ("AS DISCLOSED IN MAY MONTHLY", redesignations), sub-itemisations, or unpaid IE obligations reported again
   when paid. Counting them would double count. This goes against the FEC's general advice to include memo items,
   which is about receipts files. The dollars dropped are in the audit.
3. **Amount and date.** The amount must parse. The date is the transaction date; when that is missing (mostly
   IEs) and the 18-digit image number gives a filing date (YYYYMMDD), that date is used instead, the evidence label
   says so, and the edge gets `weak: true` (1,214 outside_spending and 9 pac_money edges). Rows with no date at all,
   or dates before 1997 or after the run date, are dropped.
4. **Duplicates.** The same filer, type, election (PGI), transaction id (or, for paper rows without one, the same
   image page), date, amount, recipient and candidate appearing more than once is a re-report. The row from the
   latest filing (highest `FILE_NUM`) is kept. Most of these are in 2016 (one filer, C90011156, re-reported its whole
   Q3 in its year-end report). Amendments: the bulk file already carries only the current version of each report
   (`AMNDT_IND` A rows replace the originals), so no other amendment logic is needed.
5. **Amount equals the recipient's committee id** (≥ $10,000): a data-entry error, for example Coats's committee
   "gave" Todd Young $459,255 to committee C00459255 (memo: 2000.00). Dropped.
6. **Earmarked or conduit money.** Rows from WinRed, ActBlue or Democracy Engine, and any row whose memo contains
   "EARMARK", are individuals' money passed through (`drop:earmarked_via_conduit`). Separately, every 24K row of the
   PACs listed by exact id in `conduits.py`, in the cycle files listed for each, is `drop:conduit_pass_through`: they
   forward contributions earmarked by individuals as plain 24K rows. Their own direct gifts in those cycles are
   dropped with them. Ids, evidence and counts: `docs/fec-conduits.md`. Single rows above $10,000 that were read
   against the giver's and the recipient's filings and shown to be paid elsewhere, voided or forwarded are dropped by
   exact `SUB_ID` (`reviewed_rows.py`, `drop:reviewed_not_received`; `docs/fec-reviewed-rows.md`).
7. **Recipient.** A contribution counts only if `OTHER_ID` is an authorised campaign committee of a member: designation
   P or A in the linkage file, or in the committee master with a candidate id. If `OTHER_ID` is blank, the row's
   `CAND_ID` is used. Contributions to JFCs, leadership PACs, parties and unknown committees are dropped, each
   under its own reason. If `CAND_ID` names a different member than the recipient committee, the row is dropped as a
   conflict. Three committees linked to more than one member are not used as recipients (listed in the report).
   No restriction to years in office: money to a member's committee before they took office still counts.
8. **Giver.**
   - The member's own committees (campaign or leadership PAC) giving to the member: dropped as `own_committee_transfer`.
   - A JFC (designation J) as giver: dropped. These are distributions of individual money.
   - A member's authorised committee, or a leadership PAC with a known sponsor: `funds`. `via` names the giving committee.
   - Any other candidate's committee: dropped.
   - Everything else: `pac_money`.
   - IEs whose `CAND_ID` is not a member: dropped.

**Leadership-PAC sponsors** come only from filed sources:
- OpenFEC `sponsor_candidate_ids` (`sponsors_api.py`, `fec_api_sponsor_id`): an exact candidate id equal to one of the member's;
- linkage or committee-master rows with designation D that carry a candidate id (`fec_candidate_id`, 26 committees);
- the leadership-PAC file (2010 onward), whose sponsor field is a name only (`leadership_file_exact_name`, 460 committees).
  A name is accepted only if, with punctuation removed, it equals the FEC candidate-master name of candidates who all map
  to one member. No fuzzy matching. 54 ambiguous names and 1,098 unmatched (committee, sponsor) rows are listed (many are governors or non-members).

`leadership.py` combines them: methods that agree are joined (`+`, sorted). API ids naming two members: API link dropped.
API vs name file disagree: the API wins and the row is listed in `name_file_overridden_by_api`. API vs a candidate id disagree,
or no API row and the sources disagree: committee dropped (`conflicting_sources_dropped`). Funds edges through a leadership PAC carry
`note: "via leadership PAC"`. Before 2010 a leadership PAC counts as a member's only with a filed candidate id or an OpenFEC sponsor id.

**Org identity** (pac_money and outside_spending payers). An override row (`pipeline/crosswalk/org_overrides.csv`,
`source` = fec / fec_committee / fec_connected_org, keyed by committee id or connected-org name, with `reviewed_by`
set) wins. Otherwise the normalised `CONNECTED_ORG_NM` is looked up exactly in the company index; for Form 7 filers
(type C) the committee name is tried too. On a match, `from` is `co:<cik>` and `via` is the PAC. If nothing
matches, `from` is `pac:<id>` and kind is chosen from the committee type: X/Y/Z party; O/U super_pac;
N/Q/V/W pac; anything else, or a committee missing from every loaded committee master, other.

**Support and oppose** are kept apart by `via`: `{id: "pac:<spender>:support" | "pac:<spender>:oppose", name:
"<spender>, supporting|opposing"}`, plus `note` = support / oppose. The assembler keys on type/from/to/via, so the two
never merge, even when `from` is a company.

**Aggregation.** One edge per (type, from, to, via, direction). `amount.exact` = low = high = the net sum (refunds
and voids, which are negative 24K rows, are netted). `count` = number of rows, including negatives. `by_year` is by
calendar year of the transaction date and sums exactly to the totals; the run asserts this. Evidence is up to 5
positive rows, largest first, with an image link (`https://docquery.fec.gov/cgi-bin/fecimg/?<image>`) or the
committee page, and `record` = the FEC transaction id (the `SUB_ID` for paper rows that have none).
Edges whose net is ≤ 0 are dropped (counted in the report).

**fundraises_with** uses linkage-file rows with designation J only. Two members whose candidate ids are linked to the
same JFC in the same cycle form an edge with `via` = the JFC, `count` = cycles, `by_year` one entry per cycle,
amounts null, and first/last = cycle bounds. Linkage rows whose candidate election year is already past are stale
carry-overs (a 1994 JFC still listed in 2006) and are dropped (1,098 rows). JFC payments in pas2 are not used as
proof of participation, because a JFC also gives to non-participants (the Jared Polis Victory Fund lists 86 linked
candidates). Complete participation would need the 18G/24G transfers in `oth` (about 1.5 GB across cycles).
Large JFCs fan out into many pairs; the note gives the participant count so the site can down-weight them.

## Row-count audit (full run, cycles 2000-2026)

Rows read (each = lines in file): pas2 5,818,549 (2000: 247,340; 2002: 237,106; 2004: 245,668; 2006: 266,703;
2008: 305,735; 2010: 325,095; 2012: 395,069; 2014: 350,272; 2016: 516,385; 2018: 349,820; 2020: 887,829;
2022: 749,163; 2024: 703,163; 2026: 239,201). cm 204,544; cn 86,176; ccl 82,852; weball 44,913. Per-file,
per-cycle counts and the rule table for each cycle are in `sources/fec.json` (`files`, `pas2_rules_by_cycle`).

| pas2 rule | rows | dollars |
|---|---:|---:|
| keep:pac_money | 3,018,579 | 5,132,253,493 |
| keep:funds | 176,214 | 313,248,653 |
| keep:outside_support | 282,693 | 2,246,141,824 |
| keep:outside_oppose | 148,569 | 5,870,479,665 |
| drop:type_out_of_scope:24C | 40,926 | 1,037,886,922 |
| drop:type_out_of_scope:24R / 24H | 152 / 7 | 351,333 / 6,500 |
| drop:memo_item | 87,478 | 412,609,787 |
| drop:date_missing_or_invalid | 990 | 21,549,643 |
| drop:date_out_of_range | 38 | 11,064 |
| drop:duplicate_rereport | 70,134 | 32,796,161 |
| drop:amount_equals_recipient_committee_id | 2 | 835,342 |
| drop:earmarked_via_conduit | 1,319,594 | 48,592,098 (net; WinRed rows include refunds) |
| drop:conduit_pass_through | counted from the next `main` run | (bulk files of 2026-11-24, no OpenFEC sponsors: 5,061 rows, 9,698,173) |
| drop:reviewed_not_received | 38 (listed by row id) | 1,270,341 |
| drop:recipient_campaign_not_member | 274,861 | 593,264,809 |
| drop:recipient_not_a_campaign_committee | 435 | 1,155,846 |
| drop:recipient_committee_unknown | 716 | 1,038,103 |
| drop:recipient_not_member | 11 | 140,320 |
| drop:candidate_committee_conflict | 1,056 | 1,659,605 |
| drop:own_committee_transfer | 984 | 30,067,183 |
| drop:giver_joint_fundraising_committee | 1,481 | 19,755,818 |
| drop:giver_campaign_of_non_member | 4,882 | 14,873,223 |
| drop:ie_target_not_member | 388,747 | 9,389,878,248 |

Edges: pac_money 684,856 · outside_spending 34,527 · funds 86,920 · fundraises_with 9,463 · orgs 11,058 (10,679 pac, 379
company). Dropped for net ≤ 0: 9,181 pac_money, 532 funds, 93 outside_spending pairs.
Matches: 410 of 8,493 pac_money committees (4.8%) map to a public company, covering $892M of $5.13B (17.4%). 3,464
committees name a connected organisation; most unmatched ones are trade associations and unions with no SEC
filer. The top 50 unmatched by dollars are in the report (`top_unmatched_connected_orgs`) for human overrides.
The 37 in-scope members with no FEC id are all historical except Alan Armstrong (A000383) and Darline Graham (G000608).

## The weball comparison, and the Jordan and Cruz residuals

`run.py` compares, for six members, our giver-side total (pac_money + funds + other candidates' campaigns, by
transaction date in the two calendar years of the cycle) with weball's `OTHER_POL_CMTE_CONTRIB`, which is the
recipient committee's own summary (Form 3 line 11c, latest amendment). Most member-cycles agree within a few percent.
Two did not, and both differences are in the recipients' filings, not double counting here (checked 2026-11-14
against the OpenFEC reports and Schedule A endpoints for the recipient committees):

- **Jim Jordan, 2020 (ours $441,468 vs weball $142,548, +210%).** Jordan for Congress (C00416594) filed every
  2019-2020 report in 2021 again as an amendment (file numbers 1495855-1497503). The original reports listed
  $418,576 from other committees on line 11c; the amendments cut that to $142,548. The givers' own reports (pas2) were
  not amended, and they still list about 215 non-conduit contributions (mostly $2,500-$5,000) to that committee. Our figure
  is within 5.5% of the recipient's original reports. Nothing in the pipeline double counts: each row is one giver's
  report of one contribution, re-reports are removed, and no second committee is involved (Jordan has one
  authorised committee; his JFC C00484360 is excluded as a giver and is not a recipient).
- **Ted Cruz, 2018 and 2022; Jim Jordan, 2020 after the conduit list.** See `docs/fec-conduits.md` ("The cross-check").
  Earlier explanations here were wrong on three points: the 2018 "$182,000" was an OpenFEC double-load plus a keying
  error, and about $113,000 of the 2018 excess was forwarded money; the 2022 difference is mostly December 2022
  cheques received in January 2023; Senate Conservatives Fund and RJC earmarks were not excluded before the list.

What the site shows is therefore "what committees reported giving", which can exceed what the recipient reports
receiving. Recipient-side refunds (22Z) and reclassifications are invisible in pas2 (see below).

## Payees

Independent-expenditure payees (the vendors and consultants a committee paid, individuals and organisations
alike) are published as filed in the "(paid to ...)" evidence labels and in `review_large_funds_rows`.

## Known limitations

- **Senate paper filings.** Senate committees filed on paper with the Secretary of the Senate until 2019, and a
  contractor keyed the itemisations. Expect keying errors in names, dates and amounts (we found amounts equal to
  committee ids), missing transaction ids, and pre-2019 Senate data that is less complete than House data.
- **Giver-side reporting only.** pas2 is what the giving committee reported. Refunds by the recipient (22Z in the
  recipient's own reports) are not netted, and redesignations or reattributions on the recipient side are invisible.
  This, together with timing (date contributed versus date received) and recipients treating some receipts as
  transfers, is why totals differ from weball by a few percent.
- **Conduits and earmarks** are identified by two exact-id lists (`conduits.py`) and by memo text. A conduit not on the
  list that writes no "earmark" memo is still counted as PAC money; `build/fec_conduit_review.json` lists
  candidates. A contribution the giver coded 24G is not in pas2 and is never seen (`docs/fec-conduits.md`).
- **Amendments.** We rely on the FEC having replaced amended reports; residual double reports are caught only when the
  transaction id and every money field match.
- Party 24K amounts above the $5,000 limit (for example NRSC to Senate candidates at about $50,000) are taken as filed;
  some may be coordinated expenditures entered as contributions.
- Kept rows from candidate committees above $10,000 (19 rows, e.g. Friends of Tiberi paying Troy Balderson's media
  vendors, coded 24K with Balderson's committee id) are listed in `review_large_funds_rows`.

## Output size

`fec_pac_money.jsonl` is about 762 MiB (684,856 edges, about 1.1 KB each, mostly the five evidence items). Nothing is
truncated. What a threshold would leave (all members / current members only):

| --min-total | edges | MiB | current-only edges | MiB |
|---:|---:|---:|---:|---:|
| 0 | 684,856 | 762 | 255,990 | 292 |
| 1,000 | 641,947 | 735 | 246,211 | 286 |
| 5,000 | 290,130 | 449 | 122,177 | 188 |
| 10,000 | 160,075 | 282 | 70,180 | 125 |

A dollar threshold alone does not get the file under 150 MB unless it drops most ties. Two lossless options: shard
the file by recipient (for example `fec_pac_money_<first letter of bioguide>.jsonl`, each under about 60 MB), or cut
evidence for pac_money to 3 items.

## Spending and loans (`spending.py`, `spending_oppexp.py`)

Adds `campaign_finance` for each member (contract: `docs/data-dictionary.md`, "Campaign finance block"). Runs inside
`run.py` right after the reference tables (it needs the `lpac` table and `cm_latest`), writes
`pipeline/build/campaign_finance.json` and `pipeline/build/sources/fec_spending.json`, and adds the `oppexp` files to the
`fec` source's file list. Sources (accessed 2026-11-17):

| File | URL | Used columns |
|---|---|---|
| `weball<yy>.zip` (already loaded) | `https://www.fec.gov/files/bulk-downloads/<YYYY>/weball<yy>.zip`; description <https://www.fec.gov/campaign-finance-data/all-candidates-file-description/> | `CAND_ID`, `CAND_LOANS`, `OTHER_LOANS`, `CAND_LOAN_REPAY`, `OTHER_LOAN_REPAY`, `DEBTS_OWED_BY`, `CVG_END_DT` |
| `oppexp<yy>.zip` | `https://www.fec.gov/files/bulk-downloads/<YYYY>/oppexp<yy>.zip`; description <https://www.fec.gov/campaign-finance-data/operating-expenditures-file-description/>; header <https://www.fec.gov/files/bulk-downloads/data_dictionaries/oppexp_header_file.csv> | `CMTE_ID`, `TRANSACTION_AMT`, `TRANSACTION_DT` and `TRAN_ID` (only to recognise a re-report), `CATEGORY`, `MEMO_CD`, `FILE_NUM`, `SUB_ID`. Never read: `NAME`, `CITY`, `STATE`, `ZIP_CODE`, `PURPOSE`, `MEMO_TEXT`, `ENTITY_TP` |
| category codes | <https://www.fec.gov/campaign-finance-data/disbursement-category-code-descriptions/> | labels in `spending_oppexp.CATEGORY_LABELS` |

Rules
- Loans are copied from the weball row of each of the member's candidate ids (exact `refs.Members.cand_to_bio`).
  Blank = null, negative (80 figures in 44,913 rows) = null and listed in the report, 0 = 0.
- Leadership PACs are the `lpac` table of `build._leadership` (filed candidate id, or the FEC leadership list's sponsor
  name equal to the candidate-master name; no similarity matching). Every line of `oppexp` is read from the zip but split
  only when its first 9 bytes are one of those committee ids. Memo items (`MEMO_CD` = X) are dropped; the same transaction
  (committee, `TRAN_ID`, date, amount) re-reported in a later filing counts once (highest `FILE_NUM`); negative rows (refunds, voids) are summed apart as `refunds`, never netted.
  Sums are by `CATEGORY` (001-012, 101-107); anything else goes to `category: null`. About 86% of 2024 rows and 78% of
  dollars have no category, because Form 3X rows mostly carry none. The bulk file has no other category field.
- A first line with a different number of columns skips that file-cycle (`oppexp_coverage` says so, a warning is printed).
  Only the 2024 layout has been checked by hand (24 or 25 delimiters per line); verify the other cycles in the first full run.
- Not built: payments to family members or member-owned firms. No bulk-file field is an exact identifier for them.

Measured on 2024 (2026-11-17): `oppexp24.zip` 64 MB downloaded in 2.4 s; 2,249,911 lines streamed in 2.9-3.4 s; peak memory 63 MB
for the stream, 147 MB with DuckDB. The other 11 files are 26-65 MB each (cold run about 0.6 GB, daily run the two latest cycles,
about 115 MB). `weball` was read for all 14 cycles (44,913 rows).

## OpenFEC API: exact sponsors and purpose groups (`api.py`, `sponsors_api.py`, `purposes_api.py`)

Key: environment variable `FEC_API_KEY` (repository secret, given to the "Run pipeline" step only); never printed, cached or put
in an error. Missing key, HTTP error, bad JSON or `PT_CACHE_ONLY=1`: a warning, the cache is used if there is one (reported as
`stale_cache` / `stale_cycles`), otherwise the build goes on without (sponsors from the bulk files, `purposes: null`). Never fails the run.
Cache: `pipeline/.cache/fec/api/` (gitignored, kept by the daily job's cache). One shared request counter, hard stop at 500 per run.
- `/v1/committees/?designation=D&per_page=100&sort=committee_id`: 16 pages, 1,507 leadership PACs, 1,373 with `sponsor_candidate_ids`.
  Refetched after 7 days. Only id, name, sponsor ids and cycles are kept. Live 2026-11-24: 1,013 PACs link to a member by exact id
  (596 not linked before; 486 -> 1,082 linked in all).
- `/v1/schedules/schedule_b/by_purpose/?committee_id=...&cycle=...`: up to 100 `committee_id` per request, paged by 100 rows. Asked
  only for committee-cycles with oppexp rows. Two latest cycles refetched after 12 h, older after 7 days; a new committee at once.
  Requests, live: 253 for all 12 cycles (about 5 min); 29 per recent cycle. The API lists some identical group rows twice (36 of
  21,656): counted once. 86 groups had a negative total: published as `total: null` and listed in the report.
- `/v1/totals/pac/?committee_id=...&cycle=...` (`totals_api.py`): the FEC committee summary per PAC cycle, up to 100 committees per request, same cache and refresh rules as the purpose groups; at most 22 requests a normal day and 132 for all cycles (11 batches a cycle for at most 1,082 linked PACs; about 18 and 69 expected). Rules, requests and the real-data check: `docs/leadership-pac-totals.md`.
Tests: `test_fec_api.py`, `test_fec_purposes.py`, `test_fec_totals.py` (recorded pages in `pipeline/tests/fixtures/fec_api/`); `test_fec_spending.py` with recorded
rows in `pipeline/tests/fixtures/fec_spending/` (payee name, city, state, ZIP, purpose and memo text blanked).
