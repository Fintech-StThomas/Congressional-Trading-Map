# Campaign receipts per cycle (detail for the data dictionary)

The contract is in `docs/data-dictionary.md`, "Campaign finance block" (`CampaignFinance.receipts`, `ReceiptsRow`). This page holds the
column mapping, the rules for odd rows and the real-data comparison. Code: `pipeline/fec/receipts.py`, `pipeline/validate_fec_receipts.py`.

## Source and mapping

The FEC all-candidates summary (`weball<yy>.zip`), the file the loans already come from, one row per candidate id and cycle. Layout:
<https://www.fec.gov/campaign-finance-data/all-candidates-file-description/>. A row belongs to a member only through its exact `CAND_ID`
(one of the member's FEC ids, presidential `P` ids included). The first row per (cycle, id) is used, as for loans. Dollars to the cent.

| Field | weball column | What the FEC means |
|---|---|---|
| `total_receipts` | `TTL_RECEIPTS` | Total receipts of the candidate's authorised committees for the cycle (includes loans and transfers) |
| `from_individuals` | `TTL_INDIV_CONTRIB` | Contributions from individuals, one total |
| `from_other_committees` | `OTHER_POL_CMTE_CONTRIB` | Contributions from other political committees (PACs and the like) |
| `from_party_committees` | `POL_PTY_CONTRIB` | Contributions from party committees |
| `from_candidate` | `CAND_CONTRIB` | Contributions from the candidate |
| `transfers_from_authorised` | `TRANS_FROM_AUTH` | Transfers from the candidate's other authorised committees |
| `total_disbursements` | `TTL_DISB` | Total disbursements |
| `cash_on_hand` | `COH_COP` | Cash on hand at the close of the coverage period |
| `through` | `CVG_END_DT` | Coverage end date; the figures cover the cycle up to it |

The weball file has no itemised/unitemised split of individual contributions (OpenFEC `/candidate/{id}/totals/` has one; it is not read).
The pipeline never reads the individual-contributions (`indiv`) file, so no contributor name, employer, occupation or address is read or published.

## Rules for odd rows (all counted in `meta.reports.fec_spending.receipts`)

- Blank is `null`, never 0. A zero is published only when the file says 0.
- A negative `total_receipts`, `total_disbursements` or contribution figure is `null` (listed under `negative_figures_not_published`), as for loans.
  `cash_on_hand` is published as filed: it is negative in about 5% of rows (a committee can report spending ahead of receipts).
- If `from_individuals`, `from_other_committees`, `from_party_committees`, `from_candidate` or `transfers_from_authorised` is more than $1 above
  `total_receipts`, all five are `null` (listed under `components_exceed_total_not_published`) and the total stays as filed. The five do not sum to the
  total: loans, offsets and other lines are in the total only, and party contributions are a separate column from other committees in the file.
- The validator checks the published rows: numbers or null, non-negative except `cash_on_hand`, `through` a real calendar date, no component above the
  total by more than $1, same (cycle, id) rows as `loans`.

## Real-data check (2026-11-24, weball 2018 to 2026 as cached; OpenFEC `/v1/candidate/{id}/totals/`)

The three members' rows for 2018, 2020, 2022, 2024 and 2026 (15 rows) matched OpenFEC on `receipts`, `individual_contributions`,
`other_political_committee_contributions`, `political_party_committee_contributions`, `candidate_contribution`,
`transfers_from_other_authorized_committee`, `disbursements`, `last_cash_on_hand_end_period` and `coverage_end_date`, to the cent. OpenFEC's
`individual_itemized_contributions` plus `individual_unitemized_contributions` equals the weball individual total in the rows checked. Across all
20,049 candidate rows of those five files the validator reports no failure; 109 negative figures and 40 rows whose breakdown exceeds the total are not published.

| Member (candidate id) | Cycle | Total receipts (both) | From individuals (both) | Cash on hand (both) |
|---|---|---|---|---|
| P000197 (H8CA05035) | 2022 | 25,577,528.17 | 22,325,274.59 | 3,593,728.76 |
| P000197 (H8CA05035) | 2024 | 10,223,363.88 | 9,554,439.66 | 2,078,066.46 |
| C001098 (S2TX00312) | 2018 | 35,409,076.68 | 29,234,222.19 | 157,958.64 |
| C001098 (S2TX00312) | 2024 | 74,050,030.94 | 67,435,723.31 | 1,786,707.20 |
| M000355 (S2KY00012) | 2020 | 68,094,902.86 | 59,868,152.25 | 6,811,701.29 |
| M000355 (S2KY00012) | 2026 | 278,697.13 | 18,653.82 | 7,385,931.53 |

## What this does not show

Summary totals of the candidate's authorised committees, not individual contributors, not a leadership PAC or a party or outside group's money,
and not a statement about any contribution. A cycle in progress ends at its coverage end date.
