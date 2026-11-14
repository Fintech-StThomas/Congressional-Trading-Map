// Data contract types, copied verbatim from docs/data-dictionary.md (the binding contract).
// Do not edit this block by hand: change the data dictionary first, then re-copy.
// BEGIN CONTRACT
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
  split?: PartySplit;         // see "Party split"; optional on the site because older builds and fixtures lack it
};

// measure -> party -> [distinct members, dollars]. Only measures with at least one tie are present; when one is
// present all three parties are. Dollars are null for "traded".
type PartySplit = { [measure in "given" | "support" | "oppose" | "traded"]?: { D: [number, number | null]; I: [number, number | null]; R: [number, number | null] } };

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
  chambers?: { rep: number; sen: number }; // distinct members tied to it (all ties) by MemberSummary.chamber
  years?: [number, number];   // earliest first year and latest last year over all its ties
};

type Wall = {                 // wall.json, rows sorted by id, one per member in members.json
  cols: ["id", "name", "last", "party", "state", "chamber", "district", "current", "photo", "cases", "trades",
         "pac", "support", "oppose", "orgs"];
  rows: unknown[][];
};

type WallYears = {            // wall-years.json, rows sorted by id, one per row of wall.json
  years: [number, number];    // [2000, current year]
  cols: ["id", "terms", "cases", "trades", "pac", "oppose"];
  rows: unknown[][];          // terms: [start year, end year, chamber, party, state][]; measures: sparse flat
                              // [year, value, ...] arrays (see docs/data-dictionary.md)
  first: { trades: { rep: number; sen: number }; cases: number; money: number };
};

type OrgIndex = {             // org-index.json
  cols: ["id", "name", "kind", "ticker", "members_D", "members_I", "members_R", "dollars_D", "dollars_I", "dollars_R", "degree"];
  rows: unknown[][];
  by_members: number[];       // row indexes, top 300 by current members reached
  by_dollars: number[];       // row indexes, top 300 by pac_money dollars to current members
};

type Board = {
  states: { [state: string]: string[] };        // current member ids, senators first
};
// END CONTRACT

export type {
  NodeRef, MemberSummary, Term, Committee, OrgSummary, EdgeType, Amount, Edge, Evidence, Trade,
  Table, LedgerRow, LedgerTotals, OrgTie, Case, MemberFile, TradeFile, OrgFile, Board,
  PartySplit, Wall, WallYears, OrgIndex,
};

// ---------------------------------------------------------------------------
// Tolerant aliases used by the decoders: they also accept the earlier draft
// shapes (trades as an array of objects, org files with full edges).
// ---------------------------------------------------------------------------

export type Columnar = Table<string>;
export type TradeWire = Trade & { url?: string | null };
export type MemberFileWire = MemberFile & {
  /** Earlier drafts carried trades inline; current files keep them in trades/<id>.json. */
  trades?: Columnar | TradeWire[];
  filings?: { [doc: string]: string };
};
export type OrgFileWire = Omit<OrgFile, "ties" | "ledger_totals"> & { ties?: Columnar; edges?: Edge[]; ledger_totals?: LedgerTotals };

// ---------------------------------------------------------------------------
// Not in the contract. meta.json has no published type in the data dictionary,
// so the site reads it defensively through this loose shape and shows any
// other keys it finds as plain facts on /method.
// ---------------------------------------------------------------------------

export type MetaSource = {
  id: string;
  name?: string;
  url?: string | null;
  revision?: string | null;
  retrieved?: string | null;
  rows?: number | null;
  unmatched?: number | null;
  license?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type Meta = {
  built?: string;
  build_time?: string;
  sources?: MetaSource[] | { [id: string]: Omit<MetaSource, "id"> };
  counts?: { [key: string]: number };
  unmatched?: { [key: string]: number };
  exclusions?: unknown;
  coverage?: unknown;
  rules?: { [key: string]: string };
  [key: string]: unknown;
};
