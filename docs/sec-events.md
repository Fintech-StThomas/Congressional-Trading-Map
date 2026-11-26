# SEC Form 8-K events

The `sec_events` stage (`pipeline/sec_events/`) records when the public companies members traded filed a Form 8-K
(or an amendment, 8-K/A) with the SEC, which items each filing reports, and a link to it. It is context for a trade,
not a finding about it: an 8-K is a company's own report of an event, and a trade near one says nothing about what the
member knew. The site reads it in a per-trade panel listing the company's 8-K filings in the 30 days either side of
the trade. It is not a review flag: the draft 8-K rule was met at chance rate and dropped (`docs/review-flags.md`,
"Considered and not used as a flag"). The binding
shapes are in [`data-dictionary.md`](data-dictionary.md), "SEC 8-K events".

## Source

The SEC EDGAR submissions API, `https://data.sec.gov/submissions/CIK##########.json` (10-digit, zero-padded CIK), a
U.S. government work. `filings.recent` holds a company's most recent filings (at least one year, or 1,000 filings);
older filings are on the pages listed in `filings.files` (`https://data.sec.gov/submissions/<name>`), each listed with
`filingFrom`, `filingTo` and `filingCount`. Fields read: `form`, `filingDate`, `acceptanceDateTime`,
`accessionNumber`, `items`, `primaryDocument`.

Fair access: at most 8 requests a second (`SEC_REQUESTS_PER_SECOND`, one limiter shared by the stage's 4 threads),
which leaves headroom under SEC's limit of 10; a 429 or 503 answer is retried after its `Retry-After` (seconds or a
date), with exponential backoff as the floor and 120 s as the ceiling (util.fetch). The User-Agent is `SEC_USER_AGENT`
(util.user_agent), as for every SEC request in the pipeline; branch runs, which have no such secret, send
`congressional-trading-map-class-project research@example.org`.

## Rules

- **Companies.** Every `co:<CIK>` org that is the `org` of at least one counted trade (a trade a later filing marks
  Deleted is not counted) in `pipeline/build/trades_resolved.parquet`. The CIK is the one in the org id, which comes
  from the exact ticker match in `companies.py`; no name is ever compared. `tk:` orgs (no SEC match) have no CIK and
  no events.
