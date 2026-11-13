# Data pipeline

Builds the JSON the site reads from `web/public/data/`. The binding description of every output file, type and
rule is [`docs/data-dictionary.md`](../docs/data-dictionary.md).

## Run

```bash
python3.13 -m venv pipeline/.venv
pipeline/.venv/bin/pip install -r pipeline/requirements.txt
pipeline/.venv/bin/python -m pipeline.run                    # every stage, then validation
pipeline/.venv/bin/python -m pipeline.run --stage assemble   # one stage (repeat --stage for several)
pipeline/.venv/bin/python -m pipeline.validate               # validation only; exits 1 on failure
pipeline/.venv/bin/python -m pytest -q pipeline/tests        # unit tests
```

Run from the repository root. Downloads are cached in `pipeline/.cache/` and reused; intermediate files go to
`pipeline/build/` (both gitignored). Optional environment variables: `SEC_USER_AGENT` (default
`congressional-trading-map-class-project research@example.org`), `HF_REVISION` (pin the trades dataset to a commit
instead of its current one), and `FEC_API_KEY` / `LDA_API_KEY`, which the FEC module may read. Nothing fails when they
are absent.

`.github/workflows/data.yml` runs the whole pipeline daily and on manual dispatch. It commits `web/public/data/` back to
the branch only when validation passes and some file other than `meta.json` changed.

## Stages

| Stage | Module | Writes (under `pipeline/build/` unless noted) |
|---|---|---|
| `spine` | `spine.py` | `spine.json` (bioguide -> name, party, terms, committees, FEC ids), `committees.json`, `sources/legislators.json` |
| `trades` | `trades.py` | `trades.parquet` (current version of every trade event, contract enums), `sources/hf_trades.json` |
| `companies` | `companies.py` | `ticker_orgs.json`, `companies.json`, `company_names.json`, `sources/sec.json` |
| `fec` | `fec/` (maintained separately) | `edges/fec_*.jsonl`, `orgs/fec.jsonl`, `sources/fec.json` |
| `edges_trades` | `edges_trades.py` | `trades_resolved.parquet`, `edges/trades.jsonl` (`traded`, `traded_together`), `orgs/trades.jsonl` |
| `edges_committees` | `edges_committees.py` | `edges/committees.jsonl` (`sits_with`) |
| `assemble` | `assemble.py` | every file in `web/public/data/`, built in a staging directory and swapped in |
| `holdings` | `holdings/` (see its README) | `web/public/data/holdings/<id>.json`, `web/public/data/holdings-index.json` (after `assemble`, which would otherwise delete them), `edges/holdings_owns.jsonl`, `orgs/holdings.jsonl`, `sources/holdings.json` |
| `validate` | `validate.py` | checks the output; writes `validation_sample.csv` (25 trades, fixed seed, with filing URLs) |

New sources plug in without code changes: write `edges/<source>.jsonl`, `orgs/<source>.jsonl` and
`sources/<source>.json` as described at the end of the data dictionary. The assembler picks up every file there.

Hand-reviewed org matches go in `crosswalk/org_overrides.csv` (`source, source_id_or_name, org_id, note, reviewed_by,
reviewed_on`). `companies.py` applies rows with `source = ticker`, and a row without a reviewer and date is an error.

## Sources and licences

| Source id | What | Revision recorded | Licence |
|---|---|---|---|
| `legislators` | [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators): current and historical legislators, current committees and membership | gh-pages commit SHA (via `git ls-remote`), file SHA-256s | CC0 / public domain |
| `hf_trades` | [austin-starks/congressional-stock-trades](https://huggingface.co/datasets/austin-starks/congressional-stock-trades) on Hugging Face: House Clerk and Senate eFD periodic transaction reports | dataset commit SHA, `snapshot.json` time, each parquet file's SHA-256 (checked against `snapshot.json`) | Public records with a statutory use restriction (below) |
| `sec` | SEC `company_tickers_exchange.json` and the Financial Statement Data Sets (`sub.txt`, for SIC codes) | Last-Modified, SHA-256, quarters used | U.S. government work |
| `fec` | FEC bulk data (see `pipeline/fec/`) | per-file Last-Modified and SHA-256 | U.S. government work |

**Use restriction (from the trades dataset's LICENSE_DATA.md).** The trade data is derived from financial disclosure
reports made public by the Clerk of the House and the Secretary of the Senate. It is not under an open licence. Under
5 U.S.C. 13107(c) it is unlawful to obtain or use a covered report (1) for any unlawful purpose; (2) for any commercial
purpose, other than by news and communications media for dissemination to the general public; (3) for determining or
establishing the credit rating of any individual; or (4) directly or indirectly in the solicitation of money for any
political, charitable, or other purpose. This site is a free, non-commercial public information project and must stay
that way: no ads, no paid tiers, no fundraising, no credit uses. The pipeline never visits efdsearch.senate.gov and
never accepts a site's click-through terms; it only reads the published dataset.

## Known limitations

- **House coverage starts in 2014.** The trade dataset's House filings begin 2014-01-02, so House trades from
  2012-2013 are mostly missing (a few appear because they were filed late). Coverage marks those years `none`.
- **Most House rows have no asset type.** House filings before about 2017, and many after, give no asset type code,
  so 69% of trades have `asset_class = "unknown"`. We do not infer classes from names. For `traded_together` only,
  an unlabelled trade counts when its ticker resolves to an SEC operating company (with a SIC code and not a fund or
  commodity pool).
- **Owner is often not stated** (26% of trades, mostly House). Those stay `unspecified`. They are never shown as the member's own trades.
- **Tickers come from the dataset.** About 45% are printed on the filing and 55% were resolved by the dataset from the
  asset name (`ticker_source`); 18% of trades have no ticker and get no org.
- **SEC matching uses today's tickers.** Delisted, merged and renamed companies (FB, CELG, ATVI, TWTR, ...) stay as
  `tk:` nodes. Symbols that now belong to a different issuer are vetoed. The veto also catches some renames of the
  same company (ATNI, UHAL, MD), which can be fixed in `org_overrides.csv`.
- **Amounts are ranges.** Sums keep lows and highs apart. An open-ended range ("over $1,000,000") or a missing amount
  makes the upper bound null.
- **Committees are current only.** `sits_with` reflects the current Congress. Historical assignments are not loaded.
- **Publication budget.** Not every money tie is published with its evidence (see the data dictionary). Every tie
  stays in `pipeline/build/`, and totals cover all of them.
- **Late flag.** `late` compares public availability with the transaction date (more than 45 days). The legal
  deadline runs from the notification date, so a few flagged trades may have been filed on time.
- **Memory.** Assembly holds every edge in memory: about 4-6 GB with the full FEC plug-in.
