<!-- Pitch material: a five-minute live demo, built on the checked case files. -->

# Five-minute demo

Audience: investigative journalists who follow members of Congress, their money and their trades. The point to land:
**every line on the site is a filed public record you can open, and the site tells you what to look at next without
telling you what to conclude.**

Before the demo:
- Open the permalinks in `docs/pitch/case-files.md` (pinned to release `4a04a60b…`), not the live pages, so a data
  refresh during the talk cannot change what is on screen.
- A person opens the two Senate filings behind case 1's "several members" flag (Angus King and Markwayne Mullin,
  links in `case-files.md`, accepting the Senate site's terms) and confirms them. If that has not been done, skip that
  flag in the live run.
- Keep the three FEC records for Suzan DelBene open in tabs (case 3): her panel shows the total but not those records.
- Never say "suspicious", "insider", "timed" or "ahead of". Say "the filing shows", "a published rule was met",
  "worth a reporter's look". Read rule labels, never rule ids (say "Company PAC gave in the same cycle").

## 0:00 What it is (30 seconds)

"Paper Trail joins public filings that usually live in separate places: House and Senate trade reports (through the
public austin-starks/congressional-stock-trades compilation, every row linked to its original filing), House annual
reports, FEC campaign money and outside spending, and SEC company filings. It covers 1,569 members who served since
2000. Every tie on the site names its source records and links to them. It is free, has no ads, and never claims wrongdoing."

## 0:30 One member, every tie (60 seconds)

Open Michael Rulli's page (case 1).
- The board: companies and PACs tied to him, each tie drawn only when a filing names both ends. Red means a tie and
  nothing else.
- Campaign money: PAC money in, with the FEC records.
- Trades: the household's trades as filed, with disclosed ranges and the days each took to become public.

## 1:30 A trade worth a look (90 seconds)

Click "Around this trade" on the Eli Lilly buy of 2 January 2026 ($1,001–$15,000).
- Four published rules are met (read three if the Senate filings were not checked). Read each label aloud:
  - made public 217 days after the trade;
  - two other members bought the same stock within 7 days, where about 0.6 would be expected by chance;
  - Eli Lilly's PAC gave $1,000 to his campaign committee in the same two-year cycle, in April, after the trade (the
    rule counts any gift in the cycle);
  - our draft committee table, which the team is still reviewing, maps Energy and Commerce to drug makers' industry
    code; the date he joined the committee is not in the data.
- Read the statement on the panel: a flag is a prompt for reporting, not a finding.
- Show what sits around it: the 8-K block (no 8-K within 30 days for this trade), the PAC record with its FEC link,
  the other members' names, and a news-search link for those dates.
- Open the House filing from the trade row. "This is the original document. Everything here can be checked." Then
  say: "The owner column is blank, so this is a household trade. The filing puts it in a Merrill Lynch managed
  account, and the same account sold Lilly a month earlier and again in July. Whether the member directs that account
  is the first thing a reporter would ask."

## 3:00 Across Congress (60 seconds)

Open `/flags`.
- "Every counted trade is tested against five fixed rules, every day, in the same way for everyone."
- Point at the chance figure next to "Several members, same stock, within 7 days": "For our one statistical rule we
  publish the count expected by chance: 3,283 against 3,701 met. A draft rule on 8-K timing did no better than chance,
  so we dropped it (met at 1.03 times chance)." The other four rules describe the trade itself and have no chance figure.
- Switch to "Made public in the last 30 days": the newest filings that met any rule.
- Mention the RSS feed for newsrooms.

## 4:00 Cite and limits (60 seconds)

- "Cite this" on member, organisation and records pages, and on each tie: copyable text and a permanent link to the exact data release.
- Show `/method`: every rule, threshold and count.
- Close on the limits slide (`docs/pitch/limits.md`): no Senate holdings yet, ranges not amounts, a fifth of PAC money
  ties to a named company, a draft committee table, and lobbying arrives after the team's review.

## Backup cases

- Case 2, Kevin Hern, Microsoft: a $250,001–$500,000 joint buy on 26 March 2020. Nine other members bought Microsoft
  within 7 days, against about 2.8 expected. The baseline does not account for market-wide moves that month.
- Case 3, Suzan DelBene, Microsoft, December 2018: a $1,000,001–$5,000,000 joint buy, made public 146 days later, with
  $7,500 from Microsoft's PAC that cycle.

## Likely questions

- *Is this accusing anyone?* No. Every flag is a published rule met by a filed record, and the site says so on every
  flag. Many flagged trades will have ordinary explanations, such as managed accounts; the flag cannot tell which.
- *Where does the trade data come from?* From the public austin-starks/congressional-stock-trades compilation of House
  and Senate reports; every row links to the original filing on the House or Senate site. Check the linked original
  before publishing.
- *Why keep a rule that is only 1.13 times chance overall?* It stays by the team's decision, with its chance figure
  printed beside it: most of these flags would turn up by chance alone, so each one is only a prompt to look, and
  clusters often have ordinary causes such as market-wide news or a shared adviser.
- *How current is it?* The data rebuilds every day. Trades appear when the member's filing becomes public, which by
  law can be 45 days after the trade; about one counted trade in eight is later than that.
- *Why no Senate holdings?* The Senate site requires a person to accept its terms; it is on the list.
- *Can I get the data?* Yes: the export page and the citation packets carry record ids and source links. The code is
  open source under MIT.
