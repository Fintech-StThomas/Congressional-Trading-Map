# Data dictionary and build contract

This file is the contract between the data pipeline (`pipeline/`) and the site (`web/`).
The pipeline writes JSON under `web/public/data/`; the site only reads those files.
Change this file first when a field changes. `python -m pipeline.validate` checks the output against it.

## Scope

- People: every member of the House or Senate with a term overlapping 2000-01-01 or later. Current members are flagged.
- Trades: periodic transaction reports, July 2012 onward (the STOCK Act created them; nothing earlier exists).
  The trade dataset's House filings begin in January 2014, so House years before 2014 have coverage `none`.
- Money ties: 2000 election cycle onward.
- A string (edge) exists only when a filed public record names both ends, or when a published statistical rule is met. Every edge carries its evidence.

## Identifiers

| Thing | ID format | Example |
|---|---|---|
| Member | Bioguide ID | `K000367` |
| Public company | `co:<CIK, no leading zeros>` | `co:320193` |
| Traded asset with a ticker but no SEC match | `tk:<TICKER>` | `tk:BRK.B` |
| FEC committee (PAC, party, super PAC) with no company match | `pac:<FEC committee id>` | `pac:C00104299` |
| Congressional committee | `cmte:<thomas id>` | `cmte:SSBK` |
| Lobbying registrant or client with no company match | `lda:<registrant or client id>` | `lda:client-12345` |

A PAC whose connected organisation is matched to a company is folded into the company node; the PAC is then named in the edge's `via`.
Matching is exact on a normalised name, plus a hand-reviewed override file (`pipeline/crosswalk/org_overrides.csv`). Similar names are never matched automatically. Unmatched records stay as their own nodes and are counted in `meta.json`.

**Normalised name**: uppercase; delete periods and apostrophes; replace every other non-alphanumeric character with a space; collapse spaces; drop trailing words in {INC, CORP, CORPORATION, CO, COMPANY, LLC, LTD, PLC, HOLDINGS, GROUP, THE} repeatedly; drop a leading THE. `pipeline/build/company_names.json` maps each normalised SEC company name that is unique to its `co:` id.

**Tickers**: a filed ticker is uppercased and share-class punctuation (`/`, `-`, `_`, space, `.`) becomes `.` (`BRK/B` → `BRK.B`), then matched exactly to SEC `company_tickers_exchange.json`. A match is vetoed (never added) when no filed description for that ticker shares a significant word with the SEC name, because the symbol has probably been reassigned since the trade. Vetoed and unmatched tickers become `tk:<TICKER>` and are listed in `meta.json`.

## Files in `web/public/data/`

| File | Contents |
|---|---|
| `meta.json` | Build time, each source's revision and retrieval date, row counts, unmatched counts, exclusions, coverage notes, publication budget, largest files |
| `members.json` | Array of `MemberSummary` |
| `members/<id>.json` | `MemberFile`: one member's full record, edges, board, nodes, ledger, trade summary, cases, coverage |
| `trades/<id>.json` | `TradeFile`: every current trade of one member (only members with trades) |
| `orgs.json` | Array of `OrgSummary`: every org with at least one tie (full edge, ledger row or org tie) |
| `orgs/<shard>.json` | `{ [orgId]: OrgFile }`, where shard is the first two hex characters of `sha1(orgId)` |
| `board.json` | `Board`: current member ids by state; the strings themselves come from each member file |
| `member-ties.json` | Array of member-to-member `Edge`s for graph views (see below) |
| `cases.json` | Array of `Case`, strongest first |
| `wall.json` | `Wall`: one compact row per member (all members, current flagged) for the wall view; a single fetch |
| `wall-years.json` | `WallYears`: per member, terms by year and sparse per-year measures, so the wall can be drawn for any year 2000..current year; a single fetch (about 350 KB, 120 KB gzipped) |
| `org-index.json` | `OrgIndex`: the top organisations by current members reached and by dollars to current members, split by party, so the site can browse organisations without shipping `orgs.json` |

The whole directory is built in a staging directory and swapped into place, so a reader never sees a half-written tree.
All JSON is minified with sorted keys; output is byte-stable between runs on the same inputs, except `meta.json` (build time, retrieval times).

## Publication budget

Full `Edge` objects (with evidence) are written **only in member files**. Constants live at the top of `pipeline/assemble.py`
and are echoed in `meta.json.publication_budget`.

- A member file holds, as full edges: every non-money edge touching the member except `sits_with`, every edge in one
  of the member's Cases, and the member's `MONEY_EDGES_PER_MEMBER` (10) largest money edges (by `amount.exact`, else `high`, else `low`).
  A member-to-member money edge is judged separately in each endpoint's file.
