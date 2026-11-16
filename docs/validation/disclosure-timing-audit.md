# Disclosure timing: date and source audit

Purpose: fix what the date fields behind `delays.json` mean before the site shows elapsed-days figures
(packet R2.1). Audit date 2026-11-16. No dataset or download cache was available in this checkout, so nothing below
was measured on real rows; statements about the code were read from the code, statements about the source were read
from the pages cited. Wording rule: elapsed days are observed, never a compliance finding.

## What the code does

Source: `pipeline/trades.py` (`map_row`, `available_date`, `load`), `pipeline/config.py` (`LATE_DAYS = 45`).

- `date` = the dataset's `transactionDate` as filed (null when the dataset has none).
- `available` = the dataset's `availableAt`, a UTC instant, converted to the US-Eastern calendar date. The code comment
  says `availableAt` is "end of an Eastern-time day"; that comment is the project's own and was not re-verified.
- `lag_days = available - date` in whole days; null when either date is null. `late = lag_days > 45`; null when `lag_days` is null.
- Current version only: `load` keeps rows where `supersededAt IS NULL` and asserts one current row per `eventId`.
  `version` and `amended` (`n_versions > 1`) are carried.

## Which version's availability date an amended event carries

The code carries the **current version's** `availableAt` and the current version's `transactionDate`. It never reads
the original version's `availableAt`. What this means in the data cannot be determined from this repository:

- The dataset card says "Repeated reports fold into one event; amendments add point-in-time versions" and
  "`availableAt` is the information boundary". Neither the card nor `METHODOLOGY.md` defines whether a later
  version's `availableAt` is the date the amendment was filed or the date the original report was filed, and neither
  says whether `transactionDate` can change between versions.
- So for an amended event `lag_days` may measure transaction to amendment, not transaction to first public report.
  An amended trade can therefore look much "later" than its first appearance. Unknown, not assumed.
- Consequence for the aggregate: `amended` is counted in every group and shown as a separate caveat. Amended trades
  stay inside the bands (the bands describe the published row), and a reader must not treat an amended trade's band as
  the original filing's timing. To get original-filing delay we would need the original version's `availableAt`
  (`supersededAt IS NOT NULL` rows, currently discarded). Follow-up, not done here.
- "Repeated reports fold into one event" also means a duplicate filing of the same trade is folded; which printing's
  date survives in the current version is not documented.

## Known and unknown

| Item | Status |
|---|---|
| Transaction date as filed | In the data (null on some rows). Scanned older filings: the dataset says day-of-month values on some are "approximate" (METHODOLOGY.md, read 2026-11-16). |
| Date the report became public (`availableAt`) | In the data as a UTC instant; converted to the Eastern date. Its derivation per source (House Clerk posting vs Senate eFD posting vs receipt) is not documented in the pages read. |
| Date the filer was notified of the transaction | **Not in the data.** The 30-days-from-notification clock cannot be evaluated. |
| Committee extensions or fee waivers | **Not in the data.** |
| 45-days-from-transaction outer bound | Comparable with `lag_days`, as observed elapsed days only. A lag over 45 does not show a late filing: the dataset's date may differ from the filing date (see amended), and rows lack extension/waiver information. A lag at or under 45 does not show compliance either, since the 30-day clock from notification may have expired first. |
| Amendment filing dates | Possibly in `availableAt` of later versions (above); not separately published. |

## Negative lags, missing dates, early years

- **Negative lag** (`available` before `date`): the code allows it (`lag_days` can be negative) and `late` is then
  false. `trades.py`'s report prints a `negative_lag` count in `pipeline/build/sources/hf_trades.json`; its value was not
  available here. The dataset says dates "that cannot all be true (a trade dated after the report was filed ...) go to a
  reconciling read of the page", so a negative lag is more likely an extraction or date-entry issue than a real
  timing. `delays.json` counts these separately, outside the bands and all statistics.
- **Missing dates:** `date` null or `available` null gives `lag_days` null. They are counted `undated`, never as 0 days,
  never in a band. A trade with a transaction date but no availability date is counted in its year and as undated.
- **Pre-July-2012 rows:** STOCK Act periodic transaction reports began in 2012; the code treats 2012 as the first year
  (`STOCK_ACT_YEAR`) and counts rows dated before 2012-07-01 in `before_2012_07`. House filings in the dataset begin
  2014-01-02 (see the pipeline README). Earlier transaction dates appear only when filed late and are included in
  `delays.json`, in their calendar year; the aggregate does not filter them. Those rows are by construction long lags,
  and their year bands should be read with the coverage marks (`none` / `n/a`) in mind.

## Rules (official sources)

- 5 U.S.C. 13105(l), fetched 2026-11-16 from https://www.law.cornell.edu/uscode/text/5/13105 : a periodic
  transaction report is due "not later than 30 days after receiving notification of any transaction required to be
  reported", "but in no case later than 45 days after such transaction". Verified this session (summary of the fetched
  page text, not the Office of the Law Revision Counsel copy).
- House Committee on Ethics: fetching `https://ethics.house.gov/financial-disclosure/periodic-transaction-reports/`
  returned 404 and the manual page https://ethics.house.gov/manual/filing-deadlines-committee-review-and-amendments
  (fetched 2026-11-16) covers annual reports only (extensions up to 90 days, $200 fee after 30 days late, amendments:
  both original and amendment are public). A web search on 2026-11-16 surfaced the committee's own PTR materials
  (e.g. https://ethics.house.gov/wp-content/uploads/2025/01/Appendix-II-A.pdf and the CY 2025 PTR form,
  https://ethics.house.gov/wp-content/uploads/2026/02/Final-CY-2025-PTR-Form-1.pdf); the search summary says
  PTRs cannot be extended and a tiered late-fee schedule exists. **Those PDFs were not opened this session**; the
  statements about no extensions for PTRs and the late-fee schedule are from a search summary, **not verified against
  the primary document**.
- Senate Select Committee on Ethics: a web search on 2026-11-16 surfaced
  https://www.ethics.senate.gov/public/index.cfm/financial-disclosure-instructions and the 2020 PTR instructions PDF
  (https://www.ethics.senate.gov/public/_cache/files/df29d914-0b9c-4431-b09e-bdea62dc7e56/2020-periodic-transaction-report-instructions.pdf);
  the summary says 30 days from notice and not later than 45 days after the transaction, filer's responsibility to
  monitor, and waiver by request in eFD. **Not opened this session; not re-verified.** The current-year instructions
  were not located.
- Dataset card and methodology, fetched 2026-11-16:
  https://huggingface.co/datasets/austin-starks/congressional-stock-trades/raw/main/README.md and `.../METHODOLOGY.md`.
  Quoted statements above come from those. They do not define `availableAt` beyond "information boundary" nor
  versions' dates.

## Conclusions

1. `lag_days` is "days from the transaction date as filed to the dataset's availability date for the current version".
   `delays.json` states exactly that and nothing about lateness or lawfulness.
2. Amended events: the current version's dates are used; whether that availability date is the amendment's or the
   original's is **undetermined** here. The aggregate counts amended trades separately so the caveat is visible.
3. The 30-day clock cannot be evaluated, extensions/waivers are unknown. Only the 45-day outer bound is compared, and only
   as an elapsed-days band split.
4. Undated and negative lags are reported as their own counts. No missing value becomes 0.
5. Open items before relying on the figures: read the dataset's raw `political_trade_events` for several amended events
   to see whether `availableAt` differs between versions; count real negative lags and inspect a sample; open the House
   and Senate primary instructions listed above; decide whether to also publish original-version delay.
