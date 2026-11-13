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
| `members/<id>.json` | `MemberFile`: one member's full record, edges, ledger, trades, cases, coverage |
| `orgs.json` | Array of `OrgSummary`: every org with at least one tie (full edge, ledger row or org tie) |
| `orgs/<shard>.json` | `{ [orgId]: OrgFile }`, where shard is the first two hex characters of `sha1(orgId)` |
| `board.json` | What the map needs without loading profiles |
| `member-ties.json` | Array of member-to-member `Edge`s for graph views (see below) |
| `cases.json` | Array of `Case`, strongest first |

The whole directory is built in a staging directory and swapped into place, so a reader never sees a half-written tree.
All JSON is minified with sorted keys; output is byte-stable between runs on the same inputs, except `meta.json` (build time, retrieval times).

## Publication budget

Full `Edge` objects (with evidence) are written **only in member files**. Constants live at the top of `pipeline/assemble.py`
and are echoed in `meta.json.publication_budget`.

- A member file holds, as full edges: every non-money edge touching the member, every edge in one of the member's Cases,
  and the member's `MONEY_EDGES_PER_MEMBER` (15) largest money edges (by `amount.exact`, else `high`, else `low`).
  A member-to-member money edge is judged separately in each endpoint's file.
- The member's remaining money ties are `ledger` rows (no evidence), largest first. The ledger is complete for current
  members; former members keep their `FORMER_MEMBER_LEDGER_ROWS` (100) largest rows. `ledger_totals` always covers every
  money tie that is not a full edge, so headline totals never need the rows to be summed.
- Org files carry no full edges. `OrgFile.ties` lists every non-money tie and, for money, every tie with the
  `MONEY_MEMBERS_PER_ORG` (200) members with the largest money totals with that org; `ledger_totals` covers the rest.
  `ties.edge` is the edge id when the full edge is in that member's file (fetch `members/<member>.json` for evidence), else null.
- Provenance for a ledger row or a tie without `edge` is derived, not stored: the site links `pac:<id>` and `via` ids to
  `https://www.fec.gov/data/committee/<id>/`.
- `board.json` edges are copies of member-file edges with only their first evidence item (`evidence_total` unchanged).
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
};

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

type Case = {                 // a member-org pair with several kinds of tie at once
  id: string;                 // sha1 of case|member|org, first 12 hex
  member: string; org: string;
  types: EdgeType[];          // distinct filed edge types (money/holding/people) between the pair, at least 3, overlapping in time
  edges: string[];            // edge ids, all published as full edges in the member's file
  years: [number, number];    // overlap window (intersection of the chosen types' year spans)
  score: number;              // number of distinct types; cases.json is sorted by score, then money total; a ranking aid, not a finding
};

type MemberFile = {
  member: MemberSummary & { terms: Term[]; committees: Committee[]; fec_ids: string[] };
  edges: Edge[];              // full edges for this member (see Publication budget)
  ledger: Table<keyof LedgerRow>; // cols: type, kind, other, via, exact, low, high, count, first, last, note, dir
  ledger_totals: LedgerTotals; // every money tie not published as a full edge
  trades: Table<keyof Trade>; // cols: id, version, amended, date, available, lag_days, late, owner, action, partial,
                              // ticker, ticker_source, asset, asset_class, low, high, org, doc; newest first,
                              // current versions only
  filings: { [doc: string]: string }; // filing id -> official filing URL
  cases: Case[];
  coverage: { year: number; trades: "full" | "partial" | "none" | "n/a"; money: "full" | "partial" | "none" }[];
};

type OrgFile = {
  org: OrgSummary;
  ties: Table<keyof OrgTie>;  // cols: type, member, exact, low, high, count, first, last, edge; largest first
  ledger_totals: LedgerTotals; // money ties not listed in ties
};

type Board = {
  states: { [state: string]: string[] };        // current member ids, senators first
  strings: { [memberId: string]: Edge[] };      // top 12 full edges per current member: case edges first, then
                                                // money, holding, people, context, each by size; 1 evidence item
  nodes: { [orgId: string]: OrgSummary };       // every org referenced in strings
};
```

### Coverage

One entry per year 2000..current year in which the member held office (a term ending on 3 January does not count).
`trades`: `n/a` before 2012; `none` before the first year with filings for the chamber in the trade dataset (House
2014, Senate 2012); `partial` for that first year when it starts after January, the current year, and years with a
failed-extraction filing by the member; otherwise `full`. `money`: what a money plug-in declares (see plug-in format)
for members with at least one FEC id; otherwise `none`.

## Rules the pipeline must keep

- Amendments: use the current event version (`supersededAt` is null); keep `version` and `amended`.
- Owner and filer are separate. An unlabelled owner is `unspecified`.
- Missing tickers, dates and amounts stay null. Missing is not zero.
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

## Intermediate plug-in format

Each source module writes, under `pipeline/build/`:

- `edges/<source>.jsonl`: one `Edge` per line, without `id`.
- `orgs/<source>.jsonl`: one `OrgSummary` per line, without `degree`.
- `sources/<source>.json`: `{ "sources": { "<source id>": { "name", "url", "revision", "retrieved", "licence", "files"?: [...] } }, "report": { ... }, "coverage"?: { "money": { "<year>": "full" | "partial" } } }`.
  Every `Evidence.source` must be a key of some `sources` object. `report` is free-form (row counts, unmatched records,
  exclusions) and is copied to `meta.json.reports.<file stem>`. `coverage.money` applies to members with an FEC id.

The assembler picks up every `*.jsonl` and `*.json` in those directories, merges orgs by id (first non-null field
wins, files in name order; `company` kind wins), assigns edge ids, aggregates duplicates of the same
type/from/to/via, and writes the files above. Edges with an unknown endpoint, an unlisted evidence source, no evidence
or an invalid type/family are dropped and counted in `meta.json.unmatched.edges_dropped_at_assembly`.