- The member's remaining money ties are `ledger` rows (no evidence), largest first. The ledger is complete for current
  members; former members keep their `FORMER_MEMBER_LEDGER_ROWS` (100) largest rows. `ledger_totals` always covers every
  money tie that is not a full edge, so headline totals never need the rows to be summed.
- `sits_with` (`LEDGER_ONLY_TYPES`) is never a full edge: each member gets one ledger row per colleague
  (`kind` member, `note` = shared committee names, amounts null, `dir` both) after the money rows, and it is counted
  in `ledger_totals`. Its evidence is the member's `committees` list and the committee pages.
- Org files carry no full edges. `OrgFile.ties` lists every non-money tie and, for money, every tie with the
  `MONEY_MEMBERS_PER_ORG` (200) members with the largest money totals with that org; `ledger_totals` covers the rest.
  `ties.edge` is the edge id when the full edge is in that member's file (fetch `members/<member>.json` for evidence), else null.
- Provenance for a ledger row or a tie without `edge` is derived, not stored: the site links `pac:<id>` and `via` ids to
  `https://www.fec.gov/data/committee/<id>/`.
- `MemberFile.board` lists up to 12 ids of the member's full edges in map order; `MemberFile.nodes` names every
  org or member those full edges reference (ledger rows excluded).
- `member-ties.json` holds member-to-member edges that exist as full edges in some member file, excluding context
  edges (`sits_with`, `legislates_with`): all derived edges, and filed money edges within a member's cap.
- Every edge, kept or not, stays in `pipeline/build/`; counts (`MemberSummary.counts`, `OrgSummary.degree`) include all ties.

## Types

