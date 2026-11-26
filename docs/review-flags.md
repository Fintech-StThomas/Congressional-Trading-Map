# Review flags

Method version **flags-3** (owner decisions, 2026-11-25 and 2026-11-26; flags-3 from the review of 2026-11-26). Code: `pipeline/assemble/flags.py` (rules),
`pipeline/assemble/flags_out.py` (published files), `pipeline/validate_flags.py` (checks). Thresholds:
`pipeline/config.py` (`FLAGS_*`). Data shapes: `docs/data-dictionary.md`, "Review flags".

**A flag is a prompt for reporting, not a finding.** A flag says only that one of five fixed, published rules was met
by a filed trade, so the trade may be worth a reporter's look. It says nothing about why the trade was made, what the
member knew, or whether any rule or law was broken. Most flagged trades will have ordinary explanations, and many
trades worth a story will meet no rule at all.

## How the rules are applied

- Every counted trade is checked against every rule on every daily build. A trade a later filing deletes
  (`TradeFile.not_counted`) is never checked and never flagged; the site says so for such a row ("not counted, so
  the rules were not checked"), never "met none".
- Each rule has three outcomes: **met**, **not met**, and **not evaluated**. A rule is not evaluated when the trade
  lacks what the rule needs (a missing date, range or company, or no source data for that company or period).
  Not evaluated is never counted as not met, and the counts of all three are published per rule.
- Identifiers are exact: org ids, SEC CIKs, bioguide ids, FEC-derived edge ids and committee thomas ids. Nothing is
  matched by name.
- Rule ids are fixed and never renamed. Each rule's label, one-sentence definition, thresholds and counts are in
  `flags.json` (`rules`) and in `meta.json.flags`.

## The rules

### `late`: made public after 45 days

Met when `Trade.lag_days` (days from the transaction date to the date the public could first see the report) is over
45, the STOCK Act's outer limit. This is `Trade.late`. Not evaluated when `lag_days` is null, which includes a missing
date and a withheld lag (`TradeFile.lag_withheld`). Detail: `{lag_days}`.

*Why:* reporting deadlines are the one timing rule the law sets. *Limits:* the statutory clock starts when the filer is
notified of the transaction, which is not in the data, and extensions are not in the data either; see
`docs/validation/disclosure-timing-audit.md`. A few filers account for much of the count (on the measured build one
member has 30% of all late trades).

### `large_amount`: large disclosed amount

Met when the trade's disclosed range starts at $250,001 or more: the STOCK Act bands of $250,001 to $500,000 and every
band above, including open-ended ones ("over $1,000,000"). Not evaluated when the low of the range is null. Detail:
`{low}`.

*Why:* a fixed amount reads the same for every member and needs no history. *Limits:* disclosed amounts are ranges,
so a $260,000 trade and a $490,000 trade are the same here; a member's household wealth is not taken into account.
On the measured build 66% of the flags are on assets without a ticker (bonds, private holdings, accounts) and one
member has 22% of them.

### `pile_on`: several members, same stock, within 7 days

Met when at least 2 other members have a counted trade in the same org, in the same direction (buy or sell), with
transaction dates at most 7 days apart from this one, **and** that number (observed) is at least 3 times what would
be expected by chance. Eligibility is that of the `traded_together` rule: a dated buy or sell with a ticker, not a
fund, bond or unknown asset type, except that an unknown type counts when the ticker resolves to an SEC operating
company with a SIC code that is not a pooled vehicle. The other trades must be eligible too. Trades that are not
eligible are not evaluated. Detail: `{members: [up to 5 ids, nearest in time first], observed, expected}`
(`expected` to 3 decimals).

**Baseline, as stated on /method:** expected is the sum, over the other members who traded that company in that
direction within 182 days either side of the trade date (a rolling 365-day span centred on the trade,
`FLAGS_PILE_ON_BASE_DAYS`), of each one's chance of having a trade within 7 days of a random day: their distinct
trading days in that span times 15/365, capped at 1 (the total is floored at 1/365). The rule is met when observed is
at least 3 times expected. Through flags-2 the span was the trade's calendar year, which counted a member trading a few
days away across New Year as observed but not as expected; the rolling span uses the same 365 days for both.

*Why this baseline:* the simpler count (other members who traded the company that year, times 15/365) treats a member
who trades a stock every week the same as one who traded it once, so a frequent trader of a widely held stock makes
almost every week look like a cluster. Measured on the same build with the rolling span (flags-3), the simpler count keeps
7,737 flags; this baseline keeps 3,701, with the four most flagged companies (Alphabet, Starbucks, Home Depot,
Qualcomm) at 7% of them. (Under the flags-2 calendar year the simpler count kept 7,786 and this baseline 3,767, with
Microsoft, Alphabet, Apple and Amazon at 22% of the simpler count's flags.) A full
shuffle like `traded_together`'s would be more exact, but it cannot be stated in two sentences or checked by hand.

*Limits:* each trade is tested on its own, so a member who trades very often gets many tests and many flags (on the
measured build two members hold 36% of the flags). Clusters can still reflect index rebalancing, earnings or
market-wide news, or advisers who manage several members' accounts the same way. Near the ends of the data (the
first and the latest half year) the base span is cut short by the data itself, so expected is computed from fewer
days there. A recent flag can also appear or disappear in a later build: other members' trades in the same 7 days may
not be public yet (they can be filed 45 days or more later), which changes both observed and expected.

### `money_both_ways`: company PAC gave in the same cycle

Met when the member received `pac_money` (money a company's PAC reported giving to the member's authorised
committees, or to the member as candidate where the FEC row names no recipient committee) from the trade's own org (the same org id as the edge's `from`), with a net
positive amount in the FEC two-year cycle of the trade date (cycle = year + year % 2, from the edge's `by_year`). Only
`pac_money`, not employee, lobbyist or outside money. Not evaluated when the trade has no date, its org is not an SEC
company (`co:`), or the member has no FEC candidate id. Detail: `{edge}` (the edge id; for a member file over the
publication budget it may be a ledger row, which has no published id: the id is `edge_id` of type, ends and via, and
the validator recomputes it). The site's "Around this trade" panel reads both the full edges and the ledger rows, and
never says "no PAC money" for a trade this rule flagged.

*Why:* money from a company and a trade in that company's stock in the same cycle is the plainest two-way link in
the data. *Limits:* only about a fifth of PAC dollars attach to a named company, so many company PACs are not seen;
the cycle is two years, so the gift and the trade can be up to two years apart; large companies give to many members.

### `sector_overseen`: sector of a committee seat

Met when the member sits on a full committee (not a subcommittee) whose jurisdiction, in the committee table, covers
the company's SEC SIC code: the 4-digit code (`companies.json` `sic`) starts with one of the committee's listed
prefixes (2 to 4 digits, from flags-3; flags-2 used 2-digit major groups only) and with none of its carved-out
prefixes. Committee assignments are the current rosters, applied back to 2025-01-03 (the start of the 119th
Congress): a member who joined or left a committee during the Congress is treated as on it, or off it, for the whole
period, because changes are not dated in the roster. The rule is evaluated only for current members' trades dated on
or after 2025-01-03. Not evaluated also when the org is not an SEC company with a SIC code, when the trade is a fund or the
company is a pooled vehicle (an ETF trust's SIC code is not an industry), or when the roster lists no full committee
for the member. Detail: `{committee}` (the first matching committee id, `cmte:<thomas id>`).

**The committee table is drafted for team review.** `pipeline/crosswalk/committee_sectors.csv` (columns
`committee_id` = the thomas id as in `committees.json`, `committee_name`, `sic_prefixes` and `sic_excluded` = SIC
prefixes of 2 to 4 digits separated by `;`, `basis` = the House Rule X or Senate Rule XXV clause and every change)
was drafted conservatively from the chamber rules' jurisdiction text only: a committee is mapped to an industry only
where the text names it. Narrowed in the review of 2026-11-26 (flags-3), each change recorded in `basis`:
Energy and Commerce and HELP cover drugs (283), medical instruments (384) and health services (80), not all
chemicals (28); the banking committees cover 60, 61 and 62, not real estate (65), real estate investment trusts (6798: the class
includes data-centre, tower and office REITs, not only housing) or the rest of 67; Transportation and Infrastructure and Commerce
cover 40 to 47 without travel agencies (4724); the agriculture committees cover 01, 02, 07 and 20 without beverages
(208), and forestry (08) was removed. House Financial Services keeps insurance (63, 64) on Rule X's "insurance
generally"; this is **contestable**, because most insurance is regulated by the states, and a reporter should weigh
it before relying on such a flag. Committees whose text names no industry (Appropriations, Budget, Ways and Means, Finance, Judiciary and
others) are not mapped. Armed Services is listed but not mapped: its clause names no industry. Senate Banking is not
mapped to insurance (63, 64) because its clause does not name insurance. Rows with no prefixes are documentation
only. The table must be reviewed before the rule is relied on.

*Why:* a trade in an industry the member's committee writes rules for is a standard reporting question. *Limits:* a SIC
code is the company's main line of business only; jurisdiction over an industry is not jurisdiction over a company;
assignments are current rosters applied back to 2025-01-03 and changes during the Congress are not dated, so a trade
before a member joined a committee can meet the rule, and one made while a member sat on a committee they have since
left does not.

## Expected by chance

Each rule in `flags.json` (`rules[].baseline`) and `meta.json.flags.baselines` says whether a chance figure exists, so a
page can say "x% of evaluated trades meet this; about y% would by chance" (code `pipeline/assemble/flags_chance.py`).

- **Descriptive** (`kind: "descriptive"`, no figure): `late`, `large_amount`, `money_both_ways`, `sector_overseen`.
  They describe the trade (its timing against a legal deadline, its size, two filed records about one company, a
  committee seat), not a coincidence in time, so "by chance" has no meaning for them.
- **`pile_on`** (`kind: "chance"`): for each evaluated trade, the chance that a Poisson count with mean equal to the
  trade's `expected` (the rule's own baseline) reaches the rule's bar, at least 2 and at least 3 times expected;
  summed over evaluated trades. The block also gives the summed `expected` and observed other members
  (`expected_others_sum`, `observed_others_sum`) and the mean expected per trade. The Poisson count treats other
  members as trading independently of each other, which overstates chance a little for members who are certain to
  be near (capped at 1) and understates it for days when many members trade at once (market-wide news).

`pipeline/validate_flags.py` recomputes the chance figure from the published trade files.

**On the full data `pile_on` is close to chance.** Measured with flags-3 on the inputs of the build of 2026-11-25
(trades snapshot `fb9d784a`): 3,701 trades met it (2.94% of evaluated), against 3,282 expected by chance (2.61%),
observed / chance 1.13; the observed other members within 7 days (44,735) are 1.11 times the expected (40,208).
(flags-2, calendar year: 3,767 met against 3,260.) It stays a flag (owner decision,
2026-11-26) and the site shows the by-chance figure next to it, so a reader sees the base rate with the count.

## Published files

- `trades/<id>.json`: `flags` (trade id -> rule id -> detail, met rules only) and `flags_not_evaluated` (rule id ->
  count for that member).
- `members/<id>.json`: `trade_summary.flags` (rule id -> trades meeting it).
- `flags.json` (site page "Review flags"): every trade meeting 2 or more rules (each row with its owner as filed, from flags-3), plus every trade meeting any rule that
  became public in the 30 days up to the build date; the `rules` block (with `baseline`); `method_version`; the build
  date. Rows are capped at 10,000 (most rules, then newest public date, then id) and the file states when the cap
  applies. On the flags-3 build (same inputs as 2026-11-25) it held 3,258 rows, 0.44 MB, with no cap applied
  (flags-2: 3,287 rows, 0.41 MB ; flags-1, with the 8-K rule: 4,390 rows, 0.56 MB).
- `meta.json.flags`: method version, per-rule counts and `baselines`, for `/method`.

`pipeline/validate_flags.py` re-derives every rule, its detail and its not-evaluated count from the published files
(`pipeline/validate_flags_derive.py`, written with other code paths than the assembler: a two-pointer sweep with
integer arithmetic for `pile_on`, the member files' full edges and ledger rows for `money_both_ways`, the roster and
its own prefix test for `sector_overseen`; its docstring lists what is shared). For `money_both_ways` the named edge
must be the member's `pac_money` tie from that org with a record in the trade's cycle; a ledger row whose first and
last dates straddle the cycle cannot be split by year, and a former member's ledger keeps only its largest rows, so
those trades accept either outcome (25,561 on the measured build; counted in the validator's output). It also checks
that no pooled vehicle meets `sector_overseen`, that no not-counted trade is flagged, that rule ids are in the fixed
set, and that counts agree between trade files, member files, `flags.json` and `meta.json`.

## Measured (inputs of the build of 2026-11-25, flags-3)

Trades snapshot `fb9d784a`, 182,890 counted trades, 36,952 meeting at least one rule (flags-2: 37,074; only
`pile_on` and `sector_overseen` changed).

| Rule | Met | Evaluated | Not evaluated | Baseline |
|---|---:|---:|---:|---|
| `late` | 22,506 | 181,792 | 1,098 | descriptive |
| `large_amount` | 4,835 | 182,507 | 383 | descriptive |
| `pile_on` | 3,701 | 125,735 | 57,155 | 3,282 by chance |
| `money_both_ways` | 8,568 | 118,307 | 64,583 | descriptive |
| `sector_overseen` | 514 | 19,383 | 163,507 | descriptive |

## Considered and not used as a flag

### `before_company_news`: ahead of a company 8-K (flags-1 only)

The draft rule was met when the trade date was 1 to 14 days before the company filed an SEC Form 8-K or 8-K/A
reporting at least one of items 1.01, 1.02, 1.03, 2.01, 2.05, 2.06, 3.01, 4.02 or 5.01 (item 2.02, results of
operations, excluded because it is filed every quarter on a known schedule). It was evaluated only where the trade's
whole window lay inside the company's complete SEC coverage. The chance figure was, for each evaluated trade, the
share of days in that trade's calendar year with a qualifying 8-K 1 to 14 days ahead, summed over evaluated trades.

On the build of 2026-11-25 (full SEC 8-K coverage for 2,145 companies) it was met by **5,978 of 116,493 evaluated
trades (5.13%)**, against **5,789 expected by chance (4.97%)**: observed / chance **1.03**. About 1 in 20 trades falls
1 to 14 days before a listed 8-K whatever its timing, so a trade meeting the rule says almost nothing beyond that
base rate, and a flag that fires at chance rate would point reporters at coincidences. An 8-K is also filed up to four
business days after the event, which may have been public earlier. Owner decision, 2026-11-26: not a flag.

The company's 8-K filings stay on the site as context: the "Around this trade" panel lists every 8-K the company filed
within 30 days either side of the trade (`OrgFile.sec_events`, from the SEC events stage, `docs/sec-events.md`), with
its items and a link to the filing, and says "not available" where the filings could not be read. That panel does not
depend on any flag. The flags code does not read `sec_events.json`.

## Changing a rule

Rules and thresholds change only by an owner decision. Each change bumps `config.FLAGS_METHOD_VERSION` (flags-1,
flags-2, ...), which every published file carries, and adds a line below with the date, the change and the reason. A
change to the committee table is a change to the method, too. Old releases keep the flags of the method they were
built with.

| Version | Date | Change |
|---|---|---|
| flags-1 | 2026-11-25 | First version (draft, not published): six rules, the five above and the 8-K rule below. |
| flags-2 | 2026-11-26 | The 8-K rule removed: met about as often as chance (see "Considered and not used as a flag"). |
| flags-3 | 2026-11-26 | Review: `pile_on`'s baseline uses a rolling 365 days centred on the trade instead of the calendar year (3,767 to 3,701 met); the committee table takes SIC prefixes of 2 to 4 digits and is narrowed, and REITs dropped from the banking committees (614 to 514 `sector_overseen`); `flags.json` rows carry the owner. |
