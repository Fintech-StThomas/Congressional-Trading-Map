# Disclosure timing: date and source audit

Purpose: fix what the date fields behind `delays.json` mean before the site shows elapsed-days figures
(packet R2.1). Audit date 2026-11-16. No dataset or download cache was available in this checkout, so nothing below
was measured on real rows; statements about the code were read from the code, statements about the source were read
from the pages cited. Wording rule: elapsed days are observed, never a compliance finding.

**Update 2026-11-24 (review packet P2).** The amended-trade questions below were measured on the real dataset and the
code changed; see "Amended trades: measurement and rule (2026-11-24)" at the end. Where the two disagree, that
section is current: `available` is now the trade's earliest public date, and House reprints marked Amended are folded.

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

## Amended trades: measurement and rule (2026-11-24)

Measured on dataset commit `c93d0573595dc604c1e2814b66aeacab3d760306` (snapshot 2026-11-24; 49 files, 9.1 MB;
183,059 event versions, 182,867 current events: 163,741 House, 19,126 Senate).

**What the source carries.** `political_trades.filingStatus` on House rows: `New` 57,089, `Amended` 1,064, `Deleted`
55, null 107,426. It is two things:

- On e-filed PTRs it is the status the Clerk prints under each transaction ("Filing Status: New / Amended /
  Deleted"). Amended and Deleted rows also print a transaction ID in the first column (`sourceTransactionId`: 658
  Amended, 55 Deleted rows); originals print none, so the ID does not link a reprint to its original.
- On scanned filings (which print no per-row status) and some text filings it is the dataset's reading of a
  filing-level statement that the report amends an earlier one (for example "amended PTR ... #<filing id>"); those
  rows carry no transaction ID. It is a filed record naming the original, read by the dataset, not printed per row.

`political_filings.amendedReportDate` is set on 46 House filings and names a date, not a filing; it is not used.
`political_trade_events.firstAvailableAt` equals the earliest version's `availableAt` on all 183 multi-version events.
Checked by eye in the Clerk PDFs: 20016961 (Pelosi, 2 rows "Filing Status: Amended" with IDs 2000060675/6, 7 "New"),
20011611 (DelBene, 3 Amended), 20011659 (Brooks, 5 Amended), 20003003 (Lowenthal, 20 Amended), 20020983 (Fallon, 118
rows with an ID, marked Amended); originals 20009672 and 20008873 print "New" and no ID.

**What the dataset already does.** It folds 392 of the Amended rows and 46 of the Deleted rows into the event of the
original (that event keeps the original date). 670 Amended and 9 Deleted rows are the source row of a current event
of their own. 183 events have several versions (15 House, 168 Senate; 192 superseded versions); the current
version's `availableAt` is the later filing's date, and in 48 of them (13 House, 35 Senate) the transaction date
differs between the earliest and the current version.

**Counts before the change.** 381 exact-key groups span more than one House filing (811 events, 430 more than one
per group; key = member, transaction date, owner, action, amount low/high, ticker or asset text minus the bracketed
type code). 138 marked single-version rows (129 Amended, 9 Deleted) have an exact-key event in exactly one earlier
filing; none has candidates in two. 126 of the 138 carry a printed transaction ID; 12 are marked from a filing-level
amendment statement. 126 of the 138 were counted as public over 45 days.

**Rules now in the code** (`pipeline/trade_amendments.py`, data dictionary "Rules the pipeline must keep").

1. House reprints: a row marked Amended or Deleted is folded into the earlier trade it restates when the
   transaction ID or every key field is equal and exactly one earlier filing qualifies. Rule limit: an exact key
   cannot say which of several identical rows of that filing is restated (they are paired one to one), and cannot
   link an amendment that changes a key field. Rows of multi-version events are not key-matched.
2. Dataset versions: the trade is timed from, and cites, its earliest version's filing; later versions' filings are
   listed under the trade (`amendments`, status "Version"). When the transaction date differs between the earliest
   and the current version (or the lag would be negative) `lag_days` and `late` are null: the first public filing
   showed another date, so no elapsed-days figure is given. `delays.json` counts these as `date_corrected`, apart
   from `undated`. No negative lag is published for a multi-version trade.

Result on this snapshot: 182,867 -> 182,729 trades; public over 45 days 23,093 -> 22,800 (House 20,336 -> 20,199;
Senate 2,757 -> 2,601); lag withheld on 48 trades (House 13, Senate 35; 43 of them were over 45 days before, 5 were
not); negative lags 0. Pelosi (P000197): 218 -> 213 trades, over 45 days 5 -> 1. Fallon (F000246): 282 -> 193,
188 -> 99. McCaul (M001157): unchanged, 33,350 and 6,740; his repeats are in scanned filings that carry no status.
The validator (`pipeline/validate_trade_amendments.py`) re-reads the dataset from the download cache: 186,160 checks,
0 failures on trade files built from this snapshot, including "`doc` is the filing public on `available`" for every
trade and "no marked House row with a single exact earlier filing is left unfolded".

**Release note (effect on `/changes` and on citations).** In the first release built with these rules, compared with
the one before: 138 trade ids are no longer in the data (the folded reprints; each is listed under its original in
`amendments`); about 653 trades change in the same version because `amended` becomes true (House rows marked Amended
or Deleted, and the originals that absorbed a reprint); 183 multi-version trades change `available`, `lag_days`,
`late` and, where the earliest filing differs, `doc`. `/changes` will show the first group as "no longer in the
data" and the others as same-version changes; none of it is a new filing.