```ts
type NodeRef = { kind: "member" | "org"; id: string };

type MemberSummary = {
  id: string;                 // bioguide
  name: string;               // official display name
  first: string; last: string;
  party: "D" | "R" | "I";     // most recent term; anything other than Democrat/Republican is I
  state: string;              // two-letter, most recent term
  chamber: "sen" | "rep";     // most recent term
  district: number | null;    // House only; 0 = at large
  current: boolean;
  served: [string, string | null]; // first term start, last term end (null if serving)
  photo: boolean;             // true if web/public/portraits/<id>.webp exists at assembly time
  counts: { trades: number; orgs: number; members: number; cases: number }; // all ties, including ledger ties
};

type Term = {
  chamber: "sen" | "rep"; start: string; end: string;
  state: string; district: number | null; party: "D" | "R" | "I";
};

type Committee = { id: string; name: string; role: string | null; current: boolean };
// id is cmte:<thomas id>; subcommittees are cmte:<committee id><subcommittee id> and named "Committee: Subcommittee".
// Only current-Congress assignments are loaded, so current is always true.

type OrgSummary = {
  id: string;
  name: string;
  kind: "company" | "pac" | "party" | "super_pac" | "committee" | "lobby" | "other"; // tk: nodes are "other"
  ticker: string | null;
  cik: number | null;
  sector: string | null;      // SIC major group label (first two SIC digits), when SEC lists a SIC code
  degree: number;             // number of distinct members tied to it (all ties)
  split: PartySplit;          // see "Party split" below
};

// measure -> party -> [distinct members, dollars]. Only measures with at least one tie are present; when one is
// present all three parties are. Dollars are null for "traded".
type PartySplit = { [measure in "given" | "support" | "oppose" | "traded"]?: { D: [number, number]; I: [number, number]; R: [number, number] } };

type EdgeType =
  // member -> org
  | "traded" | "owns" | "position"
  // org -> member
  | "pac_money" | "employee_money" | "lobbyist_money" | "outside_spending" | "paid_travel"
  // member <-> org
  | "revolving_door" | "oversees"
  // member -> member
  | "funds"
  // member <-> member
  | "fundraises_with" | "shared_donors" | "traded_together" | "legislates_with" | "shared_staff" | "sits_with";

// Family of each type (fixed): money = pac_money, employee_money, lobbyist_money, outside_spending, paid_travel,
// funds, fundraises_with, shared_donors; holding = traded, owns, traded_together; people = position,
// revolving_door, shared_staff; context = oversees, legislates_with, sits_with.

type Amount = { low: number | null; high: number | null; exact: number | null }; // nominal USD

type Edge = {
  id: string;                 // stable: sha1 of type|from|to (|via.id appended when via is set), first 12 hex
  type: EdgeType;
  family: "money" | "holding" | "people" | "context";
  basis: "filed" | "derived"; // filed: a record names both ends. derived: statistical rule
  from: NodeRef;              // payer, holder, or first member alphabetically for undirected
  to: NodeRef;
  directed: boolean;
  via: { id: string; name: string } | null; // e.g. the PAC or leadership PAC the money moved through
                              // outside_spending: via.id is "pac:<spender>:support" or "pac:<spender>:oppose" and
                              // note is "support"/"oppose"; the two are separate edges (via is part of the id and of
                              // duplicate aggregation)
  amount: Amount;             // see "Sums" below
  count: number;              // number of underlying records (for traded_together: co-occurrences)
  first: string; last: string; // ISO dates of earliest and latest record
  by_year: { y: number; n: number; low: number | null; high: number | null; exact: number | null }[];
  evidence: Evidence[];       // 1 to 5, largest or most recent first
  evidence_total: number;
  stat: { observed: number; expected: number; lift: number; p: number; method: string } | null; // derived edges only
  weak: boolean;              // true when evidence is thin or incomplete; drawn dashed
  note: string | null;
};

type Evidence = {
  label: string;              // human-readable one-liner
  date: string | null;
  url: string | null;         // link to the official record
  source: string;             // id of a source listed in meta.json.sources
  record: string | null;      // source record id (FEC transaction id, eventId, filing uuid); "a + b" for a pair
};

type Trade = {
  id: string;                 // eventId
  version: number;
  amended: boolean;           // more than one version exists
  date: string | null;        // transaction date as filed
  available: string | null;   // date (US Eastern) the public could first see it (availableAt)
  lag_days: number | null;    // available - date
  late: boolean | null;       // lag_days > 45; null when a date is missing
  owner: "self" | "spouse" | "joint" | "dependent" | "unspecified"; // never defaulted to self
  action: "buy" | "sell" | "exchange" | "other";
  partial: boolean | null;    // partial sale; null for anything but a sale
  ticker: string | null;      // null is preserved, never guessed
  ticker_source: "printed" | "resolved" | null; // printed on the filing, or resolved by the dataset from the
                              // asset name against a securities registry; null when ticker is null
  asset: string;              // description as filed
  asset_class: "stock" | "option" | "fund" | "bond" | "crypto" | "private" | "other" | "unknown"; // from the filed
                              // asset type only; "unknown" when the filing gives none (most House rows)
  low: number | null; high: number | null; // disclosed range; no midpoint stored; high null = open-ended ("over $X")
  org: string | null;         // org id when the ticker resolves (co: or tk:)
  doc: string;                // source filing id; its URL is MemberFile.filings[doc]
};

// Columnar table: each row holds the values of one record in `cols` order.
type Table<C extends string> = { cols: C[]; rows: unknown[][] };

type LedgerRow = {            // a money tie published without evidence
  type: EdgeType; kind: "member" | "org"; other: string; // the other endpoint
  via: string | null;         // via id
  exact: number | null; low: number | null; high: number | null;
  count: number; first: string; last: string; note: string | null;
  dir: "in" | "out" | "both"; // in: this member is the payee; out: the payer; both: undirected
};

type LedgerTotals = { [type: string]: { edges: number; records: number; low: number | null; high: number | null; exact: number | null } };

type OrgTie = {
  type: EdgeType; member: string;
  exact: number | null; low: number | null; high: number | null;
  count: number; first: string; last: string;
  edge: string | null;        // id of the full Edge in members/<member>.json, if published there
};

type Case = {                 // a member-org pair with several kinds of tie at once (rule below)
  id: string;                 // sha1 of case|member|org, first 12 hex
  member: string; org: string;
  types: EdgeType[];          // distinct filed edge types active in the overlap window
  edges: string[];            // edge ids, all published as full edges in the member's file
  years: [number, number];    // overlap window (intersection of the chosen types' year spans)
  score: number;              // number of distinct types; a ranking aid, not a finding
  money: number;              // sum of the chosen money edges' amounts (exact, else high, else low)
  trades: number;             // number of trades in the chosen traded edge (0 if none)
};
// Case rule (CASE_MIN_TYPES = 2, also in meta.json.publication_budget.case_rule): at least 2 distinct filed edge
// types between the pair, at least one of family holding and at least one of family money or people, all active in
// a common year (year spans from first/last). cases.json is sorted by score, then money, then trades.

type MemberFile = {
  member: MemberSummary & { terms: Term[]; committees: Committee[]; fec_ids: string[] };
  edges: Edge[];              // full edges for this member (see Publication budget)
  board: string[];            // up to 12 edge ids for the map: case edges first, then money, holding, people,
                              // context, each by size
  nodes: { [id: string]: { name: string; kind: OrgSummary["kind"] | "member"; ticker: string | null } };
  ledger: Table<keyof LedgerRow>; // cols: type, kind, other, via, exact, low, high, count, first, last, note, dir
  ledger_totals: LedgerTotals; // every tie published as a ledger row or not published at all
  trade_summary: {
    count: number; first: string | null; last: string | null; late: number;
    by_year: { [year: string]: number };   // "none" for trades without a transaction date
    by_owner: { [owner: string]: number }; by_action: { [action: string]: number };
  };
  cases: Case[];
  coverage: { year: number; trades: "full" | "partial" | "none" | "n/a"; money: "full" | "partial" | "none" }[];
};

type TradeFile = {           // trades/<memberId>.json
  cols: (keyof Trade)[];      // id, version, amended, date, available, lag_days, late, owner, action, partial,
                              // ticker, ticker_source, asset, asset_class, low, high, org, doc
  rows: unknown[][];          // newest first, current versions only
  filings: { [doc: string]: string }; // filing id -> official filing URL
};

type OrgFile = {
  org: OrgSummary;
  ties: Table<keyof OrgTie>;  // cols: type, member, exact, low, high, count, first, last, edge; largest first
  ledger_totals: LedgerTotals; // money ties not listed in ties
  chambers: { rep: number; sen: number }; // distinct members tied to it (all ties) by MemberSummary.chamber; sums to degree
  years: [number, number];    // earliest first year and latest last year over all its ties
};

type Wall = {                 // wall.json, rows sorted by id, one per member in members.json
  cols: ["id", "name", "last", "party", "state", "chamber", "district", "current", "photo", "cases", "trades",
         "pac", "support", "oppose", "orgs"];
  rows: unknown[][];          // current and photo are 0/1; cases, trades and orgs equal MemberSummary.counts;
                              // pac = dollars of pac_money received; support / oppose = outside_spending dollars
                              // supporting / opposing the member (exact, else high, else low per tie; all years)
};

type WallYears = {            // wall-years.json, rows sorted by id, one per row of wall.json
  years: [number, number];    // [2000, current year]
  cols: ["id", "terms", "cases", "trades", "pac", "oppose"];
  rows: unknown[][];
  // terms: [start year, end year, chamber, party, state][], inclusive calendar years served (the Coverage rule: a term
  //   ending on 3 January does not count that year), clipped to 2000, consecutive terms with the same chamber, party
  //   and state merged. A member serves in year y when some term covers y; when two do (a switch), the later-starting
  //   one gives that year's party, chamber and state.
  // cases, trades, pac, oppose: sparse flat [year, value, year, value, ...] arrays, ascending years, zero years omitted.
  //   cases = the member's Cases whose `years` window includes the year; trades = trades by transaction date (else
  //   availability date); pac = pac_money dollars received, oppose = outside_spending against, from each edge's
  //   by_year (exact, else high, else low), rounded to whole dollars. A year can be negative (refunds exceed receipts)
  //   and money years can precede 2000 (the 2000 cycle starts in 1999).
  first: { trades: { rep: number; sen: number }; cases: number; money: number }; // first year with data per measure
};
// Validation: trades by year sum to wall.json `trades`; pac / oppose by year sum to wall.json within rounding; cases
// by year equal the count of the member's cases.json windows covering that year.

type OrgIndex = {             // org-index.json
  cols: ["id", "name", "kind", "ticker", "members_D", "members_I", "members_R", "dollars_D", "dollars_I", "dollars_R", "degree"];
  rows: unknown[][];          // sorted by id; members_* = distinct CURRENT members with a pac_money or outside_spending
                              // tie, by party; dollars_* = pac_money dollars to current members, by party; degree as OrgSummary
  by_members: number[];       // row indexes, top 300 by members (then dollars, then id)
  by_dollars: number[];       // row indexes, top 300 by dollars > 0 (then members, then id)
};

type Board = {
  states: { [state: string]: string[] };        // current member ids, senators first
};
```

