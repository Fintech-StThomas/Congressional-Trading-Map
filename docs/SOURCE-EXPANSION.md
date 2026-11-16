<!-- Feasibility survey of the not-started data sources (STATUS.md): access, terms, joins, coverage, volume, privacy, order. -->
# Source expansion: feasibility survey

Survey date: 2026-11-16. Scope: every source STATUS.md lists as "not started" except prediction markets (which need bills
first). Written for the owner and for whoever builds the next source. Project rules applied throughout (STATUS
"Decisions already made", data dictionary "Identifiers" and "Rules"): a tie needs a filed record naming both ends or a
published statistical rule; names are never matched by similarity; amounts are ranges as filed; no wrongdoing language.

**How to read the evidence.** "Verified" means a small real request made in this session (section 2, with endpoint,
date and what came back). Everything else is taken from the official documentation cited in section 3 and is marked
**not re-verified this session**: it was not fetched, so read it as a lead to check, not a finding. No figure appears
here that was not observed in a request or derived from one.

**Joinable** below means a source field holds an identifier that equals one of ours exactly: bioguide id (member), FEC
candidate or committee id, CIK (`co:`), ticker (matched by the existing exact rules), congressional committee code.
A source whose only link is a name is marked **not joinable under project rules** unless a human-reviewed crosswalk
(like `org_overrides.csv`) supplies the exact key.

## 1. Headline conclusions

1. **FEC spending and loans is the most ready.** Exact candidate and committee ids, same publisher and pipeline module
   as the money already live, verified fields for loans (`personally_funded`, balances) and disbursement categories. The
   limit is volume (the API cannot be paged for bulk use) and privacy of payee and lender addresses, so use the bulk files.
2. **House votes and bill sponsorship are exact and cheap, but yield facts, not ties.** House roll calls list every
   member by bioguide id. Senate roll calls are not in the Congress.gov API (404 verified). Whether a bill "affects" a held
   or donor company has no exact key; that needs a reviewed topic-to-sector map, so publish votes only as plain records.
3. **Senate annual reports are the largest value and the hardest to automate.** The Senate eFD site requires accepting
   terms before use and has no API. Do not scrape it. Any automation is an owner or counsel decision (section 3.1).
4. **Three sources cannot join to our identifiers by exact key today:** SEC insider filings (no link from a Form 4 owner to
   a member or relative), earmarks (recipients and, for the Senate, members are named in text) and sponsored travel
   (sponsors and filers are named in text). USAspending contracts join only after a reviewed UEI-to-company crosswalk exists.
5. **`legislates_with` has no builder.** It is declared (`pipeline/contract.py`, data dictionary, site wording) but no stage
   in `pipeline/` produces it, so Congress.gov co-sponsorship would not duplicate anything. It would also need a published
   rule and baseline (a derived edge), which is an owner decision. The pilot therefore produces a fact table only.
6. **Cost of Congress.gov per-member lists is dominated by history.** Lists cover every Congress, are ordered by last update
   and have no Congress filter, so the five-member pilot took 39 requests. Longer-serving senators cost more (section 2).

**Recommended order**

| # | Source | Why here | Gate before building |
|---|---|---|---|
| 1 | FEC spending, loans | exact ids, existing module, verified fields | bulk files not API; decide payee/lender privacy rules |
| 2 | Votes and bills (House first) | exact bioguide ids, verified | fact table only; owner rule if any tie is wanted |
| 3 | Committee hearings with historical committee membership | hearings key on exact committee codes; needs dated rosters | find a dated roster source (3.4); reviewed committee-to-sector map |
| 4 | Senate annual reports | biggest gap | owner and counsel decision on terms; reviewed fixture set done by hand |
| 5 | USAspending contracts | official ids, no key needed (not re-verified) | reviewed UEI-to-company crosswalk; dated parent ownership |
| 6 | Earmarks | 2022 on, small volume | exact-key plan for members and recipients |
| 7 | Sponsored travel | `paid_travel` type already declared | own PDF parsing; names only |
| 8 | Stock prices | measure only, no tie | dated ticker history; vendor terms; wording review |
| 9 | SEC insider filings | not joinable | an exact link between a filer and a member or relative |

Rows 1 and 2 can start in parallel. Row 4 outranks 3 in value but waits on a decision, not on engineering.
Each source starts with a small reviewed set (plan gate "New sources"): the Congress.gov pilot (section 4) is the template.

## 2. Verified in this session (2026-11-16)

All with a descriptive generic User-Agent and a placeholder key that the session proxy replaces; no key was stored.

