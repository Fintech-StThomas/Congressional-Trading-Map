# Leadership PAC money in and out (P8)

What each leadership PAC panel shows beside the spending tables: the FEC's own committee summary for a cycle, with the date it
runs to. The type is in `docs/data-dictionary.md` ("Campaign finance block", `PacTotals`); this page holds the field meanings,
the rules, the request budget and the real-data check. Code: `pipeline/fec/totals_api.py`, `pipeline/validate_fec_totals.py`;
site: `web/src/components/member/PacTotals.tsx`, `web/src/lib/domain/finance-totals.ts`.

## Where it comes from

OpenFEC `/v1/totals/pac/` (the same row, with the same field names, as `/v1/committee/{committee_id}/totals/`; checked live for
C00344234 and C00235655). The per-committee endpoint costs one request per committee, about 1,000 for a refresh. `/totals/pac/`
takes any number of `committee_id` filters and a `cycle`, so one request returns up to 100 committees for one cycle. It serves
committee types N, Q, O, V and W, which covers every leadership PAC type seen (N 809, Q 692, O 3 of 1,507 designation-D committees);
a committee of another type has no row and gets `totals: null`.

## What each figure is

Each is the cumulative total for the committee and cycle up to `coverage_end_date`, as the FEC summarises the committee's reports.
Dollars to the cent; `null` when the FEC field is blank or negative. A real zero is published as 0.

| Published key | OpenFEC field | Meaning |
|---|---|---|
| `receipts` | `receipts` | All money in: contributions, transfers, refunds received and other receipts. |
| `disbursements` | `disbursements` | All money out. Operating expenditures, contributions to other committees, refunds and other disbursements are the parts the FEC totals separately. |
| `contributions_to_committees` | `fed_candidate_committee_contributions` | Contributions the PAC made to federal candidates and other federal committees (Form 3X line 23). `contributions`, `other_political_committee_contributions` and `political_party_committee_contributions` are money *received* and are not used. |
| `operating_expenditures` | `operating_expenditures` | Operating spending (Form 3X line 21): one part of disbursements. |
| `contribution_refunds` | `contribution_refunds` | Refunds of contributions the PAC paid out (line 28). |
| `other_disbursements` | `other_disbursements` | Other disbursements (line 29), for example transfers. |
| `cash_on_hand` | `last_cash_on_hand_end_period` | Cash at the end of the last report covered. |
| `coverage_end_date` | `coverage_end_date` | The date the figures run to (`2026-10-14T00:00:00` becomes `2026-10-14`). |

The four parts often but not always add up to `disbursements`. PAC to the Future 2026: 5,833,520.61 + 1,196,000.00 + 65,986.75 +
971,548.00 = 8,067,055.36 exactly; 2024 is $247.06 short. Across 6,265 cached summaries the four parts differ from disbursements by more
than $1 in 675 (10.8%): other Form 3X lines (transfers to affiliated committees, independent expenditures, loans and loan repayments) are
outside the four. Example: C00536540 2026 is short exactly its `transfers_to_affiliated_committee`, $26,200.00. The site does not add
anything up and never claims the parts sum to the total: every figure is the FEC's own.

## Rules

- **Null, never zero.** No row for the committee-cycle, a failed request, no key, a row of another cycle, no readable coverage date
  or no figure at all: `totals: null`. One blank or negative figure: that figure is `null` and the rest stay. A negative figure is listed
  in `meta.reports.fec_spending.totals.negative_figures_not_published` (72 in 6,323 summaries live).
- **A coverage date outside the cycle is null.** The endpoint returns rows whose `coverage_end_date` falls outside the cycle's two years
  (2024 C00672204 ends 2025-06-30; 2022 C00561472 ends 2023-03-31). The validator rejects such a date, so these summaries are not published
  (`totals: null`) and are listed in `coverage_date_outside_cycle`. A date later than the build day (a 2026 row dated 2026-12-31 exists)
  is kept and listed in `coverage_date_after_build_day`.
- **Published as the FEC summarises them.** In 12 of 6,323 live summaries operating expenditures or contributions exceed
  disbursements by more than $1 (a filing inconsistency the FEC summary carries). They are published and listed in
  `parts_exceed_disbursements` of the same report; nothing is corrected.
- **A PAC-year is never created by totals.** Like the purpose groups, totals ride on a (committee, cycle) that already has operating
  expenditure rows, so a cycle where a PAC raised money but had no operating rows has no entry.
- **Totals only.** No payee, donor or row is read. The validator's privacy walk covers the new keys.
- **Exact committee ids only.** The request is for the committee ids already linked to a member by exact sponsor id.
- **Wording.** "Money in and out, as summarised by the FEC", "through <date>", "not reported". No colour beyond the neutral tokens, and no
  statement about any payment or contribution.

## How the figures relate (the line on the panel)

The purpose groups (`purposes`) cover the committee's disbursements. Operating expenditures are one part of them, next to
contributions to other committees, refunds and other disbursements, so "operating expenditures" and "groups total" are different
figures. The category table comes from the FEC's operating-expenditure bulk file, which is built from processed reports and can end on
a different date than the committee summary.

