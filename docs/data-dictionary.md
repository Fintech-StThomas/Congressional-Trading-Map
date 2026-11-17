# Data dictionary and build contract

This file is the contract between the data pipeline (`pipeline/`) and the site (`web/`).
The pipeline writes JSON under `web/public/data/` and publishes the same tree to object storage; the site only reads
those files (see "Where the files live"). The tree is not stored in git.
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

## Where the files live

- **Built** by `python -m pipeline.run` into `web/public/data/` (gitignored; a clean checkout has none).
- **Published** by the daily workflow (`.github/workflows/data.yml`, `pipeline/publish_r2.py`) to a Cloudflare R2
  bucket under the key prefix `data/`, only after both validators passed. Public base URL:
  `https://pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data`, so `web/public/data/members/A000001.json` is served at
  `<base>/members/A000001.json`. The production site reads this base (`DATA_BASE_URL`, `web/README.md`).
- **Headers**: every object is plain JSON (no Content-Encoding) with `Content-Type: application/json` and
  `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` (the same URLs are overwritten each build).
- **Manifest**: `<base>/_manifest.json` is `{build_time, prefix, cache_control, files: {<path>: <sha256>}}` for the build in the
  bucket. It is not a data file: the publisher compares against it to upload only changed files, and uploads it
  after every data file.
- **`meta.json` is a completion marker**: it is uploaded after every other data file of a build. This is not an
  atomic switch: mutable objects can change before metadata does, and caches can retain different versions.
  Objects no longer in the build are deleted only after metadata and manifest publication. A failed data-file
  upload leaves previous metadata and manifest in place, but already-uploaded files are not rolled back.

## Offline release manifest (basis of the archive; production cutover pending)

`python -m pipeline.release_manifest --dir <validated-data-tree> --output <outside-tree>/release.json`
creates a deterministic descriptor for a future immutable release. It does not validate the data's meaning,
upload files, sign the release, or change the current publisher. Run the data validators first.

The descriptor is `{schema_version: 1, release_id: <sha256>, files: {<relative POSIX path>: {sha256, bytes}}}`.
It includes every regular file in the tree, including `meta.json`; metadata time changes therefore change the
release ID. `meta.json` must be a JSON object with a non-empty `build.time` string. Symbolic links and special
files are rejected. `_manifest.json` and `release.json` are reserved and must not occur at the root.
The output must be outside the input tree, including after resolving symbolic links.

The release ID is SHA-256 of the UTF-8 encoding of the object `{schema_version: 1, files: ...}`, serialized
with sorted keys, `ensure_ascii=True`, separators `(',', ':')`, and no trailing newline. Each file hash covers
its original bytes. Relative paths and file sizes are part of the identity; filesystem timestamps are not.
There is no self-hash cycle: `release_id` is added after computing the digest. A checksum proves byte identity,
not source accuracy or authorship. Future publishing must preserve the exact files described here.

## Immutable archive publication (opt-in; production cutover pending)

The archive publisher uses a separate fixed `releases/` prefix, outside the legacy publisher's `data/` cleanup.
Content is addressed by hash, so a file that did not change is stored once however many releases contain it:

- `releases/blobs/<sha256>` contains the exact original bytes of one distinct file (`<sha256>` is the file hash
  recorded in descriptors, 64 lowercase hex). Blobs are immutable and never overwritten. Each is stored with
  `Content-Type` chosen by the extension of the first path that uploaded it (`application/json` for `.json`); if two
  paths of different types share bytes, the first type stays and the Worker sets the type from the requested path.
- `releases/<release_id>/release.json` is the release: the descriptor above, encoded as sorted-key compact JSON
  (`ensure_ascii=True`, no trailing newline). It is created only after every blob it names exists and was verified
  (a newly uploaded blob is read back and hashed; an existing one is checked by HEAD for size and headers). A
  release has no other objects.
- Optional `releases/current.json` is `{schema_version: 1, release_id: <sha256>, manifest_sha256: <sha256>}`.
  Its manifest hash covers the exact descriptor bytes, including `release_id`. It contains no user-supplied URLs.
- **Reader contract (unchanged):** `<base>/current.json`, `<base>/index.json` and `<base>/<release_id>/<path>`, where
  `<base>` is `<worker>/releases`. The Cloudflare Worker (`worker/`) resolves `<path>` through the descriptor to
  `releases/blobs/<sha256>`, serves it with the type of the requested path, and answers 404 for a withdrawn or
  unknown release, an unknown path or an invalid id. A descriptor that names a missing blob is corruption (502).
  Readers never address blobs.

Blobs and descriptors use `Cache-Control: public, max-age=31536000, immutable` in the bucket (the Worker sends its own
headers). The pointer uses `Cache-Control: no-cache, max-age=0, must-revalidate`. Object creation is conditional
(`If-None-Match: *`); existing keys must match expected size and cache headers (descriptors also bytes), otherwise
publishing fails without overwriting them. Re-running an interrupted upload reuses matching blobs and completes
missing ones. A tree whose files other than `meta.json` equal the current release's creates no release and leaves the
pointer alone. Publishing and activation never delete objects; only the withdrawal command below does, and only
exact blob and descriptor keys. A source tree must remain unchanged during publication; each uploaded body is
checked against the initial descriptor, and the tree is checked again before completing the release.

