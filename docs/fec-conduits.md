# FEC conduit PACs: what is left out of PAC money, and why

Rule in `pipeline/fec/conduits.py`; applied by `pipeline/fec/build.py` (`classify_rows`); checked by
`pipeline/validate_fec_conduits.py`; tests in `pipeline/tests/test_fec_conduits.py`. Written 2026-11-24 (review
packet P9). `pipeline/fec/README.md` (rule 6, the cross-check notes, Known limitations) points here for the detail.

## The problem

`pac_money` is meant to be a committee's own money given to a member's campaign. Some PACs also forward
contributions that individuals earmarked for a candidate. That is an ordinary, lawful filing practice: the money
counts against the individual's limit, not the PAC's, and the recipient reports it as individual contributions
(Schedule A line 11AI, receipt type 15E, "earmarked through ..."). Most forwarders mark such rows in the bulk file
(a memo code, or memo text saying "earmark"), and the pipeline has always dropped those.

A few PACs report the forwarded money as plain contribution rows: type 24K, no memo code, blank memo text. Nothing in
the row says it is not the PAC's own gift, so it was counted as PAC money. The signs are amounts no PAC gives
(a single row of $36,039 against a $5,000 limit, hundreds of rows under $200, many rows of exactly the individual
limit to one candidate on one day).

## The rule

1. **Payment platforms** (unchanged): every contribution row of WinRed `C00694323`, ActBlue `C00401224` and
   Democracy Engine `C00468314`, and any row whose memo text contains "EARMARK", is `drop:earmarked_via_conduit`.
2. **Listed conduit PACs** (new): every type-24K row of a committee in the list below, in the cycle files listed
   for it, is `drop:conduit_pass_through`. It is not `pac_money` and not member-to-member `funds`.
   - **The PAC's own direct gifts in those cycles are dropped too.** The bulk file gives no exact way to tell a
     $5,000 gift from a forwarded $5,000, so the whole committee is left out rather than guessed at row by row.
     Matching each row against the recipient's line 11C through OpenFEC would recover them; that is a follow-up.
   - In-kind rows (24Z) and independent expenditures of the same committees are kept.
   - The committee's other cycle files are kept: they show ordinary round gifts (table per cycle below).
3. The list is by exact FEC committee id, reviewed by hand. A name is never used. An id is added only with both
   kinds of evidence: the pattern in the giver's own rows, and the recipient reporting the same money as earmarked.

