# Reviewed single PAC rows above $10,000

A multicandidate PAC may give a candidate $5,000 per election. A single kept contribution row above $10,000 is
therefore either several elections keyed as one, a filer's error, or money that did not go to the campaign. The FEC
stage lists every such row (`rows_over_hard` in `pipeline/build/fec_conduit_review.json`, see
`docs/fec-conduits.md`). On the bulk files of 2026-11-24 there were 51, $1,578,501 across all cycles. Each was read
on 2026-11-25 against two filed records, through OpenFEC:

- the giver's own Schedule B line (`/v1/schedules/schedule_b/`, the giver's id and the recipient's id, three days
  either side of the date): payee name, purpose, memo lines beside it;
- the member's campaign's Schedule A (`/v1/schedules/schedule_a/`, contributor id = the giver, 60 days before to
  150 days after): what it reports receiving from that giver.

Owner decision (2026-11-25): **drop only the rows whose own filings show the money went elsewhere or was voided;
keep the rest as filed, marked reviewed, and fail the build on any new unreviewed row.** A row missing from the
recipient's report is not, by itself, a reason to drop it: missing is never zero, and a campaign's report can be
late, amended or itemised differently.

## How it is applied

- `pipeline/fec/reviewed_rows.py` `ROWS`: 38 rows by FEC `SUB_ID` (never a name), each with one reason. They are
  dropped as `drop:reviewed_not_received`, straight after the conduit rule, and counted in `meta.json` under
  `exclusions.reviewed_not_received` (`rows`, `dollars`, `by_reason`, `listed`, `not_taken`). `/method` shows the
  count under "Excluded records".
- `pipeline/validate_fec_conduits.py` `ALLOWED_ROWS`: the 13 rows kept as filed. `ENFORCE_HARD` is on: a kept
  pac_money row above $10,000 that is on neither list fails the build. Review it the same way and add it to one
  list; never raise the threshold to pass a build.
- `not_taken` lists ids the rule did not take (gone from the files, or taken by an earlier rule). It is printed and
  never an error. Remove such an id once the FEC file no longer has it.

Reasons (`REASONS` in the module):

| Reason | What the giver's own line shows | Rows | Dollars |
|---|---|---|---|
| `forwarded_earmarks` | Purpose "FORWARD EARMARKED CONTRIBUTIONS" or "EARMARKED CONTRIBUTION", or the donors itemised beside it as "EARMARK FROM: …" memo lines; the campaign lists the money as earmarked receipts through the giver | 14 | 684,543 |
| `other_committee` | Payee is a joint fundraising committee, leadership PAC, party committee or super PAC | 18 | 418,233 |
| `state_or_local_race` | "GOVERNOR'S RACE", or payee "CHICAGO FOR RAHM EMANUEL" | 3 | 84,200 |
| `voided` | Purpose "VOIDED" | 1 | 50,000 |
| `ad_vendor` | Payee is a media company, purpose an advertisement ("BLUNT CAMPAIGN ADS", "ADVERTISEMENT OPPOSING SCHOLTEN") | 2 | 33,365 |
| All | | 38 | 1,270,341 |

MoveOn.org Political Action (`C00341396`, 10 rows) and the Susan B. Anthony List Candidate Fund (`C00332296`, 4
rows) are dropped row by row and are **not** added to the conduit list in `conduits.py`. In the cycle files that
hold these rows, most of their other 24K rows are round direct gifts: MoveOn 2018 has 183 rows, 182 of them round
($535,407 in all), and its 2012 file has 62 round rows of 71. Listing whole cycles would drop those gifts too.

## Dropped (38)