Activation captures the current pointer and ETag before work and changes the pointer only after verification,
using `If-Match` on that ETag (or `If-None-Match: *` when absent). Malformed existing pointers and concurrent
changes fail closed. An ambiguous write result is accepted only when a read-back matches the exact desired
pointer. Rollback activates an existing release only after descriptor validation, a HEAD (existence and size) of
every blob, a full read of `meta.json`, and the same pointer precondition (`--full-verify` hashes every blob). An explicit release never silently resolves to latest.

### Release history index (mutable)

`releases/index.json` is `{schema_version: 1, releases: [{release_id, build_time, activated_at}]}`, newest first,
for a future "compare releases" view. `release_id` is the 64-hex ID; `build_time` is the release's `meta.json`
`build.time`; `activated_at` is a UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`. There is one entry per release: activating
a release already in the list (a rollback or roll-forward) moves its entry to the front with a new `activated_at`;
re-running the activation of the release already at the front changes nothing, so a repair re-run is idempotent.
The list holds at most 400 entries (the oldest are dropped; the release objects themselves stay). The file uses the
pointer's `Cache-Control` and is written with the pointer's discipline (`If-Match` on the captured ETag, or
`If-None-Match: *` when absent; bounded retries when it changed concurrently). A malformed existing index fails
closed. It is written only after the pointer has moved. **The pointer is the only authority for which release is
current**; the index is a convenience, is never part of a release hash, and may be repaired by re-running the
activation. Readers must not use it to decide what is current.

### Withdrawal tombstone

For discovered privacy or legal exposure only, `python -m pipeline.withdraw_release` writes
`releases/withdrawn/<release_id>.json` = `{schema_version: 1, release_id, withdrawn_at, reason}` first, where
`reason` is one of `privacy`, `legal`, `other` (no free text) and `withdrawn_at` is a UTC timestamp. It is
written with `If-None-Match: *` and the pointer's no-cache headers. It then deletes exactly the
`releases/blobs/<sha256>` keys that no other live (non-withdrawn) release references, then the descriptor, and removes
the entry from the index. Blobs shared with other live releases are kept; if those bytes hold the exposed data
(`--exposed-path`, default: any file of the release) the other releases are exposed too, and the command refuses
unless `--also-withdraw` names all of them. The current release cannot be withdrawn. Publishing
or activating a release that has a tombstone is refused. Normal corrections publish a new release; old bytes are
never rewritten.

Cited-release semantics: a citation names a `release_id`. If that release was withdrawn, or its objects are
absent, the reader must say the release is not available. It must never substitute the latest release.
A tombstone does not recall copies already held by browsers, CDN caches, or earlier page deployments.

### Provider check prefix

`python -m pipeline.release_provider_check` writes and deletes only under `release-provider-check/<random id>/`.
Nothing there is read by any reader.

Descriptor validation includes its schema, release ID, canonical identity, file hash/size types, required
`meta.json`, and safe relative POSIX paths (no empty/dot/traversal segments, backslashes, colons, control
characters, reserved root filenames, or absolute paths). This protects remote verification from fetching keys
outside the specified release.
Build identity and completeness do not prove filing accuracy, redaction, or source authenticity. Callers must
run the pipeline's data/privacy validators before archiving. Production activation also requires PR checks,
provider conditional-write verification (`release_provider_check`), release-pinned readers, and the withdrawal
process above. Operating procedure: `docs/RELEASE-OPERATIONS.md`.

## Files in `web/public/data/`

| File | Contents |
|---|---|
| `meta.json` | Build time, each source's revision and retrieval date, row counts, unmatched counts, exclusions, coverage notes, publication budget, largest files |
| `members.json` | Array of `MemberSummary` |
| `members/<id>.json` | `MemberFile`: one member's full record, edges, board, nodes, ledger, trade summary, cases, campaign finance, coverage |
| `trades/<id>.json` | `TradeFile`: every current trade of one member (only members with trades) |
| `orgs.json` | Array of `OrgSummary`: every org with at least one tie (full edge, ledger row or org tie) |
| `orgs/<shard>.json` | `{ [orgId]: OrgFile }`, where shard is the first two hex characters of `sha1(orgId)` |
| `board.json` | `Board`: current member ids by state; the strings themselves come from each member file |
| `member-ties.json` | Array of member-to-member `Edge`s for graph views (see below) |
| `cases.json` | Array of `Case`, strongest first |
| `wall.json` | `Wall`: one compact row per member (all members, current flagged) for the wall view; a single fetch |
| `wall-years.json` | `WallYears`: per member, terms by year and sparse per-year measures, so the wall can be drawn for any year 2000..current year; a single fetch (about 350 KB, 120 KB gzipped) |
| `org-index.json` | `OrgIndex`: the top organisations by current members reached and by dollars to current members, split by party, so the site can browse organisations without shipping `orgs.json` |
| `delays.json` | `Delays`: site-wide and per-member counts of elapsed days from transaction date to public availability, in bands (see "Disclosure timing") |

The whole directory is built in a staging directory and swapped into place, so a reader never sees a half-written tree.
All JSON is minified with sorted keys; output is byte-stable between runs on the same inputs, except `meta.json` (build time, retrieval times).

## Publication budget

Full `Edge` objects (with evidence) are written **only in member files**. Constants live in `pipeline/config.py`
and are echoed in `meta.json.publication_budget` (type `Meta`).

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
  campaign_finance: CampaignFinance | null; // FEC loans and leadership PAC spending; null = no FEC candidacy row and no leadership PAC row
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
                              // tie, by party at the time of the tie; dollars_* = pac_money dollars to current members,
                              // by party at the time; degree as OrgSummary (see "Party split")
  by_members: number[];       // row indexes, top 300 by members (then dollars, then id)
  by_dollars: number[];       // row indexes, top 300 by dollars > 0 (then members, then id)
};

type Board = {
  states: { [state: string]: string[] };        // current member ids, senators first
};

// meta.json: provenance and counts for the whole build. Only `build.time`, `build.pipeline_commit` and the
// retrieval/generation times inside `sources` and `reports` change between two runs on the same inputs.
type Meta = {
  build: { time: string; pipeline_commit: string | null; contract: "docs/data-dictionary.md" }; // ISO 8601 UTC
  sources: { [id: string]: Source };   // every Evidence.source is a key here
  reports: { [plugin: string]: object }; // each plug-in's free-form report, keyed by its sources/<file stem>.json
                                          // (fec, hf_trades, holdings, legislators, sec, trade_edges; lda when on)
  counts: {
    members: number; current_members: number; trades: number; orgs: number; cases: number; org_shards: number;
    edges: number; edges_by_type: { [type: string]: number };            // every tie, published or not
    edges_full: number; edges_full_by_type: { [type: string]: number };  // published as full Edges in member files
    member_ties: number;               // edges in member-ties.json
    ledger_money_ties: number;         // money ties that are ledger rows rather than full edges
    ledger_rows_published: number; ledger_rows_former_members_cut: number;
  };
  publication_budget: {               // the constants of pipeline/config.py, see "Publication budget"
    money_edges_per_member: number; former_member_ledger_rows: number; money_members_per_org: number;
    ledger_only_types: string[]; case_rule: string; case_min_types: number; rule: string;
  };
  unmatched: { trades_without_ticker: number | null; tickers_without_sec_match: number | null;
               trades_with_unmatched_ticker: number | null; edges_dropped_at_assembly: { [reason: string]: number } };
  exclusions: { [what: string]: { rows: number; reason: string; filings?: unknown[][]; members?: string[] } }; // trades
  assembly: { edges_read: { [file: string]: number }; edges_after_merge: number;
              edges_dropped: { [reason: string]: number }; edges_dropped_examples: { [reason: string]: string[] };
              org_files: string[];
              // "Party split": tie-years outside every term (counted under the nearest term), and dollars counted
              // under a party other than the member's latest one
              party_split: { rule: string; tie_years_outside_terms: number; edges_with_years_outside_terms: number;
                             dollars_outside_terms: number; members_with_dollars_under_another_party: number;
                             dollars_under_another_party: number } };
  coverage_notes: string[];
  files: { count: number; bytes: number; largest: { [path: string]: number } }; // assembled files (holdings excluded)
};

type Source = {
  name: string; url: string; licence: string;
  revision: string | null;            // commit SHA, Last-Modified or latest file date, whichever the source offers
  retrieved: string | null;           // earliest retrieval time of its files
  files?: { path: string; sha256: string | null; rows?: number; bytes?: number; url?: string; last_modified?: string | null }[];
  [extra: string]: unknown;           // e.g. hf_trades.snapshot_generated, sec.fsds_quarters
};
```