## Cache and requests

Cache `pipeline/.cache/fec/api/totals_<cycle>.json` = `{retrieved, cycle, committees: {id: totals or null}}`. The two latest cycles
are refetched after 12 hours, older cycles after 7 days, a committee missing from a fresh cache at once; a cached `null` (the FEC had
no row) is not asked again until the cycle goes stale. A failed refresh keeps the cached figures and is reported as stale. Without
`FEC_API_KEY`, with `PT_CACHE_ONLY=1` or on any API failure the daily job still publishes, with `totals: null` for what is not cached.
Requests are sequential: a batch is one request, so concurrency would only add rate-limit risk.

| Case | Requests |
|---|---|
| Normal day (2024 and 2026 refetched) | at most 22: requests follow the committees asked (at most 1,082 linked, so at most 11 batches a cycle), not those with a summary; about 18 expected |
| Weekly (older cycles stale) / cold start, all twelve cycles | at most 132 (12 x 11); about 69 expected |
| Asking every designation-D PAC in every cycle (measured 2026-11-24) | 193, 18,048 committee-cycles asked, 6,323 with a summary |
| Per-committee endpoint instead | about 1,082 for a refresh |

The shared per-run hard stop is now 500 (was 400): a cold run is committees 16 + purpose groups 253 + totals up to 132.

## Real-data check (2026-11-24, OpenFEC through a proxy-injected key)

Our values are the same API rows the FEC committee page shows. "Operating, site" is the operating-expenditure file's spending total
used by the existing category table; "groups" is the sum of the FEC purpose groups.

| Committee | Cycle | Receipts | Disbursements | To other committees | Operating (FEC) | Cash on hand | Through | Operating, site | Groups, site |
|---|---|---|---|---|---|---|---|---|---|
| C00344234 PAC to the Future (Pelosi) | 2024 | 7,955,839.73 | 8,313,286.18 | 2,070,210.78 | 4,320,038.44 | 9,929,082.07 | 2024-12-31 | 4,320,250.07 | 8,271,515.58 |
| C00344234 | 2026 | 3,811,921.29 | 8,067,055.36 | 1,196,000.00 | 5,833,520.61 | 5,673,948.00 | 2026-10-14 | 5,702,401.52 | 7,730,690.32 |
| C00235655 Bluegrass Committee (McConnell) | 2024 | 1,296,928.82 | 1,512,862.76 | 580,000.00 | 643,262.76 | 170,864.14 | 2024-12-31 | 651,122.05 | 1,509,694.35 |
| C00235655 | 2026 | 278,966.32 | 434,547.89 | 9,500.00 | 184,347.89 | 15,282.57 | 2026-10-14 | 178,423.10 | 385,623.10 |
| C00536540 Jobs, Freedom, and Security PAC (Cruz) | 2024 | 3,479,994.29 | 1,000,133.29 | 443,300.00 | 502,531.11 | 2,597,995.99 | 2024-12-31 | 502,531.11 | 996,581.11 |
| C00536540 | 2026 | 1,276,112.87 | 1,694,137.77 | 345,000.00 | 1,036,987.77 | 2,179,971.09 | 2026-10-14 | 952,559.74 | 1,604,709.74 |
| C00693796 Buckeye Liberty Political Action Committee (Jordan) | 2024 | 805,660.17 | 743,446.78 | 321,300.00 | 389,630.78 | 185,377.93 | 2024-12-31 | 388,589.19 | 742,405.19 |
| C00693796 | 2026 | 1,360,452.75 | 1,404,209.32 | 1,195,500.00 | 202,209.32 | 141,621.36 | 2026-10-14 | 168,256.91 | 1,363,756.91 |
| C00366781 Buckeye Liberty PAC, C00542100 House Liberty Fund (Jordan) | 2024, 2026 | no summary row | | | | | | none | none |

Jordan's other two PACs have no committee summary and no operating rows in these cycles, so they show no panel for them.

**PAC to the Future 2026.** The new totals give FEC operating expenditures of $5,833,520.61 through 14 Oct 2026 against $5,702,401.52 on
the site (the earlier review's $5,702,402), a gap of $131,119.09. The totals explain it: the operating-expenditure file's rows for this
committee end on 30 Sep 2026 (the October monthly report), while the FEC summary also includes the Pre-General report to 14 Oct, whose
operating spending is $130,542.94; the remaining $576.15 is within the FEC's offsets and rounding between line-item rows and the
report total (in 2024 the file is $211.63 above the summary). The panel therefore shows the date the summary runs to; it does not show
the date the operating file runs to, which is a possible follow-up (a latest-transaction date per PAC-year). The purpose groups
($7,730,690.32) are $336,364.64 below disbursements ($8,067,055.36), of which the Pre-General report's disbursements ($295,903.44) are the larger part; the rest is not
explained here. The groups are not meant to equal operating expenditures, which is the point of the note on the panel.

## What this does not show

Not who gave or who was paid, not whether a figure is right beyond what the FEC reports, and not a statement about any contribution or
payment. A cycle in progress ends at its coverage end date; a committee that filed nothing for a cycle has no row.
