# Trade validation sample

`trade-sample.csv` is a fixed random sample (seed 13107) of 25 trades from the site's data, with the original
filing's URL beside the parsed fields. `python -m pipeline.validate` writes the same sample, freshly drawn, to
`pipeline/build/validation_sample.csv`; the copy here is the one people fill in, and no stage overwrites it.
`holdings-sample.csv` and `lda-sample.csv` work the same way (written to `pipeline/build/` by
`python -m pipeline.holdings.validate` and the LDA stage, and copied here only when no copy exists).
It exists so a person can check the data against the source documents.

## How to check a row

1. Open the `url`. House links open the filing PDF directly. Senate links go to efdsearch.senate.gov,
   which asks you to accept its terms of use first.
2. Find the transaction. The number after the last colon in `id` is the row's position in the filing, counting from 0.
3. Compare: `asset`, `ticker`, `date` (transaction date), `owner`, `action` (buy or sell), and `low`/`high` (the amount range).
   `available` is the date the filing became public, not something printed on the trade row.
4. Fill in `checked_by` (your name and the date), `matches_filing` (`yes`, `no` or `partly`), and `comment` (what differed).

## Status

- 7 House filings with a text layer were checked by machine: asset, ticker, date and amount range all matched.
  Owner and action still need a human look.
- 15 House filings are scanned images and 3 are Senate records. These need checking by eye.

A mismatch is worth more than a match: record it, then trace it to the pipeline step that caused it.

## Position timeline checks (15 November 2026)

The fresh local build has 754 House member histories, 53,235 asset timelines and
145,753 transitions between consecutive available reports. The full cache-only
GitHub run produced the same transition distribution:

| Record classification | Transitions |
|---|---:|
| Same band, no trade | 63,119 |
| No longer listed, no sale report found | 20,883 |
| Listed, no purchase report found | 20,412 |
| Bands not comparable | 13,442 |
| Matches a filed trade | 12,349 |
| Band changed, no trade filed | 12,291 |
| Traded, same band | 2,794 |
| Traded between reports, listed in neither | 316 |
| Band moved against the filed trades | 147 |

The most frequent displayed asset names among appearances without a matched
purchase are Vanguard S&P 500 ETF (VOO), 32; iShares Core S&P 500 ETF (IVV), 31;
iShares Core MSCI Emerging Markets ETF (IEMG), 25; Cash, 22; and SPDR S&P 500 ETF
TRUST, 21. This agrees with the expectation that common index funds and cash
accounts appear often. It does not establish why any record differs: thresholds,
exemptions, gifts and changes in account or owner can all matter. These counts are
transitions by displayed name, not unique people or distinct economic issuers.

The validator's deterministic 20-timeline sample is written to
`pipeline/build/timeline-sample.csv`, with annual-report and trade-report URLs.
A missing report remains a gap; a resolved company cannot be replaced by another
same-name issuer. Mutation tests ensure omitted transitions, duplicated asset rows
and incorrect gaps fail validation. Human review of the sample remains open,
separately from the automated checks.

## Lobbying review sample (`lda-review-2026-11.csv`, 26 November 2026)

Lobbying data switches on only after the team signs off on how filings are matched to members (owner decision
2026-11-25). This sample is a fixed random draw (seed 20261126) from a local run of the LDA stage on contribution
reports for 2024 to 2026 and lobbying filings for 2025 and 2026: 143,077 contribution ties and 31,223 revolving-door
ties. It covers every match rule:

| Rule | In the run | Rows here |
|---|---|---|
| Contribution, payee is the member's FEC committee | 255,175 items | 15 |
| Contribution, honoree is the member's full name | 22,342 items | 15 |
| Contribution, payee is the member's full name | 933 items | 10 |
| Revolving door, an office title next to the name ("Rep.", "Senator", "Office of") | 30,438 ties | 15 |
| Revolving door, no office title (weak) | 785 ties | 5 |

The run is a local download (contribution reports 2024 to 2026, filings 2025 and 2026), not the repository's
download state, which `STATUS.md` (sources table) records. Columns: `amount` is the total of the whole tie (every item
between that member and that org or lobbyist, summed), while `evidence` quotes one item of it, so the two differ when
the tie has several items (a $4,000 tie whose quoted item is $1,500). For contribution rows `date` is the quoted item's date.

For each row:
1. Open the `url` (the filing on lda.gov) and find the item or lobbyist quoted in `evidence`.
2. Check that the filing really names this member, the person in `member_name`, and not another person with a similar
   name or a different committee. For revolving door, check that the covered position names this member's office.
3. Fill in `checked_by` (name and date), `matches_filing` (`yes`, `no` or `unclear`) and `comment`.

Worth a close look while checking: a contribution "honoring" a member but paid to a PAC that is not the member's own
(for example a row honoring Roger Marshall paid to Defend Our Conservative Senate PAC), and a covered-position text that
lists several offices, where the match may come from a different segment (a row matched to Roy Blunt from a text naming
Eric Cantor). Any `no` blocks switching the stage on until the rule is fixed and the sample redrawn. Agents do not fill
in this file.
