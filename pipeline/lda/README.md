# LDA module (`pipeline/lda/`)

Lobbying Disclosure Act data from the official REST API (https://lda.gov/api/v1/; docs https://lda.gov/api/,
terms https://lda.gov/api/tos/). The Senate Office of Public Records cannot vouch for the data; it is used as filed.
Rules and output formats are in `docs/data-dictionary.md` ("Lobbying").

| File | Role |
|---|---|
| `download.py` | rate-limited (<=100 req/min, 429 Retry-After honoured, retries with backoff), resumable page cache |
| `match.py` | strict member identification (FEC committee names, title-stripped full names, covered positions) |
| `build.py` | reference data (spine, FEC committee index snapshot, company names, overrides), cache reading |
| `edges.py` | amendment and double-reporting rules; `lobbyist_money` and `revolving_door` edges |
| `run.py` | stage entry: writes `build/edges/lda.jsonl`, `build/orgs/lda.jsonl`, `build/sources/lda.json`, `docs/validation/lda-sample.csv` |

## API facts used

- `page_size` max 25; Filings and Contribution Reports need a filter to page past page 1 (we page by `filing_year`).
- 120 requests/minute with a key, 15 anonymous. With `LDA_API_KEY` set the client sends `Authorization: Token <key>`.
- Any filter on contribution items (`contribution_type`, `contribution_amount_min`) makes a page take 18-40 s and
  `contribution_amount_min` inflates `count` (a join); so every LD-203 report of a year is read (~0.9 s a page,
  ~1,550 pages a year). `ordering=dt_posted` is stable.
- Filings: `lobbyist_covered_position_indicator=true` narrows LD-2 filings to ~26-44k a year (~1,000-1,770 pages).

## Running

```
python -m pipeline.lda.download --only contrib --contrib-years 2019-2026     # resumable; rerun to continue
python -m pipeline.lda.download --only filings --filing-years 2019-2026
python -m pipeline.lda.download --estimate                                    # pages per year
python -m pipeline.lda.run                                                    # parse the cache (no network)
python -m pipeline.lda.run --download --new-window --max-minutes 45           # daily job
```

Cache: `pipeline/.cache/lda/pages/<slice>/<year>/upto-<cutoff>/p00001.json.gz` + `state.json`; `windows.json`
lists posting cutoffs. A later window starts one day before the previous cutoff (overlap, deduplicated by uuid).
Extending the year range backwards just adds slices. Coverage per year is `full` only when all its slices are complete.