### Party split

`OrgSummary.split` (in `orgs.json` and in each `OrgFile.org`; it adds about 1 MB, keeping `orgs.json` near 3 MB) is
computed from **every** tie between the org and a member, full edges and ledger rows alike, current and former members:

- `given`: `pac_money` ties (money the org's PAC gave to a member's campaign committee);
- `support` / `oppose`: `outside_spending` ties whose `note` is `support` / `oppose` (independent expenditures for or
  against the member);
- `traded`: `traded` ties (the member's household traded the org's stock); member counts only, dollars null.

Members are counted once per measure. Each member is counted under the party of their `MemberSummary` (most recent
term), so a member who switched party is counted under the later party for all years. Dollars sum each tie's
`amount.exact`, else `high`, else `low` (FEC money is always exact). The validator checks that the dollars equal the
org's listed ties plus `ledger_totals`, and that the members equal the listed ties by party where every tie is listed.

### Coverage

One entry per year 2000..current year in which the member held office (a term ending on 3 January does not count).
`trades`: `n/a` before 2012; `none` before the first year with filings for the chamber in the trade dataset (House
2014, Senate 2012); `partial` for that first year when it starts after January, the current year, and years with a
failed-extraction filing by the member; otherwise `full`. `money`: what a money plug-in declares for the chamber(s) served that
year (the weaker level if both), for members with at least one FEC id; otherwise `none`. The FEC module declares House
`full` and Senate `partial` before 2019 (paper filings keyed by a contractor), `full` from 2019, for the calendar years
of the loaded cycles (2000 cycle = 1999-2000 onward).

