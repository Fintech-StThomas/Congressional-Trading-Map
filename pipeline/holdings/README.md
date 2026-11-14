# Holdings and net worth (`pipeline/holdings/`)

Assets (Schedule A) and liabilities (Schedule D) from **House** annual financial disclosure reports, and a
"disclosed net worth range" per member and report year. The contract is the "Holdings and net worth" section of
[`docs/data-dictionary.md`](../../docs/data-dictionary.md).

```bash
pipeline/.venv/bin/python -m pipeline.holdings.run        # or: python -m pipeline.run --stage holdings
pipeline/.venv/bin/python -m pipeline.holdings.validate   # add --no-pdf to skip the PDF machine check
```

Reads `pipeline/build/{spine,companies,ticker_orgs}.json`, the SEC ticker file in `pipeline/.cache/sec/`, and the
committed `web/public/data/members/<id>.json` (read-only, for overlaps). Runs **after** `assemble`, which swaps
`web/public/data/` wholesale and would otherwise delete this stage's output. `HF_HOLDINGS_REVISION` pins the dataset
commit (default: its current commit, recorded in `sources/holdings.json`).

| Writes | What |
|---|---|
| `web/public/data/holdings/<bioguide>.json` | `HoldingsFile` per member with at least one used report |
| `web/public/data/holdings-index.json` | one compact row per member |
| `pipeline/build/edges/holdings_owns.jsonl` | `owns` plug-in edges (member -> org), for the assembler to merge later |
| `pipeline/build/orgs/holdings.jsonl` | `OrgSummary` rows for every org those edges reference |
| `pipeline/build/sources/holdings.json` | source (revision, files, sha256, row counts) and the full report: exclusions, joins, ticker resolution, redactions, validation |
| `pipeline/build/holdings_rows.json` | every published asset row, flat, for validation |
| `docs/validation/holdings-sample.csv` | 25 asset rows (seed 20261113) beside the filing URL, machine-checked against the PDF text |

## Source: ZipLime/congress-trading (Hugging Face)

What the pinned revision actually contains (checked against the parquet files, not only the card):

- **House only.** `holdings-house.parquet` and `liabilities-house.parquet`; there are no Senate holdings or
  liabilities files and no Senate annual reports in `filings.parquet` (Senate rows there are PTRs). No Senate
  layer is built; nothing is inferred for senators.
- **Report years 2013-2025** (the year printed as "Filing Year" on the form, which is the year in the PDF path).
  The dataset's `filing_year` column is the year of `as_of_date` (the filing date), not the year covered, despite
  the card; we use the PDF-path year and verified it on sample PDFs.
- **Extraction:** every row is `pdf-inspector+rules/annual` (deterministic parser, `confidence` 1.0 on all rows); no
  LLM rows. Scanned annual reports (`needs_ocr`), reports removed by the Clerk (`source_gone`) and all pre-2013
  report years (`pending`) are not extracted; per-member `coverage` says which years are missing and why.
- **Linking:** each row has `doc_id` and `report_url` (the Clerk PDF), equal to `filings.source_url` for every row.
  `bioguide_id` comes from a name resolver that is null for some members and wrong for some candidates (it gives
  candidates the id of a same-named former member); see the member rules below.
- **Amendments:** no `superseded_by` in these tables; originals and amendments are separate documents.
- **Owner:** the dataset maps a blank owner column *and* unrecognised text to `self`; we publish it as `unspecified`.
- **Values:** official bands; `value_quality = invalid` rows have no value (the form printed None/Undetermined or
  the parser found none); `Spouse/DC Over $1,000,000` is `1,000,001`-open.
- **Tickers:** `ticker_source = disclosed` or `name_lookup`; we keep a ticker only when it is printed in parentheses
  in the asset text.

## Method in one paragraph

Join holdings and liabilities 1:1 to filings (asserted). Assign each document to a member: the dataset's bioguide if
the filing's district is one that member held in the report year or the next; otherwise a unique exact match on
surname + state/district + term; otherwise exclude. Per member and report year, require an annual report ("O") and
use the latest filed document (an amendment if one exists; amendments are full restatements, median row ratio 1.0).
Drop personal residences, redact street addresses, cut locations to city/state. Resolve printed tickers with the
`companies.py` rules. Sum ranges (no midpoints), compute the disclosed net worth range, build the latest-year
portfolio, same-year overlaps with the member's `traded` and `pac_money` edges, and the `owns` plug-in edges.
