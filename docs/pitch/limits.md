<!-- Pitch material: one slide of honest limits, every figure cited to meta.json or docs/review-flags.md. -->

# What Paper Trail does not do

Figures are from live release `4a04a60b…` of 2026-11-26 (its `meta.json`) and the flags method `flags-3`
(`docs/review-flags.md`).

- **No Senate holdings.** Holdings come from House annual reports only (Schedules A and D, report years 2013 to 2025).
  No Senate annual reports are loaded. *(meta.json `reports.holdings.chambers`)*
- **Trades start in July 2012, and mostly in 2014 for the House.** Senate filings begin 2012-07-25. House filings begin
  2014-01-02; a few late-filed earlier trades appear. *(meta.json `coverage_notes`, `reports.hf_trades.coverage`)*
- **Disclosed ranges only.** Members report a band such as $1,001–$15,000, never a figure. No midpoints are stored,
  so a $260,000 trade and a $490,000 trade look the same. *(docs/review-flags.md, `large_amount`)*
- **About a fifth of PAC dollars tie to a named company.** $1.08 billion of $4.89 billion in PAC giving (22%) comes
  from 512 of 7,955 committees matched to a company. The rest is not drawn as a company tie. *(meta.json
  `reports.fec.pac_money_match`)*
- **"Several members, same stock, within 7 days" is close to chance.** 3,701 trades met it against 3,283 expected by
  chance, a ratio of 1.13. The site shows the chance figure next to the count. *(meta.json `flags.baselines.pile_on`,
  `flags.rules.pile_on`; docs/review-flags.md, "Expected by chance")*
- **The committee table is a draft.** The industries each committee oversees were drafted from the House and Senate
  rules and await team review. Committee seats are current rosters, applied back to 2025-01-03. *(docs/review-flags.md,
  `sector_overseen`)*
- **Company 8-K filings are context, not a flag.** A draft rule on 8-Ks was met by 5.13% of trades against 4.97% by
  chance (ratio 1.03) and was dropped. The site lists 8-Ks within 30 days of a trade for context. *(docs/review-flags.md,
  "Considered and not used as a flag")*
- **Lobbying is off.** It switches on only after the team signs off the review sample. *(STATUS.md, "Decisions already
  made")*
- **Trades belong to the household.** A trade is the member's own only when the filing says so; joint counts as the
  member's. Spouse and dependent trades are shown as filed. *(STATUS.md, "Decisions already made")*
- **Flags are prompts, not findings.** 36,955 of 182,917 counted trades meet at least one of five fixed rules. A flag
  says a rule was met. It says nothing about why a trade was made or what the member knew, and most flagged trades
  will have ordinary explanations. *(meta.json `flags.trades_flagged`, `flags.trades_counted`; docs/review-flags.md)*
