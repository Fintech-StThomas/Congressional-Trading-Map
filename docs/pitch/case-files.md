<!-- Pitch material: three worked examples for the live demo, each checked against the original public filings. -->

# Case files for the demo

Three trades from live release `4a04a60b…` (published 2026-11-26 by data run 45859146178; checked against a local
build of the same inputs, built 2026-11-26T04:03:21Z; the three trades and their flags are identical in both;
flags method `flags-3`). Each one meets three or four of the published review rules.

**A flag is a prompt for reporting, not a finding.** It means a fixed, published rule was met. It does not say why
the trade was made, what the member knew, or whether any rule or law was broken. The trades belong to the household
unless the filing says the member owns the asset. Amounts are the disclosed ranges.

Checks were made on 2026-11-26. House PTR PDFs and the Clerk's yearly index (`<year>FD.zip`, field `FilingDate`)
were fetched from disclosures-clerk.house.gov. FEC records were fetched from OpenFEC (schedule A on the recipient
side, schedule B on the giver side). SEC filings came from data.sec.gov submissions. Senate eFD pages were **not**
opened: their terms of use must be accepted by a person, so those rows are marked "needs a human check". FEC
`docquery` image links returned HTTP 403 from the checking environment; their image numbers match OpenFEC's
`image_number`, but the images themselves were not opened.

Site paths use the latest data. The permalinks below are pinned to release `4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02`
(`/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/...`), so a later data refresh cannot change them.

---

## Case 1: Michael A. Rulli (R-OH), Eli Lilly, buy, 2026-01-02

### What the filing shows

| Field | Site (`trades/R000619.json`) | House PTR 20035147 |
|---|---|---|
| Trade id | `house:20035147:12` | row "Eli Lilly and Company Common Stock (LLY) [ST]" |
| Asset | Eli Lilly and Company Common Stock (LLY), stock, org `co:59478` | same |
| Type | buy | P |
| Transaction date | 2026-01-02 | 01/02/2026 (notification 01/02/2026) |
| Owner | unspecified | Owner column blank |
| Amount | $1,001–$15,000 | $1,001 - $15,000 |
| Account | not stored | "Merrill Lynch Managed Account" |
| Made public | 2026-08-07 | Clerk index FilingDate 8/7/2026; signed 08/07/2026 |
| Lag | 217 days, late | 2026-08-07 minus 2026-01-02 = 217 days |
| Amended / counted | not amended; counted | Filing status "New" |

Filing: <https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035147.pdf>

The same filing lists 32 transactions dated from 2024-11-26 to 2026-08-06, all in the Merrill Lynch managed account.
It also lists two sales of Eli Lilly stock, on 2025-12-02 and 2026-07-01, each $1,001–$15,000.

### Rules met

- **`late`** (made public after 45 days): `{lag_days: 217}`.
- **`pile_on`** (several members, same stock, within 7 days): `{members: [K000383, M001190], observed: 2, expected: 0.616}`.

  | Member | Date | Direction | Owner | Range | Filing |
  |---|---|---|---|---|---|
  | Sen. Angus S. King, Jr. (K000383) | 2025-12-29 | buy | spouse | $1,001–$15,000 | [eFD d7cae837](https://efdsearch.senate.gov/search/view/ptr/d7cae837-f73c-4eb1-b9fb-e510f53d65de/) |
  | Sen. Markwayne Mullin (M001190) | 2025-12-29 | buy | joint | $15,001–$50,000 | [eFD b195126e](https://efdsearch.senate.gov/search/view/ptr/b195126e-7bb2-4d54-baf5-e6fc8e7a0165/) |

  *What the baseline means:* if each member who bought Eli Lilly in the year around this trade had bought on random
  days, about 0.6 of them would be expected within 7 days of 2026-01-02; two were.
- **`money_both_ways`** (company PAC gave in the same cycle): edge `02d19ccab162`, Eli Lilly and Company Political
  Action Committee (C00082792) to **Rulli for Ohio (C00858415), the campaign committee**, not his leadership PAC.
  One record in the 2025–2026 cycle: $1,000 dated 2026-04-17 on the PAC's report (FEC transaction `52307593`,
  image 202605189866980876). The campaign's own report dates the receipt 2026-05-05 (transaction
  `AEFD05908C79C4EEB863`, image 202608179899537183). The gift is dated after the trade; the rule counts any gift in
  the same two-year cycle.
