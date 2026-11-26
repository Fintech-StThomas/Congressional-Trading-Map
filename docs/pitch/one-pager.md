<!-- Pitch material: one page for journalists. Figures from the meta.json of live release 4a04a60b (2026-11-26). -->

# Paper Trail

**Public filings that tie members of Congress to companies, PACs and each other, in one place, every record linked to
its source.** https://red-paper-trail.vercel.app

## What you can do with it

- **See every filed tie for a member**: household stock trades and holdings, PAC money, outside spending for the
  member (spending against is shown separately, never as a tie), money between members, and joint fundraising. A tie
  is drawn only when a filing names both ends.
- **Find trades worth a look.** Every counted trade is tested daily against five fixed, published rules: made public
  more than 45 days after the trade (the STOCK Act's outer limit; extensions are not in the data); a large disclosed
  amount; several members trading the same stock within 7 days, beyond
  what chance predicts; the company's PAC giving to the member in the same cycle; a committee seat whose jurisdiction
  covers the company's industry. For the one statistical rule (several members, same stock) the site prints the count
  expected by chance; a draft 8-K timing rule was dropped because it was met at the chance rate (1.03).
- **See what was around a trade**: the company's SEC 8-K filings within 30 days either side, the PAC
  records, the other members the "several members" rule found (linked), and a news-search link for those dates.
- **Cite it**: member, organisation and records pages, and each tie, give copyable citation text and a permanent link
  to the exact data release, plus a JSON
  packet of record ids and source links.

## What is in it

| | |
|---|---|
| Members | 1,569 who served since 2000 (539 current) |
| Household trades | 182,917 counted (Senate from July 2012, House mostly from 2014) |
| Ties | 888,553, of which 646,379 PAC money ties |
| Organisations | 18,728 companies, PACs and committees |
| Review flags | 36,955 trades meet at least one rule |
| Sources | House and Senate trade reports (via the public austin-starks/congressional-stock-trades compilation, each row linked to its original filing), House annual reports (via ZipLime/congress-trading), FEC bulk data and OpenFEC, SEC EDGAR, congress-legislators |

## How it stays fair

- It never claims wrongdoing. A flag is a prompt for reporting, not a finding.
- Amounts are the disclosed ranges, never estimates. Missing data is shown as missing, never as zero.
- Records are joined only by exact identifiers or exact names, plus a list of 205 name overrides checked with
  machine assistance and awaiting the team's sign-off; never by similarity.
- Minors are redacted where the filing indicates one, and street addresses are never published.
- Free, no ads, open source (MIT). Corrections are welcome through GitHub issues labelled `correction`.

## Limits

No Senate holdings yet. Ranges, not amounts. About a fifth of PAC dollars tie to a named company. The committee
table is a draft. Lobbying data switches on after the team's review. Full list: `docs/pitch/limits.md`.

Built by Yuepheng Yang, Cole Pawlenty, Jacob Moreno and Nikhil Jangir.