- **How far back.** A company needs filings from 30 days before its earliest counted trade (transaction date, else the
  availability date; a company with an undated trade needs everything), never before 2011-12-02
  (`SEC_EVENTS_FROM`, 30 days before 2012). Older pages are read newest first and only while a page's `filingTo` is
  within 7 days of that date or later (a listed `filingTo` can be a day off the page's own dates).
- **Events.** Rows whose form is exactly `8-K` or `8-K/A`; the form value marks an amendment. `date` is the
  `filingDate`, `accepted` the `acceptanceDateTime` (UTC as SEC gives it; null when blank), `items` the
  comma-separated `items` split into codes such as `2.02`, `accession` the accession number, and `url`
  `https://www.sec.gov/Archives/edgar/data/<CIK without zeros>/<accession without dashes>/<primaryDocument>` (the
  filing's folder when `primaryDocument` is blank). Sorted by date, then acceptance time, then accession; an accession
  appears once.
- **Coverage.** `coverage[cik] = {from, to, complete}`: `from` is the earliest `filingDate` read (any form), raised to
  2011-12-02; `to` the latest. Every filing between them was read, so a company with complete coverage and no 8-K in a
  period filed none in that period. `complete` is true when every page the company needs was read; false when an older
  page failed, and then `from` is where the unbroken span read so far begins. Paging stops at the first failed page, so
  a span never has a hole.
- **Failures.** A company whose submissions file could not be read (network, HTTP 404/403/429/5xx after util.fetch's
  retries, unreadable JSON, no filings) has no `coverage` and no `events` entry and is listed in `report.failed` with
  the error; a partial company is listed there too. After 10 failed companies in a row (`SEC_EVENTS_MAX_STREAK`) the
  stage stops asking and lists the rest as "not attempted". Anything else that breaks the stage removes
  `sec_events.json` and `sources/sec_events.json` (`pipeline/run.py`), so the build always finishes and never carries an
  earlier run's coverage.
- **Org files.** `OrgFile.sec_coverage` is the company's coverage entry and `OrgFile.sec_events` the events within 30
  days (`SEC_EVENT_WINDOW_DAYS`, inclusive) before or after the transaction date of any counted trade in that company;
  a trade without a transaction date opens no window. A not-counted trade opens no window either, so for such a trade
  an empty list says nothing: the site never says "no 8-K" for it. Both fields are absent when the company has no coverage, when the
  stage did not run, and in releases built before it. Readers must treat absence as "not available" and must also check
  that a trade's window lies inside `[from, to]` (and `complete`) before saying "no 8-K".
- **Report.** `report.companies` targets, `requests` responses downloaded, `cached` responses read from
  `pipeline/.cache/sec/submissions/` (a retry is not counted twice), `failed`, and `events` (all events in the file).
  The same counts, with the failure count and the first 25 failures, go to `meta.json.reports.sec_events`, and the
  source to `meta.json.sources.sec_edgar_submissions`.

## Limits

- **Foreign issuers** report on Form 6-K, not 8-K, so their lists are empty with complete coverage: "no 8-K filed",
  not "no company news". The same holds for funds and trusts that do not file 8-Ks.
- **The current registrant only.** A ticker resolves to the CIK that holds it in SEC's current list (with the
  reassignment veto in `companies.py`); filings by a predecessor under another CIK are not included.
- **Filing date, not event date.** An 8-K is due within four business days of the event; `date` is when the SEC
  received it. An 8-K accepted after the filing cut-off carries the next business day's `filingDate`; `accepted` gives
  the exact time.
- **Items** are SEC codes (Form 8-K instructions: 1.01 material agreement, 2.02 results of operations, 5.02 officers
  and directors, 7.01 Regulation FD, 8.01 other events, 9.01 exhibits, ...). The stage does not read the documents.
- **Freshness.** A company's submissions file is reused for up to a day (`SEC_SUBMISSIONS_MAX_AGE`), older pages for
  30 days; a cached older page whose filing count no longer matches its listing is downloaded again.
  `PT_CACHE_ONLY=1` reuses every cached response.

## Cost (measured 2026-11-25)

A live run over the 2,145 companies of the published release (trades of 2026-11-25), from an empty cache:
3,125 requests (2,145 company files and 980 older pages) in 313 s, at the then 10-a-second limit (now 8: about 6.5 minutes); 0 failures, 0 partial;
283,796 events (6,165 of them 8-K/A), every item code `d.dd`, every event with a primary document. Re-run within a day:
0 requests, 3,125 cached, 9 s. A normal daily run downloads each company file again (about 2,145 requests, about
4.5 minutes at 8 a second) and reuses the older pages. The cache holds 564 MB under `pipeline/.cache/sec/submissions/`, which the
daily job restores with the rest of `pipeline/.cache`; `pipeline/build/sec_events.json` is 64 MB (not published).

Publication budget: the org files gain `sec_coverage` for 2,145 companies and 76,984 windowed events, 17.5 MB in all
(about 227 bytes an event, about 7% on the 247 MB tree; 256 shards, so about 68 KB per shard on average). Most of an
event is its `url`, which the site could rebuild from the CIK, accession and document name if the bytes matter later.

## How to re-run

```bash
pipeline/.venv/bin/python -m pipeline.run --stage sec_events                 # after edges_trades; then --stage assemble
pipeline/.venv/bin/python -m pipeline.sec_events.run --cik 320193 --cik 1045810   # live check of a few companies,
                                                                             # written to pipeline/build/sec_events_sample.json
pipeline/.venv/bin/python -m pytest -q pipeline/tests/test_sec_events.py pipeline/tests/test_validate_sec_events.py
```

`python -m pipeline.validate` checks the file and the org fields (`pipeline/validate_sec_events.py`): schema, ISO
dates, items `d.dd`, links to the filing on sec.gov, sort order, events inside their span, every traded company
covered or listed as failed, report counts, and org fields equal to the window rule re-derived from the counted trades.
The tests use recorded EDGAR responses in `pipeline/tests/fixtures/sec/` and never touch the network.