- **`sector_overseen`** (sector of a committee seat): `{committee: cmte:HSIF}`, House Committee on Energy and
  Commerce. `pipeline/crosswalk/committee_sectors.csv` maps it to SIC prefixes 12, 13, 283, 29, 384, 46, 48, 49, 80,
  on House Rule X clause 1(f) ("biomedical research and development; health and health facilities", among others).
  Eli Lilly's SIC code is **2834, Pharmaceutical Preparations** (SEC EDGAR), which starts with 283. The committee
  table is a draft for team review, and committee seats are the current roster applied back to 2025-01-03.

### Company filings around the trade (context, not a flag)

No 8-K from Eli Lilly within 30 days either side of 2026-01-02 (`orgs/c7.json` `sec_events`, coverage complete).
The nearest are 2025-11-21 (item 5.02) and 2026-02-04 (items 2.02, 9.01), per SEC EDGAR.

### Show live

- `/m/R000619?t=house%3A20035147%3A12#trades` (open "Around this trade")
- `/flags`
- `/o/co%3A59478`
- Permalinks: `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/m/R000619`, `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/o/co%3A59478`

### What a reporter would check next

1. Ask the office who manages the Merrill Lynch account and whether the member directs its trades.
2. Ask why the 32 transactions, some dated November 2024, were reported on 2026-08-07, and whether an extension applied.
3. Confirm the date Rep. Rulli joined Energy and Commerce, because the roster is not dated.
4. Compare with his amended 2024 annual report (filed 2026-08-10) and 2025 annual report (filed 2026-08-11).

---

## Case 2: Kevin Hern (R-OK), Microsoft, buy, 2020-03-26

### What the filing shows

| Field | Site (`trades/H001082.json`) | House PTR 20016419 |
|---|---|---|
| Trade id | `house:20016419:5` | row "Microsoft Corporation (MSFT) [ST]" |
| Asset | Microsoft Corporation (MSFT), stock, org `co:789019` | same |
| Type | buy | P |
| Transaction date | 2020-03-26 | 03/26/2020 (notification 03/27/2020) |
| Owner | joint | JT |
| Amount | $250,001–$500,000 | $250,001 - $500,000 |
| Made public | 2020-04-16 | Clerk index FilingDate 4/16/2020; signed 04/16/2020 |
| Lag | 21 days, not late | 2020-04-16 minus 2020-03-26 = 21 days |
| Amended / counted | not amended; counted | Filing status "New" |

Filing: <https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20016419.pdf>

### Rules met