### Party split

`OrgSummary.split` (in `orgs.json` and in each `OrgFile.org`; it adds about 1 MB, keeping `orgs.json` near 3 MB) is
computed from **every** tie between the org and a member, full edges and ledger rows alike, current and former members:

- `given`: `pac_money` ties (money the org's PAC gave to a member's campaign committee);
- `support` / `oppose`: `outside_spending` ties whose `note` is `support` / `oppose` (independent expenditures for or
  against the member);
- `traded`: `traded` ties (the member's household traded the org's stock); member counts only, dollars null.

Each tie counts under the member's party **at the time of the tie**, not their latest party: the tie's `by_year`
amounts (each year's `exact`, else `high`, else `low`; any remainder against the tie's size goes to its latest year,
and a tie without `by_year` counts in the year of `last`) are split by the party of the member's term in that year.
`by_year` is net per year, so a party's share of one tie can come out negative (refunds); that deficit is netted
against the tie's other parties, largest first, so no share is negative and the shares still sum to the tie.

- A year inside a term follows the coverage rule (a term ending on 3 January does not count that year). When two terms
  in different parties share a year, the term covering more days of it wins; equal days go to the later term.
- A year outside every term (money to a challenger before taking office, a former member's leftover committee) goes
  to the nearest term in time (equal distance: the later term). How often this happens is reported in
  `meta.json.assembly.party_split`.
- A member is counted once per measure **per party they were tied under**: a party switcher with ties on both sides
  of the switch counts under both parties, so the member counts can sum to more than the distinct members.

Dollars sum each tie's `amount.exact`, else `high`, else `low` (FEC money is always exact). `org-index.json` applies
the same rule to current members. The validator checks that the dollars equal the org's listed ties plus
`ledger_totals`, and, where every tie of a type is listed, that each party's members and dollars lie between the ties
whose whole span (first to last year) falls in that party and the ties whose span touches it.

### Coverage

One entry per year 2000..current year in which the member held office (a term ending on 3 January does not count).
`trades`: `n/a` before 2012; `none` before the first year with filings for the chamber in the trade dataset (House
2014, Senate 2012); `partial` for that first year when it starts after January, the current year, and years with a
failed-extraction filing by the member; otherwise `full` (the weaker level if both chambers were served that year). `money`: what a money plug-in declares for the chamber(s) served that
year (the weaker level if both), for members with at least one FEC id; otherwise `none`. The FEC module declares House
`full` and Senate `partial` before 2019 (paper filings keyed by a contractor), `full` from 2019, for the calendar years
of the loaded cycles (2000 cycle = 1999-2000 onward).

## Disclosure timing (`delays.json`)

Observed elapsed days between each trade's transaction date and the date its report became publicly available, counted
in bands. It reports what the filings and the source dataset record. It is **not** a finding about whether any filing
was on time or lawful: the statutory clock starts at the filer's notification of the transaction (not in the data) and
ends no later than 45 days after the transaction, and committee extensions or waivers are not in the data either. The
field-level audit is [`docs/validation/disclosure-timing-audit.md`](validation/disclosure-timing-audit.md).

```ts
type DelayGroup = {
  count: number;              // trades in the group
  dated: number;              // count - undated (includes negative lags)
  bands: { "0-30": number; "31-45": number; "46-90": number; "91-365": number; "over-365": number };
                              // trades by lag_days; the band keys are fixed text; 31-45 ends at config.LATE_DAYS
  negative: number;           // lag_days < 0 (availability recorded before the transaction); in no band, no statistic
  undated: number;            // lag_days is null (transaction or availability date missing); never counted as 0 days
  amended: number;            // trades that are the current version of an event with more than one version;
                              // also counted in the bands/negative/undated bucket they belong to, so NOT additive
  median: number | null;      // nearest-rank percentiles of lag_days over dated, non-negative trades (integers)
  p90: number | null;
  max: number | null;         // all null when that set is empty
};
// bands + negative + undated == count in every group.

type Delays = {
  definition: {
    measured: string;         // "days from the transaction date as filed to the date the report became publicly available"
    threshold_days: number;   // config.LATE_DAYS (45): the outer bound the 31-45 / 46-90 bands split on
    bands: string[];          // the band keys in order
    percentile: string;       // the method, in words
    caveats: string[];        // fixed strings: observed elapsed days, not compliance; notification dates and extensions
                              // not in the data; amended and negative-lag handling
  };
  totals: DelayGroup;         // every published trade
  by_chamber: { rep: DelayGroup; sen: DelayGroup };
                              // by the chamber of the filing as recorded by the dataset (Trade rows in trades/<id>.json
                              // carry no chamber, so this split cannot be re-derived from them, and it is not
                              // necessarily the member's chamber when a member served in both)
  by_year: { [year: string]: DelayGroup };   // calendar year of the transaction date; "none" when it is missing
                              // (as trade_summary.by_year); a trade with a date but no availability date is in its
                              // year and counted undated; keys ascending, "none" last
  members: Table<"id" | "count" | "dated" | "b0_30" | "b31_45" | "b46_90" | "b91_365" | "b366_plus" | "negative"
                 | "undated" | "amended" | "median" | "p90" | "max" | "first_year" | "last_year">;
                              // one row per member with at least one published trade, sorted by id; b* are the five
                              // bands in order; first_year / last_year = earliest / latest transaction year, null
                              // when no trade has a transaction date; names come from members.json
};
```

Rules:

- Built from the same current-version trade rows published in `trades/<id>.json`, so a member's row can be re-derived
  from that file (`lag_days`, `date`, `amended` columns). `lag_days = available - date` in days; see Trade.
- Percentile method (nearest rank): sort the n dated, non-negative lags ascending; the p-th percentile is the value at
  1-based position `ceil(p * n / 100)`. Median is p = 50 (the lower middle value for even n). No interpolation.
- Output is deterministic: members sorted by id, `by_year` keys ascending, sorted JSON keys.
- Data strings carry no ranking labels and no wording about violations. The `late` boolean in Trade is unchanged and
  means only `lag_days > 45`.
- Validation (`pipeline/validate_delays.py`): schema; bands + negative + undated == count in every group; each member
  row equals the row re-derived from its trade file and its count equals both the file's row count and
  `MemberFile.trade_summary.count`; trades over 45 days equal `trade_summary.late`; totals equal the sum of member
  rows and the figures re-derived from all trade files; chambers sum to totals; by_year groups equal the re-derived
  figures and sum to totals; every member id exists in `members.json`.

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

## Privacy

Public data stays public: everything here comes from public filings (FEC reports, House and Senate disclosure
reports, congress-legislators), and adults named in them are published as filed. Only minors are redacted, because
they did not choose public life.

- **Published as filed:** members and their spouses; adults named in account titles (an IRA "FBO" an adult, trusts
  named after adults, the member's or spouse's own name); FEC committees, and independent-expenditure payees
  (the vendors and consultants a committee paid, individuals and organisations alike, in the "(paid to ...)"
  evidence labels and `meta.json.reports.fec.review_large_funds_rows`); liability creditors and types (no change
  to the creditor name, whether a bank or a person).
- **Redacted (minors only):** a beneficiary's name becomes `[name redacted]` only when the filing row itself
  indicates a minor: (1) a custodial account form (`UTMA`, `UGMA`, `UTA` but not `UTA DTD`, "custodian (for)",
  "cust", "minor" / "a minor"); (2) a 529 or education-savings account (`529`, Coverdell, `ESA`, "education
  savings") naming a beneficiary; (3) any row whose owner is filed as a dependent child (owner `dependent`), where
  person-shaped names in the account title are redacted as well. On rows (1) and (2) the name after `FBO`, `f/b/o`,
  "for the benefit of", "custodian for" or "beneficiary", and a "First [M.] Last" name directly before
  `UTMA`/`UGMA`/`UTA`, are redacted. When the filing gives no way to tell and the owner is not a dependent child, the
  text is published as filed. Counts per rule: `meta.json.reports.holdings` (`asset_minor_name_redacted_<rule>`).
- **Never published:** street addresses (locations are cut to "City, ST"; street addresses in asset, creditor and
  liability-type text become `[street address redacted]`) and personal residences (rows that name a personal
  residence or non-rental second home are dropped). The pipeline never reads the FEC individual-contributions file,
  so no individual contributor is published. The campaign finance block (see its section) publishes leadership PAC spending
  as per-category aggregates only, never a payee name or address.

Both validators check that no published asset or trade text still carries a minor's name under these indicators.

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
wins for ticker, cik and sector, files in name order; a `company` row sets kind and name over an `other` row, and among
rows of equal standing the later file's name wins, so `trades.jsonl`'s SEC name beats `fec.jsonl`'s), assigns edge ids, aggregates duplicates of the same
type/from/to/via, and writes the files above. Edges with an unknown endpoint, an unlisted evidence source, no evidence
or an invalid type/family are dropped and counted in `meta.json.unmatched.edges_dropped_at_assembly`.

## Campaign finance block (`MemberFile.campaign_finance`, FEC spending and loans)

Sources, both FEC bulk files read by `pipeline/fec/` (retrieved with the other FEC files; public domain, not for
solicitation or commercial use, 52 U.S.C. 30111(a)(4)). Column layouts:
<https://www.fec.gov/campaign-finance-data/all-candidates-file-description/> (`weball<yy>.zip`) and
<https://www.fec.gov/campaign-finance-data/operating-expenditures-file-description/> (`oppexp<yy>.zip`, header file
<https://www.fec.gov/files/bulk-downloads/data_dictionaries/oppexp_header_file.csv>). Category codes:
<https://www.fec.gov/campaign-finance-data/disbursement-category-code-descriptions/>. Written by
`pipeline/fec/spending.py` to `pipeline/build/campaign_finance.json` (members, plus committee links used only by the
validator) and `pipeline/build/sources/fec_spending.json` (source `fec_spending`, report in `meta.reports.fec_spending`).

```ts
type CampaignFinance = {
  loans: LoanRow[];                 // one row per (cycle, candidate id), oldest cycle first; [] if none
  leadership_pac: LeadershipPacYear[]; // one row per (cycle, committee), oldest cycle first; [] if none
  coverage: {
    loans_cycles: number[];         // cycles whose weball file was loaded (the same for every member)
    leadership_pac_cycles: number[];// cycles whose oppexp file was loaded (2004 on; 2000 and 2002 do not exist)
    leadership_pac_note: string | null; // set exactly when leadership_pac is []
  };
};

type LoanRow = {                    // the FEC's all-candidates summary row for one candidate id and cycle
  cycle: number;                    // two-year election cycle, even year
  candidate_id: string;             // one of MemberFile.member.fec_ids: H/S + digit + 2 letters + 5 digits (H8VA01233), or P + 8 digits for a president (P60003225)
  office: "house" | "senate" | "president" | null; // from the id's first letter H, S or P
  candidate_loans: number | null;   // CAND_LOANS: loans the candidate reported making to their own campaign
  other_loans: number | null;       // OTHER_LOANS
  candidate_loan_repayments: number | null; // CAND_LOAN_REPAY
  other_loan_repayments: number | null;     // OTHER_LOAN_REPAY
  debts_owed_by: number | null;     // DEBTS_OWED_BY, as in the FEC summary
  through: string | null;           // CVG_END_DT: the summary covers the cycle up to this date (YYYY-MM-DD)
};                                  // dollars, exact (not ranges); null = blank in the file or a negative figure (see below)

type LeadershipPacYear = {
  committee_id: string;             // the leadership PAC, C + 8 digits
  committee_name: string;           // latest name in the FEC committee master
  cycle: number;
  sponsor_link: "fec_candidate_id" | "leadership_file_exact_name" | "fec_candidate_id+leadership_file_exact_name";
  total: number;                    // dollars spent: sum of the committee's positive operating-expenditure rows in that cycle's file
  count: number;                    // number of those positive rows
  refunds: number;                  // sum of the absolute values of the negative rows (refunds and voids), not subtracted from total
  refund_count: number;             // number of negative rows
  categories: { category: string | null; label: string; total: number; count: number; refunds: number; refund_count: number }[];
                                    // by code, then the rows with no usable code (category null) last; the four
                                    // figures of the categories sum to the four figures above; all four are >= 0
};
```

Rules
- **Loans: exact id only.** A weball row belongs to a member only because its `CAND_ID` is one of the member's FEC
  candidate ids (the same linkage the money edges use). The row is the FEC's summary of everything the candidate's
  authorised committees reported for the cycle; the five money fields are copied as summarised, to the cent.
  A blank field is `null`, never zero. A negative figure (80 figures in 44,913 rows, cycles 2000-2026) is not published (`null`) and is listed in `meta.reports.fec_spending.loans.negative_figures_not_published`.
  A zero is published as zero only when the FEC file says 0.
- **Leadership PACs: the existing sponsor linkage.** A committee is a member's leadership PAC only through the rules in
  `pipeline/fec/README.md` ("Leadership-PAC sponsors"): a filed candidate id on the committee (`fec_candidate_id`) or
  the FEC leadership-PAC list's sponsor name equal to the FEC candidate-master name of that member's candidate ids,
  punctuation aside (`leadership_file_exact_name`). No similarity matching; unmatched sponsors are listed in the
  `fec` report. `sponsor_link` says which.
- **Spending: aggregates only.** The operating-expenditures file is streamed and summed by the FEC's `CATEGORY` code
  (001-012 for House, Senate and party/PAC filers; 101-107 for presidential filers; labels are the FEC's wording).
  Memo items (`MEMO_CD` = X, itemisations of an amount already counted) are dropped, a transaction re-reported in a later
  filing (same committee, transaction id, date and amount) counts once, rows of exactly zero are skipped, and the file's own cycle decides the `cycle`.
  A blank or unrecognised code goes to `category: null`. Most Form 3X rows (PACs) carry no category, so most
  of a leadership PAC's rows fall under `null` (2024 cycle: about 86% of rows and 78% of dollars). The FEC has no other category
  field in the bulk file and free-text purposes are not read.
- **Refunds are not netted.** A negative row is a refund or void reported by the committee (money returned to it, or a
  correction of an earlier row). It is never subtracted from what was spent: `total` and `count` cover the positive rows
  only, `refunds` and `refund_count` the negative ones, per category and per committee-cycle. A category can show more
  refunded than spent, for example when the original row is in an earlier cycle's file. The two are not paired.
- **Coverage.** `loans_cycles` and `leadership_pac_cycles` list the files actually loaded. A member with no candidacy row
  in a loaded weball file and no leadership PAC row gets `campaign_finance: null` (not a block of zeros), as does
  a member with no FEC id. A member with a block but no leadership PAC gets `leadership_pac: []` and the note.
  A committee-cycle with no rows in the file has no entry: absence is not a reported zero.

What it does not show
- A loan figure is a cycle total as the FEC summarises it. It does not show when the loan was made, its terms, whether
  or when it was repaid beyond the two reported repayment fields, or why. `debts_owed_by` is the FEC's field of that name.
- Category labels are the FEC's, and the FEC assigns the code from the committee's own filing. The categories do not say
  what a payment was for beyond that label, and they do not show who was paid.
- Totals are what a committee reported in operating expenditures. They exclude contributions to candidates and
  committees, transfers and other lines that are not operating expenditures, so they are not the committee's total
  disbursements.
- Nothing here says a spending or loan figure is improper. The site reports what the filings say.

Privacy
- No payee name, payee address, ZIP, city, free-text purpose or memo, entity type or individual-level row is read into the
  aggregation or published (`spending_oppexp.iter_rows` never extracts those columns). Validators reject any key naming a
  payee, lender, address, city or ZIP and any text that looks like a street address (`pipeline/validate_fec_spending.py`).
- A category holding a single row shows that row's amount but not who was paid.

Not built: payments to family members or member-owned firms. The bulk files carry the payee only as free text (name,
address) or, for a committee payee, a committee id; nothing in them is an exact identifier tying a payee to a member's
relatives or businesses, and linking by name similarity is forbidden. This needs a reviewed list from a filing that names
both ends and is out of scope.

Download and cost: `weball` is loaded for every cycle already; `oppexp<yy>.zip` (50-65 MB each, 2004-2026, 12 files) is
cached like the other FEC files (the two latest cycles refetched daily, older ones weekly) and streamed, about 3 seconds and 60 MB peak memory per cycle (measured on 2024: 2.2 million lines, 430 MB unpacked).

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
// Liability row: creditor and type as filed (only street addresses redacted), incurred = date incurred as filed (free text),
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
- **Names in asset text.** See "Privacy" below: only minors' names are redacted. An `other` org's name is the last
  segment of the asset text (the issuer, not the account path).
- **Portfolio.** Latest report year; rows grouped by `org` when resolved, else by the asset text (`asset:<text>`);
  `share_low` = group low / total low, `share_high` = group high / total high (null when either is null); `sector`
  is the SIC major-group label from `companies.json` when SEC lists a SIC code.
- **Overlaps.** For each report year, an org held that year that also has a `traded` edge with a trade in that
  calendar year, or a full `pac_money` edge with money in that calendar year, in the member's published file of the
  same build (the stage runs again after `assemble`, as `holdings_publish`, so it never reads the previous build's).
  Ledger-only money rows have no years and are not checked (counted in the report).
- **`owns` plug-in edges** (`pipeline/build/edges/holdings_owns.jsonl`): one per member and org (resolved assets only),
  family `holding`, basis `filed`, directed member → org. A holding is a stock, not a flow, so `amount`, `count` and the
  single `by_year` entry describe the latest report year that lists the org (they sum, as required); `first`/`last`
  are the filing dates of the earliest and latest reports listing it, and `note` names every year. Evidence: one entry
  per report (latest first, up to 5), `record` = dataset row ids; `weak` when the latest range is not closed.
- **Joins.** Holdings → filings and liabilities → filings are asserted 1:1; every document maps to one bioguide id;
  published rows + residence exclusions equal the rows of the used documents.
- **Validation.** `python -m pipeline.holdings.validate` re-derives every total and net-worth range, checks owners,
  document URLs, redaction (street addresses and minors' names) and edges, and writes
  `pipeline/build/holdings-sample.csv` (25 rows, seed 20261113, with a machine check that the asset words and the band
  figures occur in the PDF text, and empty columns for a human). It creates `docs/validation/holdings-sample.csv` from
  it only when that reviewed file does not exist, and never overwrites it.

### Position timelines

`holdings/positions/<id>.json` contains `member` (bioguide id), `source`, `coverage`
(as in HoldingsFile), `years` (used report years), `docs` (annual report id to URL),
`filings` (trade report id to URL or null), and four columnar tables:

- `assets`: `key, name, org, ticker, kind, first, last, years, trades, latest_low, latest_high, status`.
  Kind is stock, fund, bond, option or unlabelled, from registry or filed categories.
  Status codes are `[throughout, first, last]`, `[from, year]`, `[again, year]`, `[until, year]`.
- `snapshots`: `a, year, low, high, lines, unvalued, open_ended, owners, rows, doc`.
- `trades`: `a, id, date, action, low, high, owner, doc`.
- `transitions`: `a, from, to, gap, change, buys, sells, exchanges, sold_last_listed_year, class, owner_change`.

`a` indexes the asset table. Keys use resolved org ids, with a separate `|option`
key for options. Otherwise exact normalised issuer names join rows; a unique exact
name can bridge an unresolved ticker to a resolved company. Real property includes
filed city/state. A resolved trade identity never falls back to a different issuer with the same name. No similarity matching. Snapshot bands sum the filed lines;
unvalued or open-ended lines leave the upper bound unknown. `latest_*` describes the
last report listing the asset, which need not be the member's latest report.

Transitions join consecutive *available* annual reports. `gap` counts intervening
years without a report; these years are never interpreted as sales. Trades fall
after the first report year and through the second report year. A disappearance
also counts a sale/exchange in the last listed year, since income-producing assets
sold during a year can still appear on that annual report.

Classes: `consistent` means a purchase/exchange accompanies an appearance or band
rise, or a sale/exchange accompanies a disappearance or band fall;
`unexplained_appearance` and `unexplained_disappearance` mean no corresponding
trade was found; `band_change_no_trade` means the band changed without a trade;
`contrary` means only the opposite trade direction was found; `traded_same_band`,
`unchanged`, `not_comparable` and `traded_while_unlisted` complete the partition.
These are facts about records, never findings of wrongdoing. Gifts, inheritance,
thresholds, price changes and excepted funds can explain transitions without trades.
`summary` contains asset counts, share with trades, counts per transition class,
and trade accounting (matched, unlisted assets, undated, before/after report span).
`HoldingsFile.positions_summary` repeats it.

### Change since first report

`HoldingsFile.tenure_change` is null with fewer than two used reports, otherwise:
`first_year, latest_year, years_between, reports_between, first, latest, change,
known, comparable, doc_first, doc_latest`. `first` and `latest` contain
`low, high, high_valued, label`. `change` is `{low: latest.low - first.high,
high: latest.high - first.low}` only when both figures are full ranges; otherwise
both bounds are null and `known` is false. `comparable` means the labels match.
This is change between disclosures, not a growth rate or change in true wealth.

### Liabilities and leverage

`HoldingsFile.leverage` contains columnar `by_year` (`year, n, low, high,
residence_low, residence_high, share_low, share_high, by_type`), `buckets` (labels),
`bucket_rows` (counts across all years), `recurring_creditors` (`creditor, years`),
and `margin_loans` (`year, creditor, type, owner, low, high, doc`). All-liability
bands include residence-secured debt; shares exclude it, matching net worth rules.
Share bounds are non-residence liability low / asset high and liability high /
asset low, null when an input is unknown or the denominator is zero.
Buckets use filed type text in order: residence flag, margin/securities-backed,
student, investment property, mortgage with property unstated, credit, vehicle,
business, personal, other. Creditor text is a fallback for margin only. Recurring
creditors use exact normalised names across multiple report years.

The holdings index appends `nw_first_year, nw_change_low, nw_change_high,
nw_comparable, pos_assets, pos_consistent, pos_unexplained_appearance,
pos_unexplained_disappearance, pos_band_change_no_trade, pos_share_with_trades,
margin_loan_years`. Missing first/latest comparison values are null.
The holdings validator runs the positions checks alongside the main validator: snapshot sums and citations, trade
identity, transition rules and summaries, first/latest change and leverage.

## Congress.gov bill sponsorship pilot (`pipeline/congress/`, unreviewed, unpublished)

A switched-off pilot, not a published source. It runs only with `PT_ENABLE_CONGRESS=1`, covers five hand-listed
current members (`pipeline/congress/download.py`, `PILOT_MEMBERS`), and writes no plug-in file: nothing under
`pipeline/build/edges`, `orgs` or `sources`, so the assembler never reads it and no field below appears in
`web/public/data`. It exists to test access, identity and review on a small set before any bulk ingestion (plan gate
"New sources"). The contract below is provisional and changes freely until a human has reviewed the sample.

Source: Congress.gov API v3 (`https://api.congress.gov/v3/`), member `sponsored-legislation` and
`cosponsored-legislation` lists, current (119th) Congress only. Cited with its access date; the cache holds the raw
response text (`pipeline/.cache/congress/`, gitignored).

**Fact table** `pipeline/build/congress/member_bills.jsonl` (one row per member, role and bill; key-sorted JSON):
`member` (bioguide id), `role` (`sponsor` | `cosponsor`), `bill_id` (`<congress>-<type>-<number>`, from the item's own
fields), `congress`, `bill_type` (lower-case code: hr, s, hres, sres, hjres, sjres, hconres, sconres), `number`,
`introduced`, `policy_area`, `title`, `latest_action_date`, `congress_url` (Congress.gov bill page built from type and
number), `api_url`. Missing values are null.

Rules:
- **Identity is exact.** A row belongs to a member only because the request that returned it was made for that
  bioguide id and the returned member record carries the same id. The member must be current and, when
  `pipeline/build/spine.json` exists, present in it; otherwise the run stops. No name is read or compared.
- Items from another Congress and amendments (`amendmentNumber`, a Senate item kind that is not a bill) are dropped
  and counted in `report.json` (`dropped`). The API lists every Congress ordered by last update, with no Congress
  filter, so every page is read and the 119th is selected by the item's `congress` field.
- A list longer than `MAX_PAGES` would be recorded as truncated (`state.json`), never cut silently.
- Co-sponsorship is not turned into `legislates_with`. That edge type is declared in the contract and the site's
  wording, but no stage builds it today, and a rule for it (which bills, how many shared, a baseline) is an owner
  decision. `report.json` carries `shared_bills_by_pair` (bills on which two pilot members both appear) as a plain
  count of facts; it is not a tie and has no evidence link.

**Review sample.** `--sample` writes `pipeline/build/congress/congress-sample.csv` (up to 3 rows per member and role,
fixed seed) and, only when none exists, the template `docs/validation/congress-sample.csv`. Columns: `member, role,
bill_id, introduced, policy_area, title, congress_url, api_url` then the reviewer columns `checked_by,
matches_source, comment`, which are empty until a person opens `congress_url` and confirms the member is listed as
sponsor or cosponsor. No review has happened. A reviewed copy is never overwritten.