What is removed is counted in `meta.json` under `exclusions.conduit_pass_through`: `rows` and `dollars` (rows whose
recipient is a member's campaign), `all_recipients` (including non-members), `committees` (per id, with its `cycles`),
`by_cycle`, `giver_member_pairs`, and a `reason` that names the ids and their cycles. These are the rows the rule took; a few would otherwise have
been dropped by a later rule (recipient conflict, own committee). `/method` shows it under "Excluded records".

## The list

| Id | Name in the FEC committee master | Cycle files listed | Giver's own rows (non-memo 24K, bulk file) | Recipient's report |
|---|---|---|---|---|
| `C00448696` | Senate Conservatives Fund | 2018, 2020, 2024 | 2018: 62 rows, 15 above $5,000, largest $45,421. 2020: 131 rows, 52 above $5,000, largest $51,360. 2024: 107 rows, 29 above $5,000. To Ted Cruz for Senate 2018: $36,039 and $29,739 on two days. | Ted Cruz for Senate `C00492785`, 2018: line 11C lists $15,000 from this id; the rest is on 11AI as 15E. |
| `C00552851` | House Freedom Fund | 2016, 2020, 2022, 2024, 2026 | 2016: 140 rows, 19 above $5,000, largest $38,690. 2020: 484 rows, 175 under $200, 55 above $5,000. 2022: 281 rows, 55 above $5,000. It also files thousands of memo rows of a few dollars (1,435 in 2020) beside non-memo totals such as $5,195. | Patriots for Perry `C00510164`, October 2019: 30 rows on 11AI, type 15E, memo "EARMARKED FROM HOUSE FREEDOM FUND". |
| `C00247403` | NORPAC | 2010, 2012, 2016 to 2026 | 2010: 4 rows above $5,000, largest $11,100. 2018: 32 rows, 11 above $5,000, largest $27,000. 2022: 27 rows, 8 above $5,000, largest $85,100. 2024: 67 rows, 30 above $5,000. | Ted Cruz for Senate, 2018: nothing from this id on line 11C; the giver reports $23,400. |
| `C00345132` | Republican Jewish Coalition PAC (RJC-PAC) | 2018, 2020 | 2018: 1,263 rows, 982 under $200 (103 rows of $2 to $2,391 to Ted Cruz for Senate). 2020: 176 rows, 54 under $200. | Ted Cruz for Senate, 2018: line 11C lists $10,000 from this id; the giver reports $34,139. |
| `C00484535` | VoteSane PAC | 2016, 2020, 2024 | 2016: 637 rows, none above $2,700 (the individual limit that cycle). 2020: 755 rows, 110 under $200, none above $2,800, up to 100 rows to one candidate. | Stivers for Congress `C00441352`, February to March 2020: 98 rows, $61,000, on 11AI as 15E, each beside a memo row "TOTAL EARMARKED THROUGH CONDUIT. PAC LIMIT NOT AFFECTED." Grassley Committee `C00230482`, September to October 2016: 74 rows, $47,000, on 11AI as 15E, beside memo rows naming VoteSane PAC as intermediary (the giver reports 73 rows). |
| `C00678870` | WinDem | 2018 | 2018 (its only cycle with rows): 257 rows, 252 of them exactly $2,700, up to 12 to one candidate for one election ($32,400). No row under $200 or above $5,000: it is listed on the per-election sums and the recipient's report. | Diane for Colorado CD3 `C00649459`, August to September 2018: on 11AI as 15E with memo "NOTE: ABOVE CONTRIBUTION EARMARKED THROUGH THIS ORGANIZATION". |

Sources: FEC bulk files `pas2` and `cm` for every cycle 2000 to 2026 as downloaded 2026-11-24, and OpenFEC
`/v1/schedules/schedule_a/` for the recipient committees named.

### Which cycle files are listed: one test for all six ids

A cycle file is listed for a committee when its 24K rows without a memo code or "EARMARK" text include **at least 10
rows under $200, or at least 2 rows above $5,000 to candidate committees** (`CYCLE_SMALL_ROWS`, `CYCLE_OVER_ROWS` in
`conduits.py`), or when a recipient's own report shows that cycle's rows as earmarked receipts (marked "recipient").
Two rows, not one, because a single round row above the limit is more often several elections keyed as one
(RJC-PAC 2002: $15,000 to a Senate runoff committee). Every other cycle stays counted.

| Id | Cycle file | Rows | Dollars | Under $200 | Above $5,000 to candidates | Largest | Rows with EARMARK text | Listed |
|---|---|---|---|---|---|---|---|---|
| `C00247403` | 2000 | 62 | 51,500 | 0 | 0 | 5,000 | 0 | no |
| `C00247403` | 2002 | 118 | 204,765 | 0 | 0 | 5,000 | 0 | no |
| `C00247403` | 2004 | 105 | 254,914 | 0 | 0 | 5,000 | 0 | no |
| `C00247403` | 2006 | 84 | 211,250 | 0 | 0 | 5,000 | 0 | no |
| `C00247403` | 2008 | 77 | 235,840 | 0 | 0 | 5,000 | 0 | no |
| `C00247403` | 2010 | 67 | 181,495 | 1 | 4 | 11,100 | 0 | yes |
| `C00247403` | 2012 | 46 | 130,024 | 0 | 2 | 20,000 | 0 | yes |
| `C00247403` | 2014 | 24 | 45,857 | 1 | 0 | 5,000 | 0 | no |
| `C00247403` | 2016 | 40 | 196,647 | 1 | 8 | 40,706 | 0 | yes |
| `C00247403` | 2018 | 32 | 181,091 | 2 | 11 | 27,000 | 0 | yes |
| `C00247403` | 2020 | 71 | 407,322 | 3 | 20 | 40,286 | 0 | yes |
| `C00247403` | 2022 | 27 | 222,555 | 1 | 8 | 85,100 | 0 | yes |
| `C00247403` | 2024 | 67 | 600,770 | 9 | 30 | 42,050 | 0 | yes |
| `C00247403` | 2026 | 53 | 303,600 | 3 | 18 | 20,600 | 0 | yes |
| `C00345132` | 2000 | 9 | 9,000 | 0 | 0 | 3,000 | 0 | no |
| `C00345132` | 2002 | 33 | 143,400 | 0 | 1 | 15,000 | 0 | no |
| `C00345132` | 2004 | 44 | 126,500 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2006 | 42 | 140,000 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2008 | 45 | 170,500 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2010 | 59 | 176,500 | 0 | 1 | 10,000 | 0 | no |
| `C00345132` | 2012 | 42 | 125,500 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2014 | 62 | 237,000 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2016 | 79 | 257,000 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2018 | 1,263 | 438,817 | 982 | 0 | 5,000 | 0 | yes |
| `C00345132` | 2020 | 176 | 340,934 | 54 | 0 | 5,000 | 0 | yes |
| `C00345132` | 2022 | 89 | 280,300 | 0 | 0 | 5,000 | 0 | no |
| `C00345132` | 2024 | 100 | 332,000 | 0 | 0 | 5,000 | 1572 | no |
| `C00345132` | 2026 | 68 | 325,000 | 0 | 0 | 5,000 | 144 | no |
| `C00448696` | 2008 | 6 | 30,000 | 0 | 0 | 5,000 | 0 | no |
| `C00448696` | 2010 | 22 | 100,000 | 0 | 0 | 5,000 | 0 | no |
| `C00448696` | 2012 | 17 | 75,000 | 0 | 0 | 5,000 | 0 | no |
| `C00448696` | 2014 | 37 | 125,328 | 3 | 0 | 5,000 | 0 | no |
| `C00448696` | 2016 | 24 | 81,114 | 0 | 0 | 5,000 | 0 | no |
| `C00448696` | 2018 | 62 | 641,434 | 0 | 15 | 45,421 | 0 | yes |
| `C00448696` | 2020 | 131 | 972,281 | 15 | 52 | 51,360 | 0 | yes |
| `C00448696` | 2022 | 13 | 65,000 | 0 | 0 | 5,000 | 0 | no |
| `C00448696` | 2024 | 107 | 484,324 | 0 | 29 | 14,855 | 0 | yes |
| `C00448696` | 2026 | 27 | 114,910 | 0 | 0 | 5,000 | 0 | no |
| `C00484535` | 2012 | 2 | 45 | 2 | 0 | 25 | 0 | no |
| `C00484535` | 2014 | 3 | -6,250 | 0 | 0 | 0 | 0 | no |
| `C00484535` | 2016 | 637 | 401,685 | 3 | 0 | 2,700 | 0 | yes (recipient) |
| `C00484535` | 2018 | 2 | 1,143 | 0 | 0 | 763 | 0 | no |
| `C00484535` | 2020 | 755 | 371,462 | 110 | 0 | 2,800 | 0 | yes |
| `C00484535` | 2022 | 6 | 539 | 5 | 0 | 237 | 0 | no |
| `C00484535` | 2024 | 43 | 10,969 | 30 | 0 | 4,750 | 0 | yes |
| `C00552851` | 2014 | 2 | 2,000 | 0 | 0 | 1,000 | 0 | no |
| `C00552851` | 2016 | 140 | 306,695 | 68 | 19 | 38,690 | 0 | yes |
| `C00552851` | 2018 | 67 | 278,221 | 3 | 0 | 5,000 | 0 | no |
| `C00552851` | 2020 | 484 | 1,317,378 | 175 | 55 | 30,097 | 0 | yes |
| `C00552851` | 2022 | 281 | 1,114,587 | 28 | 55 | 17,946 | 0 | yes |
| `C00552851` | 2024 | 190 | 240,728 | 13 | 17 | 13,359 | 0 | yes |
| `C00552851` | 2026 | 132 | 166,475 | 95 | 0 | 5,000 | 0 | yes |
| `C00678870` | 2018 | 257 | 666,900 | 0 | 0 | 2,700 | 0 | yes (recipient) |

What the test leaves counted, and may include forwarded money inside the limit: House Freedom Fund 2018 (67 rows,
3 under $200); Senate Conservatives Fund 2014 (3 rows under $200), 2016 and 2026 (a few odd amounts); NORPAC 2014
and its odd amounts in 2002 and 2008; VoteSane 2012, 2018 and 2022 (2 to 6 rows each). RJC-PAC marks its forwarded
rows with "EARMARK" text in 2024 and 2026 (1,572 and 144 rows), which the memo rule already drops, so its round
gifts in 2022 to 2026 are counted. In a listed cycle the committee's own direct gifts are dropped with the rest.

### Reviewed and not listed

| Id | Name | Why not |
|---|---|---|
| `C00332296` | Susan B. Anthony List Candidate Fund | Mixed. It has rows above the limit (2018: $11,690 and $11,050; 2020: ten rows above $5,000) and runs of small rows (2006: 282 under $200; 2024: 277). A recipient (Friends of Chris Smith `C00096412`, October 2018) reports earmarks "through conduit" from "SBA LIST CANDIDATE FUND", but by name, as receipt type 15 and for less than the giver's row. Most of its rows are round gifts of $1,000 to $5,000. Not listed until the recipient side is matched by id; its rows above $5,000 are in the review report. Its four rows above $10,000 (purpose "EARMARKED CONTRIBUTION") are dropped row by row (`docs/fec-reviewed-rows.md`). |
| `C00494971` | Florida Freedom Committee | Its one large row ($376,087 to committee `C00376087`) is an amount equal to the recipient's committee id, already dropped by that rule. The other rows are round gifts. |
| `C00688069` | Support American Leaders PAC | No 24K rows in the 2018, 2020 or 2022 files. No evidence either way. |
| `C00341396` | MoveOn.org Political Action | Reviewed 2026-11-25. Its ten rows above $10,000 (2006, 2008, 2012, 2018; largest $105,295) are forwarded earmarks, by its own purpose text and the recipients' reports, and are dropped row by row (`docs/fec-reviewed-rows.md`). Most of its other rows in those cycles are round direct gifts (2018: 182 of 183), so the cycles are not listed. |

## Measured effect (bulk files of 2026-11-24, all cycles, without the OpenFEC sponsor list)

| Cycle file | Rows left out (to members) | Dollars | `pac_money` rows kept | `pac_money` dollars kept |
|---|---|---|---|---|
| 2010 | 63 | 160,395 | 235,241 | 386,258,845 |
| 2012 | 39 | 114,124 | 233,825 | 397,455,800 |
| 2016 | 789 | 794,662 | 240,061 | 431,000,461 |
| 2018 | 1,351 | 1,423,537 | 248,711 | 451,222,318 |
| 2020 | 1,421 | 2,707,999 | 227,043 | 424,567,802 |
| 2022 | 263 | 1,187,118 | 197,427 | 402,273,593 |
| 2024 | 312 | 1,147,391 | 209,676 | 427,432,977 |
| 2026 | 171 | 409,825 | 175,065 | 367,600,826 |
| All | 4,409 | 7,945,051 | 3,017,396 (2000 to 2026) | 5,131,310,811 |

Including recipients who are not members: 5,061 rows, $9,698,173. 553 giver-member pairs lose rows. Per committee
(to members): House Freedom Fund 1,033 rows, $2,625,800; NORPAC 358, $1,993,965; Senate Conservatives Fund 206,
$1,571,664; VoteSane 1,390, $780,850; RJC-PAC 1,309, $683,872; WinDem 113, $288,900. In the 2018, 2020 and 2022
files alone: 3,035 rows, $5,318,654 (`pac_money` 678,455 rows to 675,421).

- **Ted Cruz, 2018 cycle.** $133,317 net no longer counted: Senate Conservatives Fund $75,778 (4 rows), RJC-PAC
  $34,139 (103 rows), NORPAC $23,400 (5 rows). Of that, $25,000 is on the recipient's own line 11C as direct gifts
  ($15,000 and $10,000) and is lost with the rest; about $113,000 was forwarded money counted as PAC money.
- **Jim Jordan, 2020 cycle.** $24,523 in 20 House Freedom Fund rows no longer counted (rows of $65 to $5,195).

## What is still kept and looks forwarded (the review report)

The FEC stage writes the counts to `meta.json.reports.fec.conduit_review` and the full lists to
`pipeline/build/fec_conduit_review.json` (about 3 MB, not published: `meta.json` is fetched by every page). The
validator reads both and prints the report. It covers kept `pac_money` rows whose giver is not a party committee
(candidate committees and joint fundraising committees never reach `pac_money`). Single rows carry their type; the
sums and the small-row list are 24K rows only, so in-kind shares are not mistaken for forwarded money.

| Check | All cycles | 2018, 2020 and 2022 files only |
|---|---|---|
| Single rows above $5,000 | 472 rows, $4,974,838, 311 givers | 144 rows, $1,263,525, 107 givers |
| Single rows above $10,000 | 51 rows, $1,578,501 | 10 rows |
| Giver to member to election sums above $5,000, within one cycle file (24K) | 11,528 | 2,677 |
| Giver-cycles with 25 or more 24K rows under $200 | 67 | 25 |

Most sums above $5,000 are a primary and a general gift filed under one election code, not forwarded money; that
list is a place to look, not a finding. The givers with the most small 24K rows are EMILY's List `C00193433`,
Club for Growth PAC `C00432260`, Peace Action West Voter Fund `C00293894`, Susan B. Anthony List `C00332296`,
Chamber of Digital Commerce PAC `C00567412`, League of Conservation Voters Action Fund `C00252940` and Human Rights
Campaign PAC `C00235853`. None of them has been
checked against a recipient's report, so none is listed.

**The hard failure is on (2026-11-25).** All 51 single kept rows above $10,000 were reviewed against the giver's
and the recipient's filings: 38 are dropped by row id as `drop:reviewed_not_received` (`pipeline/fec/reviewed_rows.py`)
and 13 are kept as filed on the allow-list (`ALLOWED_ROWS`, by FEC `SUB_ID`, in `pipeline/validate_fec_conduits.py`).
`ENFORCE_HARD` is `True`: a new kept row above $10,000 on neither list fails the build until it is reviewed. Rows,
evidence and reasons: `docs/fec-reviewed-rows.md`. The counts in the table above are from before the review.

## Known gap: contributions coded 24G

`pas2` holds the types the FEC classes as contributions to candidates and independent expenditures. A committee that
codes a contribution to a campaign as 24G (transfer out to an affiliated committee) puts it outside that file, and
the pipeline never sees it. Example: AFSCME PEOPLE `C00011114` to Nancy Pelosi for Congress `C00213512`, 2005-10-27,
$5,000 (Schedule B line 23, transaction `SB23.63955`, file 192368), is in OpenFEC and absent from `pas206`. The
bulk file `oth` (committee-to-committee transactions) carries 24G rows; reading it for rows whose recipient is a
member's authorised committee is a possible follow-up. Until then such gifts are missing, not zero.

## The cross-check against the recipient's summary (`pipeline/fec/crosscheck.py`)

For six well-known members and the 2018 to 2024 cycles the FEC stage prints, and writes to
`meta.json.reports.fec.weball_check`:

- `recipient_line_11c`: weball "contributions from other political committees", a gross figure;
- `ours_positive`: our positive rows from non-party committees (`pac_money`, `funds`, and other candidates'
  campaigns), dated in the two calendar years;
- `residual` = `ours_positive` minus `recipient_line_11c`, labelled "giver-reported minus recipient line 11c";
- `ours_positive_dated_december_even_year`: the part of our rows dated in December of the even year. A cheque
  written in December is often banked, and reported, in January of the next cycle: timing, not a missing receipt;
- `ours_negative` beside `recipient_refunds_to_committees`: refunds and voids are compared on their own. A giver's
  negative row is often a cheque that was never banked, which appears in neither of the recipient's figures, so
  `residual_after_our_negatives` is given too;
- `listed_conduits_left_out`: what the listed conduits' positive rows would have added.

Nothing in it fails the build. The two sides are different definitions: the recipient may have amended its
reports, banked a cheque in another cycle, or received the money through a joint fundraising committee.

- **Jim Jordan, 2020** (ours $423,995 against $142,548). The committee refiled its 2019 to 2020 reports in 2021
  (file numbers 1495855 to 1497503); the originals listed $418,576 on line 11c and the amendments cut that to
  $142,548. The givers' reports were not amended. Our figure is within 1.3% of the recipient's original reports
  now that $24,523 of House Freedom Fund rows is left out.
- **Ted Cruz, 2018** (ours $1,433,020 positive, $1,389,520 after the givers' own negative rows, against
  $1,281,824). The earlier text said the committee's own itemised line 11C came to $1,463,824, about $182,000 above
  weball, and that our figure matched it. That was wrong: the $182,000 is OpenFEC carrying the committee's second
  quarter 2018 report twice (files 1251014 and 1252810) plus a keying error on a row from Valero's PAC `C00109546`.
  The recipient's line 11c is the weball figure. Our old total ($1,522,837 net) was $241,013 above it, and about
  $113,000 of that was forwarded money from the three listed conduits. The rest is not itemised here.
- **Ted Cruz, 2022** (ours $94,580 positive against $68,080). $20,000 is timing: Leadership and Accountability Are
  National Keys PAC `C00492058` (two rows of $5,000 dated 2022-12-22) and Defend Our Conservative Senate PAC
  `C00632323` (two rows of $5,000 dated 2022-12-14) wrote cheques in December 2022 that fall in the recipient's
  next cycle. The earlier text called these "never itemised" and named the second one wrongly. Giver-reported and
  not on the recipient's line 11C for the cycle: Apache Corporation PAC `C00279224` $2,500 (2022-04-05),
  Professional Insurance Agents PAC `C00004994` $2,500 (2022-09-13), Auto Care Association PAC `C00250753` $1,000
  (2021-11-24). The earlier text also said Senate Conservatives Fund and RJC earmarks were "excluded by rule"; they
  were not until this change.

## Changing the list

Add an id to `LISTED`, or a cycle to an id, only when the cycle passes the test above or a recipient's report
shows it, and add its rows here. Remove an id the same way. `ALLOWED_ROWS` takes `SUB_ID`s of single rows above $10,000 that have been read
against the filing image and accepted as filed. Tests must be updated with the list. The cycle sets are hand-maintained:
when a new FEC cycle file appears (2028) and once the current cycle closes, re-run the per-cycle table above for every
listed id (the listed committees' unlisted cycles stay visible in the review report meanwhile). NORPAC 2012 sits exactly
on the threshold (two rows above $5,000).