## Rules the pipeline must keep

- Amendments: use the current event version (`supersededAt` is null); keep `version` and `amended`.
- Owner and filer are separate. An unlabelled owner is `unspecified`.
- Missing tickers, dates and amounts stay null. Missing is not zero.
- FEC money is exact: for FEC edges and ledger rows `low = high = exact`.
- Amounts are disclosed ranges. No midpoint is stored. **Sums**: `low` adds the known lows and is null only when no
  record has one (a lower bound stays valid); `high` and `exact` are null as soon as any record lacks them. `by_year`
  entries follow the same rule and always sum to the edge totals.
- `by_year`, `first` and `last` use the record date; a trade without a transaction date uses its availability date.
- Joins must not multiply rows; the pipeline asserts row counts before and after each join and reports unmatched records.
- Exclusions (non-members, failed extractions) are counted and listed in `meta.json`.
- Derived edges are drawn only when they clear a published threshold over a baseline, and always carry `stat`.
- `sits_with` and `legislates_with` are context edges. They never count toward a `Case`.
- `sits_with`: one edge per member pair sharing at least one current full committee (not subcommittee); `count` is the
  number of shared committees, `note` lists them, evidence links to each committee's page; `first`/`last` are the
  date the upstream roster file last changed (its Last-Modified header).
- `traded`: one edge per member and org (all asset classes), summing every current trade; up to 5 evidence trades;
  `weak` when any trade lacks a date or a closed amount range.

### `traded_together` rule

Eligible trades: buys and sells with a transaction date and a ticker, whose asset class is not `fund`, `bond` or
`unknown`; a trade whose filing gives no asset type (`unknown`) is eligible only when its ticker resolves to an SEC
company that has a SIC code in the SEC Financial Statement Data Sets and is not a pooled vehicle (SIC 6221, 6726).
Each member's trades are reduced to one row per org, direction and day. An occasion is a pair of such rows from two
members on the same org and direction with dates at most 7 days apart. Baseline: 200 permutations (fixed seed)
shuffling each member's trade dates among that member's own eligible rows within the same calendar year, so each
member keeps their tickers and their trading days; `expected` is the mean co-occurrence count (floored at 1/200 when
no shuffle produced one) and `p` is (shuffles with at least the observed count + 1) / 201. An edge is kept when the
pair has at least 3 distinct tickers or 5 occasions, observed >= 5 and observed >= 3 x expected. It is `weak` when
p > 0.05 or fewer than 3 distinct tickers are involved.

### Lobbying (`pipeline/lda/`, source `lda`)

Source: the Lobbying Disclosure Act REST API (`https://lda.gov/api/v1/`), cited with its access date. The Senate
Office of Public Records cannot vouch for the data; `sources/lda.json` carries that disclaimer verbatim.

**Org ids.** A registrant (lobbying firm or in-house organisation) or a client resolves to a company only by exact
normalised name through `company_names.json`, or through `org_overrides.csv` rows with source `lda_registrant` /
`lda_client` (`source_id_or_name` = LDA id or name). Otherwise: `lda:registrant-<LDA registrant id>` (kind `lobby`)
and `lda:client-<LDA client id>` (kind `other`). A lobbyist named in `via` is `lda:lobbyist-<LDA lobbyist id>`.

**Member identification** (shared by both edge types; nothing is fuzzy):
- *Person name key*: accents removed, uppercase, periods and apostrophes deleted, parenthesised text removed (`(R-SD)`),
  hyphens and other punctuation become spaces. A member's keys are their official name, `first last` from the spine
  and each FEC candidate name of theirs (`LAST, FIRST M` reordered), each with and without a filed suffix (Jr., III).