**Congress.gov API v3** (`https://api.congress.gov/v3/`). Response header `X-Ratelimit-Limit: 20000` was present.

| Endpoint | Result |
|---|---|
| `member/{S000148,T000250,J000299,J000294,W000779,P000197}` | 200 for each; `bioguideId`, `currentMember`, `partyHistory`, `terms` (119th Congress term), and all-time `sponsoredLegislation.count` / `cosponsoredLegislation.count` |
| `member/congress/119?currentMember=true&limit=250` | `pagination.count` 539 current members; terms list `startYear` and `chamber` |
| `congress/current` | 119th Congress; sessions begin 2025-01-03 |
| `member/J000299/sponsored-legislation?limit=3` and `.../cosponsored-legislation?limit=2` | count 75 sponsored, 668 cosponsored (all Congresses); items carry `congress`, `type`, `number`, `introducedDate`, `latestAction`, `policyArea`, `title`, `url` |
| same lists with `fromDateTime=2025-01-03T00:00:00Z` (member S000148) | count unchanged (2,456 sponsored, 8,130 cosponsored): the filter is ignored |
| pilot paging (T000250 sponsored) | a 114th-Congress item appears among 119th items: ordered by last update, not by Congress |
| `bill/119/hr/3`; `bill/119/hr/3/cosponsors?limit=1` | `sponsors[].bioguideId` present; cosponsors count 0 for that bill |
| `house-vote/119/1?limit=1` | count 362 roll calls; item has `rollCallNumber`, `legislationType/Number`, `result`, `sourceDataURL` (Clerk XML), `startDate` |
| `house-vote/119/1/240/members` | `results[]` with `bioguideID`, `voteCast`, `voteParty`, `voteState` |
| `senate-vote/119/1` | **404** `{"error":"Unknown resource"}`: no Senate roll calls in this API |
| `committee-meeting/119?limit=1`; `.../senate/338842` | count 2,817; detail has `committees[].systemCode` (e.g. `ssva00`), `date`, `title`, `type`, `meetingStatus` (this one `Scheduled`, a future date) |
| `hearing/119?limit=1` | count 1,111; list items have `chamber`, `jacketNumber`, `number`, `updateDate`, `url` (detail not fetched) |
| `committee/house?limit=1` | count 455 committee and subcommittee records; `systemCode` such as `hsbu00` |

**OpenFEC API** (`https://api.open.fec.gov/v1/`).

| Endpoint | Result |
|---|---|
| `candidates/?q=Thune&per_page=1` | 200; `candidate_id` `H6SD00085` (2 results): a person has one id per office run for |
| `schedules/schedule_b/` (disbursements) filtered by an arbitrary committee id and 2024 period | **504 "Query timed out"**: heavy filters fail, so the API is not a bulk path |
| `schedules/schedule_b/` for 2024-03-01..2024-03-02 | count 145,650 (exact) for two days; fields include `candidate_id`, `committee_id`, `recipient_committee_id`, `disbursement_purpose_category`, `disbursement_amount`, `pdf_url`; recipient and payee fields hold names and cities |
| `schedules/schedule_c/` (loans), 2024 period | count 765,271 (`is_count_exact` false); fields include `candidate_id`, `committee_id`, `personally_funded`, `original_loan_amount`, `loan_balance`, `payment_to_date`, `loan_source_name` and lender street, city and zip fields |