| Date | Giver | Member | Amount | `SUB_ID` | Reason | Payee (purpose) on the giver's Schedule B | Recipient's report from the giver |
|---|---|---|---|---|---|---|---|
| 2006-02-21 | `C00341396` Moveon.Org Political Action | R000568 | $105,295 | 4080420061068110327 | forwarded_earmarks | CIRO D RODRIGUEZ FOR CONGRESS (FORWARD EARMARKED CONTRIBUTIONS) | 38 rows noted as earmarked through the giver |
| 2018-07-03 | `C00488486` Communications Workers Of America - Working  | N000002 | $100,000 | 4082420181586075422 | other_committee | SENATE MAJORITY PAC (FEDERAL PAC CONTRIBUTION 2018) | nothing from the giver |
| 2012-09-13 | `C00341396` Moveon.Org Political Action | B001230 | $98,046 | 4030620131185082313 | forwarded_earmarks | TAMMY BALDWIN FOR SENATE (FORWARD EARMARKED CONTRIBUTIONS) | 547 rows noted as earmarked through the giver |
| 2006-06-29 | `C00341396` Moveon.Org Political Action | M001168 | $88,112 | 4102620061070994873 | forwarded_earmarks | PATRICK MURPHY FOR CONGRESS (FORWARD EARMARKED CONTRIBUTIONS) | nothing from the giver |
| 2012-09-13 | `C00341396` Moveon.Org Political Action | M001169 | $83,209 | 4030620131185082295 | forwarded_earmarks | FRIENDS OF CHRIS MURPHY (FORWARD EARMARKED CONTRIBUTIONS) | 208 rows noted as earmarked through the giver |
| 2008-06-27 | `C00341396` Moveon.Org Political Action | H001049 | $60,519 | 4091120081095743367 | forwarded_earmarks | HAGAN SENATE COMMITTEE INC (FORWARD EARMARKED CONTRIBUTIONS) | 253 rows noted as earmarked through the giver |
| 2006-02-22 | `C00341396` Moveon.Org Political Action | R000568 | $51,559 | 4080420061068110328 | forwarded_earmarks | CIRO D RODRIGUEZ FOR CONGRESS (FORWARD EARMARKED CONTRIBUTIONS) | 38 rows noted as earmarked through the giver |
| 2009-03-11 | `C00027342` International Brotherhood Of Electrical Work | D000607 | $50,000 | 4091020091117979305 | voided | DONNELLY FOR CONGRESS (VOIDED) | $10,000 direct (11C) |
| 2008-06-30 | `C00341396` Moveon.Org Political Action | S001181 | $47,721 | 4091120081095743368 | forwarded_earmarks | JEANNE SHAHEEN FOR SENATE (FORWARD EARMARKED CONTRIBUTIONS) | 94 rows noted as earmarked through the giver |
| 2008-06-30 | `C00341396` Moveon.Org Political Action | S001170 | $42,195 | 4091120081095743366 | forwarded_earmarks | CAROL SHEA-PORTER FOR CONGRESS (FORWARD EARMARKED CONTRIBUTIONS) | 14 rows noted as earmarked through the giver |
| 2026-08-05 | `C00007542` International Association Of Sheet Metal, Ai | B000287 | $39,200 | 4102920261615854495 | state_or_local_race | BECERRA, XAVIER (GOVERNOR'S RACE) | nothing from the giver |
| 2012-08-20 | `C00341396` Moveon.Org Political Action | B001230 | $38,337 | 4030620131185082312 | forwarded_earmarks | TAMMY BALDWIN FOR SENATE (FORWARD EARMARKED CONTRIBUTIONS) | 547 rows noted as earmarked through the giver |
| 2026-09-11 | `C00734822` Growing Georgia | C001129 | $35,000 | 4100620261611986561 | other_committee | MIKE COLLINS VICTORY (POLITICAL DONATION TO JFC) | nothing from the giver |
| 2024-02-12 | `C00869768` Local 18 Water And Power Defense League (Ibe | S001150 | $25,000 | 4030120241877894371 | other_committee | STANDING STRONG PAC (FEDERAL CONTRIBUTION) | nothing from the giver |
| 2024-02-09 | `C00869750` International Brotherhood Of Electrical Work | S001150 | $25,000 | 4030120241877894476 | other_committee | STANDING STRONG PAC (FEDERAL CONTRIBUTION) | nothing from the giver |
| 2020-06-24 | `C00149013` Norton Rose Fulbright Us Llp Federal Committ | C001056 | $25,000 | 4072520201794563330 | other_committee | CORNYN MAJORITY COMMITTEE (JOHN CORNYN) | $3,700 as its share of a joint fundraising transfer (memo, line 12) |
| 2013-09-04 | `C00007542` International Association Of Sheet Metal, Ai | E000287 | $25,000 | 4100120141223703639 | state_or_local_race | CHICAGO FOR RAHM EMANUEL (FEDERAL) | nothing from the giver |
| 2017-06-20 | `C00341396` Moveon.Org Political Action | O000174 | $22,407 | 4072720171439249682 | forwarded_earmarks | JON OSSOFF FOR CONGRESS (FORWARD EARMARKED CONTRIBUTIONS) | 28 rows noted as earmarked through the giver |
| 2020-12-11 | `C00760124` National Victory Action Fund | L000594 | $20,600 | 4121120211385115934 | other_committee | TEAM LOEFFLER (CONTRIBUTION) | $5,600 as its share of a joint fundraising transfer (memo, line 12) |
| 2010-09-02 | `C00405761` Missouri Farm Bureau Federation Statewide Fa | B000575 | $20,094 | 4061020111140730873 | ad_vendor | LEARFIELD COMMUNICATIONS, INC. (BLUNT CAMPAIGN ADS) | nothing from the giver |
| 2023-09-25 | `C00782458` Providence Administrative Consulting Service | M001165 | $20,000 | 4082620242015060127 | other_committee | MCCARTHY VICTORY FUND (CONTRIBUTION) | nothing from the giver |
| 2014-07-23 | `C00007542` International Association Of Sheet Metal, Ai | E000287 | $20,000 | 4082720141221346569 | state_or_local_race | CHICAGO FOR RAHM EMANUEL (FEDERAL) | nothing from the giver |
| 2018-09-10 | `C00372979` Radiance Technologies, Inc. Political Action | S001176 | $20,000 | 4110220181608549285 | other_committee | SCALISE LEADERSHIP FUND (none given) | $5,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2006-02-17 | `C00295360` Sierra Health Services Political Action Comm | E000194 | $18,250 | 4031520061064894587 | other_committee | ENSIGN MAJORITY COMMITTEE THE (2/17/2006 RECEPTION) | $1,250 as its share of a joint fundraising transfer (memo, line 12) |
| 2012-03-26 | `C00038604` American Financial Services Association Pac | L000578 | $15,000 | 4011320161260571479 | other_committee | CPE VICTORY FUND (CONTB) | $5,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2016-03-16 | `C00371385` Alex Lee Inc Pac | R000570 | $15,000 | 4040720161282970879 | other_committee | TEAM RYAN (CONTRIBUTION TO TEAM RYAN) | $10,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2016-03-03 | `C00015933` Pinnacle West Capital Corporation Pac | R000570 | $15,000 | 4052720161293523498 | other_committee | TEAM RYAN ($15,000 NRCC) | nothing from the giver |
| 2016-01-11 | `C00279497` Polaris Industries Political Participation P | R000570 | $15,000 | 4080320161307886846 | other_committee | TEAM RYAN (LEADERSHIP COMMITTEE) | $10,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2007-12-21 | `C00024281` Meat Institute Political Action Committee (' | B000420 | $15,000 | 4091620081095819004 | other_committee | REPUBLICAN NATIONAL COMMITTEE (none given) | nothing from the giver |
| 2026-09-23 | `C00094573` Elect - The Pac Of The Alabama Farmers Feder | B001319 | $15,000 | 4100220261600398534 | other_committee | BRITT SENATE VICTORY (CONTRIBUTION) | nothing from the giver |
| 2014-10-09 | `C00433805` Ccfi Companies Llc (Fka Checksmart Financial | M001156 | $15,000 | 4111820141231568559 | other_committee | MCHENRY LEADERSHIP FUND (CONTRIBUTION TO JOINT FUNDRAISING COMMITTEE) | nothing from the giver |
| 2026-09-25 | `C00943332` West Michigan For Common Sense | S001221 | $13,271 | 4110920261646824317 | ad_vendor | MAYFAIR MEDIA GROUP, LLC (ADVERTISEMENT OPPOSING SCHOLTEN) | nothing from the giver |
| 2022-09-09 | `C00615203` Senior Care Pharmacy Coalition Pac | F000479 | $12,500 | 4101820221589103175 | other_committee | DSCC PA WI VICTORY 2022 (SCPC PAC CONTRIBUTION TO THE DSCC PA WI VICTORY 2022 BENEFFITING JOHN FETTERMAN AND MANDELA BARNES.) | $5,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2008-05-20 | `C00332296` Susan B. Anthony List. Inc. Candidate Fund ( | P000588 | $12,283 | 4011420091104072303 | forwarded_earmarks | PEOPLE FOR PEARCE (EARMARKED CONTRIBUTION) | 54 rows noted as earmarked through the giver |
| 2008-09-24 | `C00332296` Susan B. Anthony List. Inc. Candidate Fund ( | D000601 | $12,120 | 4020420091106954828 | forwarded_earmarks | ELIZABETH DOLE COMMITTEE INC (EARMARKED CONTRIBUTION) | 39 rows noted as earmarked through the giver |
| 2023-10-24 | `C00440651` Denbury Inc Political Committee | D000618 | $11,883 | 4031920241885288025 | other_committee | DAINES SENATE MAJORITY FUND (CONTRIBUTION) | $10,000 as its share of a joint fundraising transfer (memo, line 12) |
| 2018-10-15 | `C00332296` Susan B. Anthony List. Inc. Candidate Fund ( | S000522 | $11,690 | 4061120191657928519 | forwarded_earmarks | FRIENDS OF CHRIS SMITH (EARMARKED CONTRIBUTION) | nothing from the giver |
| 2017-05-23 | `C00332296` Susan B. Anthony List. Inc. Candidate Fund ( | G000584 | $11,050 | 4072820171442270387 | forwarded_earmarks | GREG FOR MONTANA (EARMARKED CONTRIBUTIONS) | nothing from the giver |

Ciro Rodriguez's 2006 campaign shows the MoveOn money as "EARMARKED CONTRIBUTION: SEE BELOW" with the donors
listed; Patrick Murphy's 2006 report lists nothing by MoveOn's committee id, and the row is dropped on the giver's
own purpose ("FORWARD EARMARKED CONTRIBUTIONS"). Rows whose campaign reports "its share of a joint fundraising
transfer" were paid to the joint fundraising committee, which passed part on: that part is a transfer from the
committee, not this PAC's gift, and the PAC's own gift to the joint committee is out of scope.

## Kept as filed (13)

| Date | Giver | Member | Amount | `SUB_ID` | Payee (purpose) on the giver's Schedule B | Recipient's report from the giver |
|---|---|---|---|---|---|---|
| 2010-02-24 | `C00457705` Country First Political Action Committee, In | B001268 | $56,622 | 4032920101124718041 | (no line of this amount) (none given) | $5,000 direct (11C) |
| 2016-04-21 | `C00131219` Rollins Inc Political Action Committee | L000583 | $50,000 | 2120820161357086158 | (no line of this amount) (none given) | $500 direct (11C) |
| 2018-03-22 | `C00394775` Groom Law Group, Chartered Political Action  | R000570 | $25,000 | 2042620181530472549 | RYAN FOR CONGRESS, INC. (LUNCH FUNDRAISER) | nothing from the giver |
| 2024-09-27 | `C00437525` Texas Spine And Joint Ltd Pac | C001098 | $25,000 | 4100720242069224697 | TED CRUZ FOR SENATE (none given) | nothing from the giver |
| 2014-07-29 | `C00432815` Local 399 International Union Of Operating E | E000287 | $25,000 | 4101720141226179175 | EMANUEL, RAHM (CONTRIBUTION) | nothing from the giver |
| 2006-09-08 | `C00412973` Ga-08 Congressional Victory Committee | C000640 | $21,135 | 4100220061069805649 | MAC COLLINS FOR CONGRESS (TRANSFER TO AFFILIATED COMMITTEE) | $21,135 direct (12) |
| 2014-05-02 | `C00017194` International Union Of Operating Engineers L | N000188 | $20,000 | 4061520141215164304 | DONALD NORCROSS FOR CONGRESS (CONTRIBUTION, PRIMARY, SPECIAL PRIMARY, SPECIAL GENERAL, GENERAL ELECTIONS) | $20,000 direct (11C) |
| 2017-07-06 | `C00129742` California Beet Growers Association Ltd Poli | C001097 | $15,094 | 2042720181530585822 | CARDENAS, TONY (GENERAL CONTRIBUTION) | $150 direct (11C) |
| 2007-04-20 | `C00360206` Philadelphia Federal Credit Union Pac (Pfcu- | B001227 | $15,000 | 1091720090000738695 | FRIENDS OF BOB BRADY (CONTRIBUTION/FUNDRAISER) | nothing from the giver |
| 2023-09-07 | `C00224790` Grayrobinson P.A. Political Action Committee | S001200 | $15,000 | 4012520241816510641 | SOTO, DARREN (CONTRIBUTION - US REPRESENTATIVE, DISTRICT  9) | $2,000 direct (11C) |
| 2023-01-02 | `C00830547` Illinois Black Business Political Action Fun | J000309 | $15,000 | 4041920231743310395 | JONATHAN JACKSON FOR CONGRESS (FOR PRIMARY DEBT) | $15,000 direct (11C) |
| 2010-11-17 | `C00410357` Kitpac | B000611 | $12,809 | 4012720111134918788 | (no line of this amount) (none given) | nothing from the giver |
| 2016-10-10 | `C00422527` 613 Pac | K000360 | $12,500 | 4112220161351132702 | KIRK FOR SENATE (none given) | $2,700 as its share of a joint fundraising transfer (memo, line 12) |

Notes on the kept rows:

- **Several elections in one row, matching the campaign:** Norcross 2014 ($20,000, four $5,000 receipts) and
  Jonathan Jackson 2023 ($15,000, three). Mac Collins 2006 ($21,135) is a joint fundraising committee's transfer,
  which the campaign reports on line 12; the giver is not flagged as a joint fundraising committee in the committee
  master, so the row reaches PAC money. It is kept as filed and noted here.
- **Amount differs from the campaign's (probable keying errors, published as filed):** Rollins 2016 (below), California Beet Growers 2017
  ($15,094; campaign $150), GrayRobinson 2023 ($15,000; campaign $2,000), Country First 2010 ($56,622; campaign
  $5,000). A later rule could drop a row whose own filing gives a different amount; until the owner decides, they
  stay.
- **No evidence either way** (campaign reports nothing in the window, payee is the campaign or a person): Groom Law
  Group to Ryan 2018 ("LUNCH FUNDRAISER"), Texas Spine and Joint to Cruz 2024, PFCU to Brady 2007, KITPAC 2010,
  613 PAC to Kirk 2016.
- **Local 399 IUOE to "EMANUEL, RAHM", 2014 ($25,000):** the giver's line names a person, purpose "CONTRIBUTION",
  so it is kept under the owner's rule. But the recipient committee in the row (`C00368829`, Friends of Rahm Emanuel)
  reports $0.00 in receipts for the whole 2014 cycle (OpenFEC committee totals): a filed zero, not a missing record.
  The two Sheet Metal Workers rows to the same committee that cycle name "CHICAGO FOR RAHM EMANUEL" and are dropped.
  Most likely a mayoral-campaign gift; an owner call.
- **Rollins to Loudermilk, 2016:** the bulk file and OpenFEC carry the same `SUB_ID` and page image
  (201610110300102688) with different amounts, $50,000 and $500; the campaign reports $500. The page image decides
  it; until it is read and the owner decides, the site shows $50,000 as the bulk file has it.

## Effect

The 38 rows were all kept as `pac_money` before: $1,270,341 to members no longer counted, most for Ciro Rodriguez
($156,854), Tammy Baldwin ($136,383), Jerrold Nadler ($100,000, the CWA row paid to Senate Majority PAC), Patrick
Murphy ($88,112) and Chris Murphy ($83,209). The count comes from the next full run (`meta.json`
`exclusions.reviewed_not_received`).

## Follow-ups

- MoveOn's and SBA List's other rows with odd amounts below $10,000 in the same cycles (MoveOn 2006: 12 of 28 rows)
  may be forwarded earmarks too; they are in the review report's rows above $5,000, not reviewed.
- Rows that differ in amount between the giver's and the recipient's filings (above), and the Local 399 row.

## When the build fails on a new row

The check "fec conduits: single pac_money row above $10,000 not on the reviewed allow-list" stops the daily run
before anything is published, trades included. New 24K rows above $10,000 arrive with each FEC filing deadline, and an
amended report can give a reviewed row a new `SUB_ID` (the old id then shows in `not_taken`). To clear it:

1. `python -m scripts.ops.review_fec_row <giver id> <recipient committee id> <date> <amount>` prints the giver's
   Schedule B lines (payee, purpose, memo lines) and the campaign's Schedule A receipts from that giver, from OpenFEC
   (needs `FEC_API_KEY`, or the proxy in a cloud session).
2. Add the `SUB_ID` to `reviewed_rows.ROWS` (with a reason) only when the giver's own line shows one of the reasons
   above; otherwise add it to `ALLOWED_ROWS`. Add its row to the tables here, and drop a stale id from `not_taken`.
3. Never raise the threshold, turn `ENFORCE_HARD` off or edit a row's amount to get a build through.