- *Honoree rule*: leading titles are stripped (Sen., Senator, Rep., Representative, Congressman, Congresswoman, Hon.,
  The Honorable, Del., Speaker, Leader, Chairman, Whip, Mr./Ms./Dr. ...); the rest (or a single-comma `Last, First`
  reordered) must equal a key of exactly one member serving in the contribution's calendar year (spine terms; a term
  ending on 3 January does not count). Fewer than two words (surname only) or two serving members with the key: no match.
- *Payee rule*: the payee's normalised name (the org normalisation above) equals the name, in any FEC cycle, of a
  committee authorised by or a leadership PAC sponsored by exactly one member (FEC module's cache, read-only).
- Order: payee rule; if the payee is another FEC committee (party, joint fundraising, super PAC) the item is not
  attributed; else the honoree rule; else the payee read as a person name. Payee and honoree naming different members:
  unmatched (`conflict`). The rule used is in each evidence label (`[match: ...]`) and counted in the report.

**`lobbyist_money`** (org -> member, money, filed, directed): LD-203 items of type FECA, honorary expense and meeting
expense; presidential library and inaugural items are excluded and counted. One edge per registrant, member and
`via` (the individual lobbyist whose own report lists the item; null for the registrant's report). `exact = low =
high` = sum of items; `by_year` by contribution date. `weak` when the edge has no FECA item, or has a FECA item over
$10,000 (above any contribution limit; kept as filed, listed in the report as a probable filer error).
Amendments: per filer (registrant, lobbyist or none), year and period only the latest-posted report is used.
Double reporting: within a registrant and period an identical item (contributor, payee, honoree, type, amount, date)
on several reports is kept once (the registrant's own report first, else the lowest lobbyist id); a lobbyist's
identical item under two registrants is kept once. Removed counts are in `report.contributions.duplicates_removed`.
Evidence: label (payer, amount, type, payee, honoree, date, filer, match rule), the report's official document URL,
`record` = filing uuid.

**`revolving_door`** (member <-> org, people, filed, undirected; `from` is the member): a lobbyist on an LD-2 filing
whose covered-position text names a member's office, to the filing's CLIENT; `via` = lobbyist and registrant(s).
The text is split on `;` `,` `/` ` - ` `and` `for` `to`; a segment mentioning a committee, subcommittee, caucus,
conference or commission is never attributed. In each other segment, the words after the last office title (Sen.,
Rep., Congressman, Congresswoman, Delegate, Office of, Leader, Speaker, Whip) or the whole segment, with year tokens
removed, must be one key of exactly one member who served in any year up to the filing year. `weak` when no matched
segment carried an office title. Amendments: latest-posted filing per registrant, client, year and period. Evidence:
up to 5 filings listing that lobbyist for that client, with the position text quoted; `by_year` by filing year.

**Coverage.** `sources/lda.json` has `coverage.lobbying.contributions` and `coverage.lobbying.revolving_door`:
`{ "<filing year>": "full" | "partial" }`, `full` when every cached slice of that year is complete. Years not listed
were not loaded. `report.cache.stale_days` is the age of the newest posting cutoff.

## Intermediate plug-in format

Each source module writes, under `pipeline/build/`:

- `edges/<source>.jsonl`: one `Edge` per line, without `id`.
- `orgs/<source>.jsonl`: one `OrgSummary` per line, without `degree`.
- `sources/<source>.json`: `{ "sources": { "<source id>": { "name", "url", "revision", "retrieved", "licence", "files"?: [...] } }, "report": { ... }, "coverage"?: { "money": { "rep" | "sen": { "<year>": "full" | "partial" } } } }`.
  Every `Evidence.source` must be a key of some `sources` object. `report` is free-form (row counts, unmatched records,
  exclusions) and is copied to `meta.json.reports.<file stem>`. `coverage.money` applies to members with an FEC id.
  `coverage.lobbying` (LDA module) is `{ "contributions" | "revolving_door": { "<year>": "full" | "partial" } }`.

### Org overrides (`pipeline/crosswalk/org_overrides.csv`)

Columns: `source, source_id_or_name, org_id, note, reviewed_by, reviewed_on`. Rows without `reviewed_by` are ignored.
`source` is case-insensitive:
- `ticker`: `source_id_or_name` is a ticker as filed or in normalised form (`BRK.B`); applied by `companies.py`.
- `fec`, `fec_committee` or `fec_connected_org`: `source_id_or_name` is an FEC committee id (`C` + 8 digits) or a PAC
  connected-organisation name (normalised before lookup); applied by `pipeline/fec/`.
`org_id` is the target id (`co:<CIK>` and so on).

The assembler picks up every `*.jsonl` and `*.json` in those directories, merges orgs by id (first non-null field
wins, files in name order; `company` kind wins), assigns edge ids, aggregates duplicates of the same
type/from/to/via, and writes the files above. Edges with an unknown endpoint, an unlisted evidence source, no evidence
or an invalid type/family are dropped and counted in `meta.json.unmatched.edges_dropped_at_assembly`.

## Holdings and net worth

Source: House annual financial disclosure reports (Schedule A assets, Schedule D liabilities) as extracted by the
Hugging Face dataset `ZipLime/congress-trading` (source id `hf_holdings`; pinned revision, files, SHA-256 and row
counts in `pipeline/build/sources/holdings.json`). Built by `pipeline/holdings/` after `assemble`. **House only, report
years 2013-2025**: the dataset has no Senate annual reports, so senators have no holdings file. The report year is
the "Filing Year" printed on the form (= the year in the Clerk PDF path), i.e. the calendar year the report covers.

### Files

| File | Contents |
|---|---|
| `holdings-index.json` | `Table` with cols `id, years, latest, nw_low, nw_high, nw_high_valued, nw_label, assets, liabilities, liab_low, liab_high, overlaps` (latest report year), plus `net_worth_definition` |
| `holdings/<id>.json` | `HoldingsFile` for each House member with at least one used report |

```ts
type HoldingsFile = {
  member: { id: string; name: string; chamber: "rep"; state: string; party: "D" | "R" | "I" };
  source: "hf_holdings";
  member_source: ("dataset" | "district_surname")[]; // how the member's documents were linked (rule below)
  net_worth_definition: { name: "disclosed net worth range"; rule: string; excludes: string[]; caveats: string[]; instructions: string };
  docs: { [doc: string]: { url: string; filed: string; amendment: boolean; report_year: number; used: boolean } };
  years: { [reportYear: string]: HoldingsYear };
  portfolio: Table<"group" | "org" | "name" | "sector" | "rows" | "low" | "high" | "share_low" | "share_high" | "owners">
             & { year: number; by_owner: { [owner: string]: BandSum } }; // latest report year only
  overlaps: Overlap[];
  coverage: { year: number; status: "used" | `not_extracted:${string}` | "no_annual_report_in_dataset" }[];
};

type HoldingsYear = {
  doc: string;                // the one document used for this year (see Amendments)
  assets: Table<"row" | "asset" | "ticker" | "ticker_source" | "org" | "category" | "owner" | "low" | "high" |
                "income_type" | "income_low" | "income_high" | "location" | "doc">;
  liabilities: Table<"row" | "creditor" | "type" | "owner" | "low" | "high" | "incurred" | "residence_secured" | "doc">;
  totals: { assets: BandSum; liabilities: BandSum; liabilities_residence_secured: BandSum; assets_by_owner: { [owner: string]: BandSum } };
  net_worth: { low: number | null; high: number | null; high_valued: number | null;
               label: "range" | "valued items only" | "at least" | "unbounded";
               unvalued_assets: number; open_ended_assets: number; open_ended_liabilities: number };
};
// Asset row: row = the dataset's row suffix (dataset id is house_<doc>_<row>); asset = text as filed, after redaction;
// ticker = printed ticker only (ticker_source "printed"), else null; org = co:/tk: id from the ticker by the
// companies.py rules, else null; category = the dataset's bucket (stock | bond | option | other), not a filed code;
// owner as below; low/high = value band (both null: no value; high null alone: open-ended "Over $X");
// income_type and income band as filed (null when not filed); location = "City, ST" for real property, else null.
// Liability row: creditor and type as filed (redacted), incurred = date incurred as filed (free text),
// residence_secured = rule below.

type BandSum = { n: number; unvalued: number; open_ended: number; low: number;
                 high: number | null;        // null when any item is unvalued or open-ended
                 high_valued: number | null }; // over valued items only; null when any is open-ended

type Overlap = {              // a holding and a filed tie with the same org in the same calendar year
  year: number; org: string;
  holding: { rows: string[]; low: number; high: number | null; owners: string[]; doc: string; url: string };
  ties: ({ type: "traded"; edge: string; trades: number }
       | { type: "pac_money"; edge: string; via: string | null; exact: number | null; records: number; evidence: Evidence[] })[];
};
```

### Rules

- **Members.** A document is linked to the dataset's `bioguide_id` only when the filing's state/district (at-large
  seats may be coded 01; American Samoa AQ) is one that member held in the report year or the next. Otherwise, or
  when the dataset has no id, a unique exact match on normalised surname (accents folded) + state/district + a House
  term overlapping the report year or the next (`district_surname`). No similarity matching. Everything else is
  excluded and counted (`unlinked_filer`, `bioguide_district_mismatch`, `member_not_in_spine`).
- **Amendments.** Per member and report year, a document set is used only when it contains an annual report
  (Clerk type O); the latest filed document of the set is used (an amendment when one exists; House amendments
  restate the whole report). Earlier documents stay in `docs` with `used: false` and are counted. An amendment
  without an annual report for that member and year (typically a candidate report's amendment) is excluded.
- **Owner.** `spouse` (SP), `joint` (JT), `dependent` (DC) as printed. The House form prints nothing for the filer, and
  the dataset maps blank and unrecognised owner text alike to `self`; that is published as `unspecified`, never `self`.
- **Ranges.** Bands are the disclosed ranges; no midpoint is stored. Asset value is at the end of the report year;
  a liability is the highest amount owed during it. A missing value is null, never 0.
- **Disclosed net worth range** (`net_worth`): low = sum of asset lows − sum of liability highs; high = sum of asset
  highs − sum of liability lows. Unvalued assets add 0 to low (values are never negative) and make high null;
  `high_valued` is the same figure over valued assets. An open-ended asset band makes high null and the figure reads
  "at least" low; an open-ended liability makes low null. Liabilities flagged `residence_secured` are listed and
  totalled separately but not subtracted, because the residence is not reported as an asset. A midpoint may be shown
  in the site only as a labelled assumption.
- **What the figure excludes by law** (House Committee on Ethics, *Instruction Guide, Financial Disclosure Reports and
  Periodic Transaction Reports, Calendar Year 2025*, 2026, Schedule A "Exclusions" and Schedule D; SHA-256 in the
  source report): personal residences and non-rental second or vacation homes, and (here) mortgages on them; federal
  retirement benefits including the Thrift Savings Plan; non-interest-bearing deposits; personal property not held for
  investment; debts owed by relatives or interest-free; term life insurance; HSA/FSA cash; assets at or under the
  reporting threshold and liabilities of $10,000 or less; a separated spouse's finances; the contents of excepted and
  qualified blind trusts; the open-ended "Spouse/DC over $1,000,000" band. Schedules C and E-J (earned income,
  positions, gifts, travel, agreements) are not in the source. It is not a measure of true net worth.
- **Tickers.** Kept only when printed in parentheses in the asset text (case-insensitive; the PDFs' small capitals
  extract as e.g. `aXP`); the dataset's `name_lookup` tickers that are not printed are dropped and counted. Resolution
  to `co:` follows the Tickers rule above (exact, veto, reviewed overrides); a ticker already resolved for trades keeps
  that id; the rest become `tk:<TICKER>`.
- **Real property and residences.** Publish only what the filing prints, at city/state granularity at most: the
  dataset's Location is cut to "City, ST". Street addresses are replaced by `[street address redacted]` in asset,
  creditor and liability-type text (number + street suffix everywhere; in real-property text also a house number
  followed by a name, and a street name without a number), and counted. Nothing is geocoded. An asset whose text names
  a personal residence or non-rental second home is never published (counted as `personal_residence`).
  `residence_secured` marks a liability whose type or creditor names a residence, home mortgage or home equity
  (and not rental, investment, commercial, farm or business).
- **Portfolio.** Latest report year; rows grouped by `org` when resolved, else by the asset text (`asset:<text>`);
  `share_low` = group low / total low, `share_high` = group high / total high (null when either is null); `sector`
  is the SIC major-group label from `companies.json` when SEC lists a SIC code.
- **Overlaps.** For each report year, an org held that year that also has a `traded` edge with a trade in that
  calendar year, or a full `pac_money` edge with money in that calendar year, in the member's published file.
  Ledger-only money rows have no years and are not checked (counted in the report).
- **`owns` plug-in edges** (`pipeline/build/edges/holdings_owns.jsonl`): one per member and org (resolved assets only),
  family `holding`, basis `filed`, directed member → org. A holding is a stock, not a flow, so `amount`, `count` and the
  single `by_year` entry describe the latest report year that lists the org (they sum, as required); `first`/`last`
  are the filing dates of the earliest and latest reports listing it, and `note` names every year. Evidence: one entry
  per report (latest first, up to 5), `record` = dataset row ids; `weak` when the latest range is not closed.
- **Joins.** Holdings → filings and liabilities → filings are asserted 1:1; every document maps to one bioguide id;
  published rows + residence exclusions equal the rows of the used documents.
- **Validation.** `python -m pipeline.holdings.validate` re-derives every total and net-worth range, checks owners,
  document URLs, redaction and edges, and writes `docs/validation/holdings-sample.csv` (25 rows, seed 20261113, with a
  machine check that the asset words and the band figures occur in the PDF text, and empty columns for a human).
