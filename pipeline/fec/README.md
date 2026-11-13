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
| All-candidates summary `weball` (sanity check only) | `.../weball{YY}.zip` | 2000-2026 |
| Leadership PACs and sponsors | `https://www.fec.gov/files/bulk-downloads/data.fec.gov/leadership{YYYY}.csv` | 2010-2026 only (404 before 2010) |
| Members (fallback) | congress-legislators `legislators-current.json`, `legislators-historical.json` | |
| Company names (fallback) and company org records | `https://www.sec.gov/files/company_tickers.json` | |

Column lists are taken from the FEC header files (`data_dictionaries/<name>_header_file.csv`) and hard-coded in
`load.py`. Every file is read as text with no quoting; each load asserts rows parsed = lines in the file (it held
for all 70 file-cycles). All files decoded as UTF-8.

Not used: individual contributions (`indiv`, which is very large and carries the sale-and-use restriction) and the
`oth` any-transaction file. No API calls are made. The leadership-PAC bulk file replaces the OpenFEC
`sponsor_candidate_ids` lookup.

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
6. **Earmarked or conduit money.** Rows from WinRed, ActBlue or Democracy Engine, and any row whose memo
   contains "EARMARK", are individuals' money passed through, not the committee's own (JStreetPAC, Zinc Collective,
   RJC, Swing Left, and AMERIPAC's earmarks among them). Recipients report these as individual contributions, so
   excluding them also matches weball.
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
- linkage or committee-master rows with designation D that carry a candidate id (26 committees);
- the leadership-PAC file (2010 onward), whose sponsor field is a name only (460 committees). A name is accepted only if,
  with punctuation removed, it equals the FEC candidate-master name of candidates who all map to one member.
  There is no fuzzy matching. 54 ambiguous names and 1,090 unmatched (committee, sponsor) rows are listed in the
  report (many are governors or non-members).

One committee whose sources named different members is dropped. Funds edges through a leadership PAC carry
`note: "via leadership PAC"`. Before 2010 a leadership PAC counts as a member's only if it carries a filed candidate id.

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

## Known limitations

- **Senate paper filings.** Senate committees filed on paper with the Secretary of the Senate until 2019, and a
  contractor keyed the itemisations. Expect keying errors in names, dates and amounts (we found amounts equal to
  committee ids), missing transaction ids, and pre-2019 Senate data that is less complete than House data.
- **Giver-side reporting only.** pas2 is what the giving committee reported. Refunds by the recipient (22Z in the
  recipient's own reports) are not netted, and redesignations or reattributions on the recipient side are invisible.
  This, together with timing (date contributed versus date received) and recipients treating some receipts as
  transfers, is why totals differ from weball by a few percent.
- **Conduits and earmarks** are identified by a three-committee list and by memo text. A conduit that does not write
  "earmark" in its memo would be counted as PAC money (candidates to check: IT STARTS TODAY,
  California Peace Action PAC, Chamber of Digital Commerce PAC, which have many sub-$100 24K rows).
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