**Still open (not resolved by an exact signal).**

- 526 single-version House rows marked Amended have no exactly matching earlier trade. Comparing 518 such rows with
  the member's earlier trades: one key field differs for 250 (date 173, action 35, asset text 27, owner 15), two
  for 172, three or more or nothing earlier for 96. Those are corrections; the trade they correct is usually still
  published too. Linking them needs a rule that is not an exact match. Decided 2026-11-25 (below): the row stays,
  its lag is withheld.
- 983 trades (452 groups) share an exact key with a trade in another filing and carry no mark: McCaul 212,
  Harshbarger (H001086) 209, Carper (C000174, Senate) 130, Rick Scott (S001217, Senate) 98. Kept and counted
  (`meta.counts.trades_same_key_other_filing`). Some are real repeated trades; some are a report filed twice.
- 55 rows are marked Deleted (46 folded by the dataset into the original's event, 9 by this rule). Decided
  2026-11-25 (below): listed, and not counted when no live printing of the trade is left.
- Senate rows marked Amended (3,310 rows, 632 current events) were not examined against eFD pages and are not folded.


## Owner decisions of 2026-11-25: deleted trades and amended rows without an original

Same snapshot (`c93d0573`), trades stage `load()` without the spine filter.

**Deleted.** A House row marked Deleted cancels one specific earlier row, not the trade. Rule: each Deleted printing
cancels one live printing (status New, Amended or none) of the same trade that was public no later than it; the
trade is not counted only when no live printing is left. Printings are every row the dataset folded into the event
plus the events folded here. No ordering of same-day filings is used (an earlier draft compared filing ids, which
was wrong: Grijalva below, and 7-digit paper ids do not sort with 8-digit e-filed ones). A not-counted trade stays
listed in `trades/<id>.json`, flagged amended, and is named in `TradeFile.not_counted`; it is left out of member
and site trade counts, `trade_summary`, the wall, `traded` / `traded_together` ties and their sums, position
timelines, `delays.json` and the trades-stage report figures.

The 55 Deleted rows sit on 55 trades. 42 are not counted (37 where the dataset folded the Deleted row into the
event, 5 folded here, among them Manning M001135 `house:20024436:30` and `:31`, deleted by filing 20029046); 18 of
the 42 were counted as over 45 days. 13 keep a live printing and stay counted; each lists the Deleted printing and
the surviving one under the trade (`amendments`, status "Reprinted" or "Amended"):

- Grijalva G000551 `house:20001226:0`, `:1`: New in 20001226 (2014-07-01), New again in the fuller 20001267 and
  Deleted in 20001268, both 2014-07-09 (PDFs read by the reviewer: the Deleted rows carry the first filing's
  notification date).
- Langevin L000559 `house:20012558:0` and S001201 `house:20019379:166`: New in two filings, one Deleted row later.
  The second live printing keeps the trade counted; whether the two printings are one real trade reported twice or
  a duplicate report cannot be told from the filings.
- Neugebauer N000182 `house:20002481:0`: filing 20002483 deletes the purchase and restates it as New in the same filing.
- Blumenauer B000574, 6 trades: Deleted by 20019618 and restated as Amended by 20019619, both 2021-10-12.
- Green M001203 `house:20011417:148`, `:150`: printed again after the deletion.

The Deleted row's printed notification date was not used as a signal.

**Amended, original not matched.** A House row marked Amended (or Deleted) that is the earliest printing of its
trade and has a single version keeps its row and `available` (the amending filing's date, the earliest known), but
`lag_days` and `late` are null, `TradeFile.lag_withheld` says `amended_unmatched`, and `delays.json` counts it in a
bucket of that name. A separate bucket was chosen over widening `date_corrected` because the reasons differ and a
reader is told different things: for `date_corrected` the first public date is known but belonged to another
transaction date; for `amended_unmatched` the first public date itself is unknown. Of the 526 such rows, 524 have
both dates and are withheld (423 of them were counted as over 45 days); 2 have no transaction date and were already
undated. None of them is deleted.

**Result.** Listed 182,729; counted 182,687 (House 163,561, Senate 19,126). Public over 45 days: 22,800 -> 22,359
(House 20,199 -> 19,758; Senate 2,601 unchanged). Lag withheld: `date_corrected` 48 (House 13, Senate 35),
`amended_unmatched` 524 (House). Delays totals: dated 181,589, undated 526, negative 0. Pelosi (P000197): 213
trades, 1 over 45 days (unchanged). Manning (M001135): 807 listed, 805 counted, over 45 days 52 -> 50. Fallon
(F000246): 193, over 45 days 99 -> 97 (2 withheld). The source re-read validator: 699,991 checks, 0 failures,
including "not counted exactly when the source's Deleted printings cancel every live one" and "amended_unmatched exactly
on single-version House rows the source marks".

**Release note.** Compared with the release before: 42 trades leave every count and tie (their rows stay);
524 more trades lose `lag_days` / `late`; `delays.json` gains `amended_unmatched`; trade files gain `lag_withheld` and
`not_counted`. A `traded` tie made only of deleted trades disappears, and its organisation with it if nothing else
ties it; that trade row then has `org` null.
