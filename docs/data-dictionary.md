# Data dictionary and build contract

This file is the contract between the data pipeline (`pipeline/`) and the site (`web/`).
The pipeline writes JSON under `web/public/data/`; the site only reads those files.
Change this file first when a field changes.

## Scope

- People: every member of the House or Senate with a term overlapping 2000-01-01 or later. Current members are flagged.
- Trades: periodic transaction reports, July 2012 onward (the STOCK Act created them; nothing earlier exists).
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
Matching is exact on a normalised name, plus a hand-reviewed override file. Similar names are never matched automatically. Unmatched records stay as their own nodes and are counted in `meta.json`.

## Files in `web/public/data/`

| File | Contents |
|---|---|
| `meta.json` | Build time, each source's revision and retrieval date, row counts, unmatched counts, coverage notes |
| `members.json` | Array of `MemberSummary` |
| `members/<id>.json` | `MemberFile`: one member's full record, edges, trades, cases, coverage |
| `orgs.json` | Array of `OrgSummary` (only orgs with at least one edge) |
| `orgs/<shard>.json` | `{ [orgId]: OrgFile }`, where shard is the first two hex characters of `sha1(orgId)` |
| `board.json` | What the map needs without loading profiles |
| `member-ties.json` | Array of every member-to-member `Edge` |
| `cases.json` | Array of `Case`, strongest first |

## Types

```ts
type NodeRef = { kind: "member" | "org"; id: string };

type MemberSummary = {
  id: string;                 // bioguide
  name: string;               // official display name
  first: string; last: string;
  party: "D" | "R" | "I";     // most recent term
  state: string;              // two-letter, most recent term
  chamber: "sen" | "rep";     // most recent term
  district: number | null;    // House only; 0 = at large
  current: boolean;
  served: [string, string | null]; // first term start, last term end (null if serving)
  photo: boolean;             // true if web/public/portraits/<id>.webp exists
  counts: { trades: number; orgs: number; members: number; cases: number };
};

type Term = {
  chamber: "sen" | "rep"; start: string; end: string;
  state: string; district: number | null; party: "D" | "R" | "I";
};

type Committee = { id: string; name: string; role: string | null; current: boolean };

type OrgSummary = {
  id: string;
  name: string;
  kind: "company" | "pac" | "party" | "super_pac" | "committee" | "lobby" | "other";
  ticker: string | null;
  cik: number | null;
  sector: string | null;      // SIC-based label when known
  degree: number;             // number of distinct members tied to it
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

type Edge = {
  id: string;                 // stable: sha1 of type|from|to, first 12 hex
  type: EdgeType;
  family: "money" | "holding" | "people" | "context";
  basis: "filed" | "derived"; // filed: a record names both ends. derived: statistical rule
  from: NodeRef;              // payer, holder, or first member alphabetically for undirected
  to: NodeRef;
  directed: boolean;
  via: { id: string; name: string } | null; // e.g. the PAC or leadership PAC the money moved through
  amount: { low: number | null; high: number | null; exact: number | null }; // nominal USD
  count: number;              // number of underlying records
  first: string; last: string; // ISO dates of earliest and latest record
  by_year: { y: number; n: number; low: number | null; high: number | null; exact: number | null }[];
  evidence: Evidence[];       // up to 5, largest or most recent first
  evidence_total: number;
  stat: { observed: number; expected: number; lift: number; method: string } | null; // derived edges only
  weak: boolean;              // true when evidence is thin or incomplete; drawn dashed
  note: string | null;
};

type Evidence = {
  label: string;              // human-readable one-liner
  date: string | null;
  url: string | null;         // link to the official record
  source: string;             // id of a source listed in meta.json
  record: string | null;      // source record id (FEC transaction id, eventId, filing uuid)
};

type Trade = {
  id: string;                 // eventId
  version: number;
  amended: boolean;           // more than one version exists
  date: string | null;        // transaction date as filed
  available: string | null;   // date the public could first see it (availableAt)
  lag_days: number | null;    // available - date
  late: boolean | null;       // lag_days > 45; null when a date is missing
  owner: "self" | "spouse" | "joint" | "dependent" | "unspecified"; // never defaulted to self
  action: "buy" | "sell" | "exchange" | "other";
  partial: boolean | null;
  ticker: string | null;      // null is preserved, never guessed
  asset: string;              // description as filed
  asset_class: "stock" | "option" | "fund" | "bond" | "crypto" | "private" | "other" | "unknown";
  low: number | null; high: number | null; // disclosed range; no midpoint stored
  org: string | null;         // org id when the ticker resolves
  url: string | null;         // source filing
};

type Case = {                 // a member-org pair with several kinds of tie at once
  id: string;
  member: string; org: string;
  types: EdgeType[];          // distinct filed edge types between the pair, at least 3, overlapping in time
  edges: string[];            // edge ids
  years: [number, number];    // overlap window
  score: number;              // number of distinct types, then money as tiebreak; a ranking aid, not a finding
};

type MemberFile = {
  member: MemberSummary & { terms: Term[]; committees: Committee[]; fec_ids: string[] };
  edges: Edge[];              // every edge touching this member
  trades: Trade[];            // newest first, all versions collapsed to the current one
  cases: Case[];
  coverage: { year: number; trades: "full" | "partial" | "none" | "n/a"; money: "full" | "partial" | "none" }[];
};

type OrgFile = { org: OrgSummary; edges: Edge[] };

type Board = {
  states: { [state: string]: string[] };        // current member ids, senators first
  strings: { [memberId: string]: Edge[] };      // top 12 edges per current member, by family then size
  nodes: { [orgId: string]: OrgSummary };       // every org referenced in strings
};
```

## Rules the pipeline must keep

- Amendments: use the current event version (`supersededAt` is null); keep `version` and `amended`.
- Owner and filer are separate. An unlabelled owner is `unspecified`.
- Missing tickers, dates and amounts stay null. Missing is not zero.
- Amounts are disclosed ranges. Sums add lows and highs separately; no midpoint is stored.
- Joins must not multiply rows; the pipeline asserts row counts before and after each join and reports unmatched records.
- Exclusions (non-members, failed extractions) are counted and listed in `meta.json`.
- Derived edges are drawn only when they clear a published threshold over a baseline, and always carry `stat`.
- `sits_with` and `legislates_with` are context edges. They never count toward a `Case`.

## Intermediate plug-in format

Each source module writes `pipeline/build/edges/<source>.jsonl` (one `Edge` per line, without `id`)
and `pipeline/build/orgs/<source>.jsonl` (one `OrgSummary` per line, without `degree`).
The assembler merges orgs by id, assigns edge ids, aggregates duplicates of the same type/from/to/via, and writes the files above.