- **`large_amount`**: `{low: 250001}`.
- **`pile_on`**: `{members: [M001204, R000307, C001114, G000583, R000582], observed: 9, expected: 2.836}`. The detail
  names the five nearest in time; nine other members bought Microsoft within 7 days.

  | Member | Date | Direction | Owner | Range | Filing |
  |---|---|---|---|---|---|
  | Daniel Meuser (M001204) | 2020-03-26 (six rows) | buy | dependent / spouse | $1,001–$15,000 and $15,001–$50,000 | [PTR 20019267](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2021/20019267.pdf), public 2021-08-11 |
  | Sen. Pat Roberts (R000307) | 2020-03-26 and 2020-03-24 | buy | spouse | $1,001–$15,000 each | [eFD 6bbd9f3b](https://efdsearch.senate.gov/search/view/ptr/6bbd9f3b-986f-45ca-925e-b7e8ecad9d0e/) |
  | John R. Curtis (C001114) | 2020-03-27 | buy | unspecified | $15,001–$50,000 | [PTR 20016299](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20016299.pdf) |
  | Josh Gottheimer (G000583) | 2020-03-24 | buy | unspecified | $50,001–$100,000 | [PTR 20016373](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20016373.pdf) |
  | David P. Roe (R000582) | 2020-03-23 | buy | joint | $100,001–$250,000 | [PTR 8217121](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/8217121.pdf) (scanned) |

  The other four counted in `observed`: Kurt Schrader (2020-03-31), Suzan K. DelBene (spouse, 2020-03-31), Thomas R.
  Suozzi (2020-03-20), Sen. Kelly Loeffler (joint, 2020-03-19).

  *What the baseline means:* given how often each of these members traded Microsoft in the year around the trade,
  about 2.8 of them would be expected within 7 days of any given day by chance; nine were. March 2020 was a week of
  market-wide moves, which the baseline does not account for.
- **`money_both_ways`**: edge `c38f15979599`, Microsoft Corporation Stakeholders Voluntary PAC - MSVPAC
  (C00227546; named "Microsoft Corporation Political Action Committee" on the 2020 reports) to **Hern for Congress
  (C00636092), the campaign committee**. One record in the 2019–2020 cycle: $1,000 dated 2020-06-25 on the PAC's
  report (transaction `B5783067639867929F2`, image 202007209250418983). The campaign's report dates the receipt
  2020-06-30 (transaction `SA11C.6755`). The edge holds five records from 2020 to 2026, $11,500 in all.

### Company filings around the trade (context, not a flag)

From `orgs/b1.json` `sec_events`, matched on SEC EDGAR:

| Filed | Items | Link |
|---|---|---|
| 2020-02-26 | 7.01, 9.01 | [8-K](https://www.sec.gov/Archives/edgar/data/789019/000119312520050232/d896577d8k.htm) |
| 2020-03-13 | 5.02, 9.01 | [8-K](https://www.sec.gov/Archives/edgar/data/789019/000119312520073072/d884867d8k.htm) |
| 2020-03-31 | 7.01, 9.01 | [8-K](https://www.sec.gov/Archives/edgar/data/789019/000119312520091746/d909204d8k.htm) |

### Show live

- `/m/H001082?t=house%3A20016419%3A5#trades`
- `/flags`
- `/o/co%3A789019`
- Permalinks: `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/m/H001082`, `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/o/co%3A789019`

### What a reporter would check next

1. Ask the office whether the joint account is self-directed or managed, and by whom.
2. Read the rest of PTR 20016419: it lists other purchases dated 2020-03-26.
3. Check whether the nine other members use the same adviser or the same kind of managed account.
4. Pull MSVPAC's full giving for the 2020 cycle (OpenFEC schedule B, committee C00227546) to see how many members it
   gave to.

---

## Case 3: Suzan K. DelBene (D-WA), Microsoft, buy, 2018-12-13

### What the filing shows

| Field | Site (`trades/D000617.json`) | House PTR 20011611 |
|---|---|---|
| Trade id | `house:20011611:0` | first row, "Microsoft Corporation (MSFT) [ST]" |
| Asset | Microsoft Corporation (MSFT), stock, org `co:789019` | same |
| Type | buy | P |
| Transaction date | 2018-12-13 | 12/13/2018 (notification 12/13/2018) |
| Owner | joint | JT |
| Amount | $1,000,001–$5,000,000 | $1,000,001 - $5,000,000 |
| Made public | 2019-05-08 | Clerk index FilingDate 5/8/2019; signed 05/08/2019 |
| Lag | 146 days, late | 2019-05-08 minus 2018-12-13 = 146 days |
| Amended / counted | not amended; counted | Filing status "New" (the filing's three bond rows are "Amended") |

Filing: <https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2019/20011611.pdf>

### Rules met

- **`late`**: `{lag_days: 146}`.
- **`large_amount`**: `{low: 1000001}`.
- **`money_both_ways`**: edge `3630f024616b`, MSVPAC (C00227546) to **DelBene for Congress (C00459099), the campaign
  committee**. Three records in the 2017–2018 cycle, $7,500 in all (`by_year`: 2017 $5,000 from 2 records, 2018
  $2,500 from 1):

  | PAC report date | Amount | FEC transaction (giver) | Campaign report date | FEC transaction (recipient) |
  |---|---:|---|---|---|
  | 2017-06-12 | $2,500 | `296C1CF45AABB3EF0F2` | 2017-06-29 | `C11418813` |
  | 2017-10-17 | $2,500 | `C73DB4E08DBEA9763CE` | 2017-11-27 | `C11437932` |
  | 2018-03-19 | $2,500 | `534F5B9A5E7B7CA9A7B` | 2018-03-30 | `C11460360` |

  The edge holds 15 records from 2013 to 2025, $47,500 in all. Its evidence list publishes 5 of them, none in this
  cycle, so the "Around this trade" panel shows "$7,500, 3 records" without links to those three. Open them from
  OpenFEC during the demo.

### Company filings around the trade (context, not a flag)

| Filed | Items | Link |
|---|---|---|
| 2018-11-29 | 5.07 | [8-K](https://www.sec.gov/Archives/edgar/data/789019/000119312518337951/d646680d8k.htm) |

### Show live

- `/m/D000617?t=house%3A20011611%3A0#trades`
- `/flags`
- `/o/co%3A789019`
- Permalinks: `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/m/D000617`, `/r/4a04a60becab07cd64f1ed31a3b4a2fa6b589021679a7b7a353f8e9760fa7e02/o/co%3A789019`

### What a reporter would check next

1. Ask the office why the 2018-12-13 purchase was reported on 2019-05-08, and whether an extension applied.
2. Compare with the 2018 annual report (filed 2019-05-15) and the 2019 report (filed 2020-08-10) for the size of the
   Microsoft position before and after.
3. Ask who manages the joint account.
4. Check other years: the member's other Microsoft trades are in the same table, and MSVPAC's records to her
   campaign run from 2013 to 2025.

---

## Verification table

| # | Claim | Source | Status |
|---|---|---|---|
| 1.1 | Rulli LLY buy, 01/02/2026, $1,001–$15,000, type P | [PTR 20035147](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035147.pdf) | verified |
| 1.2 | Owner | same | verified: column blank on the filing; the site shows "unspecified" |
| 1.3 | Made public 2026-08-07; lag 217 | [2026FD.zip](https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip) | verified |
| 1.4 | King LLY buy 2025-12-29, spouse, $1,001–$15,000 | [eFD d7cae837](https://efdsearch.senate.gov/search/view/ptr/d7cae837-f73c-4eb1-b9fb-e510f53d65de/) | needs a human check (Senate eFD terms) |
| 1.5 | Mullin LLY buy 2025-12-29, joint, $15,001–$50,000 | [eFD b195126e](https://efdsearch.senate.gov/search/view/ptr/b195126e-7bb2-4d54-baf5-e6fc8e7a0165/) | needs a human check (Senate eFD terms) |
| 1.6 | pile_on observed 2, expected 0.616 | recomputed from `web/public/data/trades/*.json` | verified (recomputed exactly) |
| 1.7 | Lilly PAC $1,000 to Rulli for Ohio, 2026-04-17, txn 52307593 | [OpenFEC schedule B](https://api.open.fec.gov/v1/schedules/schedule_b/?committee_id=C00082792&recipient_committee_id=C00858415&two_year_transaction_period=2026&api_key=DEMO_KEY) | verified; recipient side dates it 2026-05-05 |
| 1.8 | Rulli sits on Energy and Commerce | `members/R000619.json` roster | needs a human check (date he joined is not in the data) |
| 1.9 | HSIF covers SIC 283 under Rule X 1(f) | `pipeline/crosswalk/committee_sectors.csv` | needs a human check (draft table; Rule X wording paraphrased) |
| 1.10 | LLY SIC 2834 | [SEC EDGAR CIK 59478](https://data.sec.gov/submissions/CIK0000059478.json) | verified |
| 1.11 | No LLY 8-K within 30 days | same | verified |
| 2.1 | Hern MSFT buy 03/26/2020, JT, $250,001–$500,000, P | [PTR 20016419](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2020/20016419.pdf) | verified |
| 2.2 | Made public 2020-04-16; lag 21 | [2020FD.zip](https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2020FD.zip) | verified |
| 2.3 | Meuser, Curtis, Gottheimer rows | PTRs 20019267, 20016299, 20016373 | verified |
| 2.4 | Roe MSFT buy 2020-03-23, $100,001–$250,000 | PTR 8217121 (scanned, no text layer) | needs a human check |
| 2.5 | Roberts MSFT buys 2020-03-24 and 03-26 | [eFD 6bbd9f3b](https://efdsearch.senate.gov/search/view/ptr/6bbd9f3b-986f-45ca-925e-b7e8ecad9d0e/) | needs a human check (Senate eFD terms) |
| 2.6 | pile_on observed 9, expected 2.836 | recomputed from trade files | verified (recomputed exactly) |
| 2.7 | MSVPAC $1,000 to Hern for Congress, 2020-06-25 | [OpenFEC schedule B](https://api.open.fec.gov/v1/schedules/schedule_b/?committee_id=C00227546&recipient_committee_id=C00636092&two_year_transaction_period=2020&api_key=DEMO_KEY) | verified; recipient side dates it 2020-06-30 |
| 2.8 | Three MSFT 8-Ks, 2020-02-26 to 2020-03-31 | SEC EDGAR CIK 789019 | verified |
| 3.1 | DelBene MSFT buy 12/13/2018, JT, $1,000,001–$5,000,000, P | [PTR 20011611](https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2019/20011611.pdf) | verified |
| 3.2 | Made public 2019-05-08; lag 146 | [2019FD.zip](https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2019FD.zip) | verified |
| 3.3 | MSVPAC three $2,500 gifts in the 2018 cycle | [OpenFEC schedule A](https://api.open.fec.gov/v1/schedules/schedule_a/?committee_id=C00459099&contributor_id=C00227546&two_year_transaction_period=2018&api_key=DEMO_KEY) and schedule B | verified |
| 3.4 | MSFT 8-K 2018-11-29, item 5.07 | SEC EDGAR CIK 789019 | verified |
| all | FEC filing images (docquery links) | docquery.fec.gov | needs a human check (HTTP 403 from the checking environment) |

No claim was found to differ from the filings.

Checked by: ____ (team)
