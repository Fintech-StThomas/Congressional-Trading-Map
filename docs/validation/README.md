# Trade validation sample

`trade-sample.csv` is a fixed random sample (seed 13107) of 25 trades from the site's data,
written by `python -m pipeline.validate`, with the original filing's URL beside the parsed fields.
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