**LDA API** (`https://lda.gov/api/v1/`; the existing, switched-off module's source): `filings/?filing_year=2026&page_size=1`
returned count 83,566; `contributions/?filing_year=2026&page_size=1` count 20,027; the issue-code constants list answered. Used only
to confirm the endpoint is reachable.

**Pilot run** (section 4): 39 requests for five members; the longest list was 12 pages. Observed all-time counts imply
43 requests for Schumer (2,456 sponsored, 8,130 cosponsored) and 44 for Wyden (2,043 and 8,698) at 250 per page.

## 3. Source by source

Common columns first, then the detail. "Years" are what the source covers, not what we would load.

### 3.1 Senate annual reports (holdings, net worth for senators)

- **Access.** Senate Electronic Financial Disclosure search (`https://efdsearch.senate.gov/search/home/`). Reports are
  viewed through the site; there is no public API (not re-verified). Our trade data already links to this site
  (validation README).
- **Terms.** The site asks a visitor to accept a terms-of-use statement before searching (repository docs; wording not
  re-read this session). Federal law restricts use of the data: 5 U.S.C. 13107(c) bars unlawful, commercial (other than news
  media) and solicitation use, which is why STATUS decides the site is free and ad-free. Practical meaning for automation:
  the acceptance is made by a person, and a script that simulates it is acting on a person's agreement without a person
  reading it. **Do not scrape or script the acceptance.** Options for the owner: a person downloads a reviewed fixture set by
  hand; ask the Secretary of the Senate's office in writing whether automated access is permitted; or use a third-party
  extraction (as the House holdings do) after its licence and accuracy are checked.
- **Identifiers.** None of ours. Reports are keyed to a filer name and state (not re-verified). Joining requires a reviewed
  filer-to-bioguide crosswalk (about 100 current senators plus former ones), built from the filing's own text, not similarity.
  Holdings then need the same exact ticker or reviewed-override rules as House holdings. Status: **joinable only through a reviewed crosswalk.**
- **Coverage, cadence, volume.** Not re-verified. Annual reports are due once a year; STATUS says the House side needed our own parsing of PDFs.
- **Adds.** Holdings, liabilities and net-worth ranges for senators (the largest gap in "Known gaps").
- **Privacy.** Same as House holdings (data dictionary "Privacy"): minors redacted where the filing indicates one; no street addresses or residences.

### 3.2 Votes and bills

- **Access.** Congress.gov API for bills, sponsors, cosponsors and House roll calls (verified). Senate roll calls: not in
  that API (404). The Senate publishes roll-call XML on senate.gov (not re-verified); Clerk XML for the House is linked
  from each House vote's `sourceDataURL`.
- **Terms.** API key required, rate header 20,000 (verified header; the time unit is documented at
  `https://api.congress.gov/` and the GitHub docs, not re-verified). Content is government data; read the terms page before bulk use.
- **Identifiers.** House vote members: `bioguideID`, exact (verified). Bill sponsors: `bioguideId`, exact (verified).
  Senate votes would join through the Senate's own member id; congress-legislators carries such ids (`id.lis`), but I did not
  check that our spine keeps them or that the field is complete: **not re-verified**.
- **Coverage.** The 119th Congress was verified; earlier Congresses were not. Member lists reach back at least to the 114th.
- **Cadence, volume.** Updated as the chamber acts (hearing and meeting lists carried `updateDate` of 2026-11-15/16).
  House session 1 of the 119th has 362 roll calls, and member votes are one request per roll call. Bill lists: see section 2 for the per-member cost. A per-Congress bulk bill-status download exists at GovInfo (not re-verified) and is the sensible bulk path.
- **Adds.** A member's votes and sponsorships as plain records. A "vote on a bill affecting a held or donor company"
  tie has no exact key: bills carry a policy area, not a company or sector. It would need a reviewed map from policy area to
  sector and a published threshold, i.e. a derived measure with a baseline. Not recommended before the facts are reviewed.
- **Privacy.** None beyond public records of members.

### 3.3 Committee hearings

- **Access.** Congress.gov `hearing/{congress}` and `committee-meeting/{congress}` (verified lists and one meeting detail).
- **Identifiers.** Meetings name committees by `systemCode` (`ssva00`). congress-legislators uses a committee id plus a
  subcommittee suffix (`cmte:SSVA` style, see `spine.py`), so an exact mapping is likely but **was not checked**. Meeting
  topics are free text, so the tie "trades shortly before a hearing on that industry" cannot be keyed by title. The unit has
  to be committee, with a reviewed committee-to-sector map, and a dated roster (3.4).
- **Coverage, volume.** 119th: 2,817 meetings, 1,111 hearings (counts at 2026-11-16, which include scheduled future meetings). Earlier Congresses not checked.
- **Adds.** Dates a committee met; with 3.4 and trades, a timing measure over counts, never "trades before hearings" as an accusation.
- **Privacy.** Witness names appear in some records (detail not fetched): a witness is a private person; do not publish witnesses.

### 3.4 Historical committee membership

- **Access.** Our spine reads `committee-membership-current.yaml` from congress-legislators, which is current only. I found no
  historical roster in the repository's sources. Candidates, all **not re-verified**: snapshots of that file in the
  congress-legislators git history; the Congressional Directory on GovInfo (per Congress, committee rosters); House and Senate
  committee pages. The Congress.gov member record verified here shows no committee assignments.
- **Identifiers.** Directory text names members, not ids: a roster would need a name-to-bioguide step, which project rules forbid unless reviewed. Git-history snapshots keep bioguide ids and are therefore the exact option, but cover only dates the file existed.
- **Terms.** Public records (not re-verified for each candidate).
- **Adds.** The dated membership that "sector held versus sector overseen" (Next item 6) needs. Without it the measure would use today's committees for past years, which the accuracy gate on dated identity rules out.
- **Privacy.** None.

### 3.5 Federal contracts (USAspending)

- **Access.** `https://api.usaspending.gov/` and bulk award archives (not re-verified; documented as open without a key).
- **Identifiers.** Recipient UEI and parent UEI; no CIK and no ticker. Our org ids are `co:<CIK>`. A UEI-to-company link
  exists in no source we hold, so a reviewed crosswalk (new `source` type in `org_overrides.csv`) is the only exact route;
  name matching is not joinable. Parent-subsidiary ownership changes over time, which the "dated identity" gate also requires.
- **Coverage, cadence, volume.** Not re-verified. Very large (every federal award); a small reviewed set of recipients is the realistic start.
- **Adds.** Federal money won by a company a member holds or is funded by. A separate quantity (obligations), never summed with holdings or contributions; no causal wording.
- **Privacy.** Recipients are mostly organisations; individuals receive some awards (do not publish individual recipients).

### 3.6 FEC spending and loans

- **Access.** OpenFEC API (verified) and FEC bulk files (the pipeline already downloads bulk files; the bulk operating-expenditure
  and loan files were not re-verified). The API timed out on a heavy filter and holds 145,650 disbursements for two days,
  so use bulk files.
- **Terms.** API key; FEC data may not be used to solicit contributions or for commercial purposes (52 U.S.C. 30111(a)(4); not re-verified, check before launch). Consistent with the site's existing stance.
- **Identifiers.** `candidate_id` and `committee_id` are exact and already in the spine (`fec_ids`) and the FEC module's
  committee index. Payee names (campaign payments to family or member-owned firms) are free text: **not joinable under project
  rules**, and only a reviewed list could support it. `recipient_committee_id` is exact when the payee is a committee.
  Loans: `personally_funded` and `candidate_id` identify a member's loan to their own campaign without any name.
- **Coverage, cadence, volume.** Schedule B and C span the 2000 to 2026 cycles already loaded for contributions (the API
  showed 2024 and 2026 data; the earliest cycle was not checked). Filings arrive continuously. Volume: see section 2.
- **Adds.** Leadership PAC spending by FEC category (`disbursement_purpose_category`), loans a member made to their own campaign with balance and repayment (Next item 7).
- **Privacy.** Schedule C and B rows carry lender and payee street addresses and individual names. Never publish addresses (data dictionary "Privacy"); decide whether individual payees follow the existing independent-expenditure payee rule or are aggregated. Do not publish family-member payments by inference.

### 3.7 Earmarks (2022 on)

- **Access.** House Appropriations Committee community project funding disclosures and Senate member requests (published per member and bill; formats not re-verified). No Congress.gov endpoint was found in this session's checks.
- **Identifiers.** Requests name the member as filed (House with state and district), the recipient by name and address. Members could be keyed by chamber, state, district and Congress against the spine (a structured office lookup, to be approved as exact); Senate requests name the senator. Recipients: exact normalised name or reviewed override only. **Partly joinable; recipient side needs review.**
- **Coverage.** Starts with fiscal 2022 (STATUS). Volume not verified; small relative to other sources.
- **Adds.** "Money a member directed to a named recipient". Request is not award: show requested amounts as requests, never as money received.
- **Privacy.** Recipient addresses are organisation addresses mostly; never publish street addresses.

### 3.8 Sponsored travel

- **Access.** Travel reports are filed with the Clerk of the House and the Secretary of the Senate (Senate through the same terms-gated site as 3.1). Records disappear after four years (STATUS), so any collection must be incremental and archived. Format not re-verified; likely PDF, own parsing.
- **Identifiers.** Filer and sponsor are names. **Not joinable under project rules** without a reviewed crosswalk. The edge type `paid_travel` is already declared in `contract.py`; no stage builds it.
- **Privacy.** Reports can name staff, spouses and children as travellers: apply the minor redaction rule and never publish itineraries beyond what the filing states for the member; no personal residences or addresses.

### 3.9 SEC insider filings

- **Access.** EDGAR Forms 3, 4 and 5 and the SEC's insider-transaction data sets (not re-verified; the SEC enforces fair-access limits, and the pipeline already honours 10 requests a second for the company list).
- **Identifiers.** Issuer CIK is exact (`co:`). Reporting owner CIK is exact but belongs to a person, and no field links that person to a member or relative. The only link is name. **Not joinable under project rules**; a reviewed owner-to-member crosswalk built from a filing that names both ends (for example a member's own disclosure naming a spouse's director role) would be needed.
- **Adds.** Family members who are corporate insiders. Without an exact link it would assert relatives from name coincidence, which the project forbids.
- **Privacy.** High: it would tie private individuals to companies. Not recommended.

### 3.10 Stock prices

- **Access.** No primary source: prices come from vendors or exchanges (not re-verified). Terms commonly restrict redistribution; check per vendor before any use in published output.
- **Identifiers.** Ticker matches by our exact rule, but dated ticker-to-company histories are required (a reassigned or delisted ticker returns the wrong series). The existing ticker veto and "delisted tickers do not resolve" gap apply directly.
- **Adds.** Returns from the disclosure date against a benchmark (Next item 8): a measure, not a tie. Needs a method statement, a benchmark choice, wording that avoids advice or implied fault, and dated price evidence (a price source is not a filed record).
- **Privacy.** None.

## 4. Pilot module (Congress.gov sponsorship, off by default)

Code `pipeline/congress/`, tests `pipeline/tests/test_congress.py`, contract in the data dictionary. Design:

- **Reviewed set.** Five current members by bioguide id: T000250 (Senate, R), J000299, F000482 (House, R), J000294, W000831 (House, D). Each id was fetched from `member/<id>` on 2026-11-16: `bioguideId` matched, `currentMember` true, 119th-Congress term. This is a mechanical check; it is not a human review of the choice.
- **Gate.** `PT_ENABLE_CONGRESS=1` required. Off: one printed line, no network, no files. The pipeline stage `congress` is a no-op unless enabled and then reads cache only.
- **Output.** `pipeline/build/congress/member_bills.jsonl` (member, role, bill id, introduced date, policy area, title, URLs), `report.json`, and with `--sample` a review CSV plus, once, `docs/validation/congress-sample.csv` with empty reviewer columns. No plug-in file is written, so nothing reaches `web/public/data`.
- **Identity.** Exact bioguide id only, checked on the returned member record; the member must be current and, if `spine.json` exists, in it.
- **Run on 2026-11-16.** 39 requests; 767 facts for the 119th Congress after dropping 6,089 items from other Congresses and 95 Senate amendments (not bills); 0 duplicates; sample of 30 rows awaits human review (none has been done). Per member (sponsored, cosponsored): T000250 58 and 69; J000299 9 and 3; J000294 5 and 32; W000831 28 and 404; F000482 17 and 142. Pairs of pilot members with bills in common: F000482 and W000831 13; J000294 and W000831 19; F000482 and J000294 2; F000482 and J000299 1. These are counts of records, not ties.
- **Why no `legislates_with` edge.** See conclusion 5: nothing builds it today, so this does not duplicate a source, but a rule is missing, and a pair measure over five members would be meaningless.

## 5. Open questions for the owner

1. Senate eFD: may automation be used at all (3.1), or should the Senate reports come from a person-driven fixture set or a reviewed third-party extract?
2. If `legislates_with` is wanted: which bills count, what shared-count threshold, which baseline (the `traded_together` rule is the model)?
3. Payees and lenders in FEC schedules: publish individuals as filed (as independent-expenditure payees are) or aggregate?
4. Who reviews `docs/validation/congress-sample.csv`, and what error rate lets the pilot grow to every current member?

## 6. Documentation consulted (cited, access date 2026-11-16; none fetched this session unless listed in section 2)

- Congress.gov API: https://api.congress.gov/ and https://github.com/LibraryOfCongress/api.congress.gov (endpoints verified live in section 2; documentation text not re-read)
- OpenFEC: https://api.open.fec.gov/developers/ and bulk data https://www.fec.gov/data/browse-data/?tab=bulk-data
- LDA: https://lda.gov/api/ and https://lda.gov/api/tos/
- Senate eFD: https://efdsearch.senate.gov/search/home/
- House financial disclosure and travel: https://disclosures-clerk.house.gov/
- USAspending API: https://api.usaspending.gov/
- SEC EDGAR insider forms: https://www.sec.gov/edgar and the insider-transactions data sets under https://www.sec.gov/data-research
- GovInfo bulk data (bill status, Congressional Directory): https://www.govinfo.gov/bulkdata
- congress-legislators: https://github.com/unitedstates/congress-legislators
- 5 U.S.C. 13107(c) (use restriction on disclosure data), as cited in STATUS.md
