// Data contract types, copied verbatim from docs/data-dictionary.md (the binding contract).
// Do not edit this block by hand: change the data dictionary first, then re-copy.
// BEGIN CONTRACT
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
// END CONTRACT

export type {
  NodeRef,
  MemberSummary,
  Term,
  Committee,
  OrgSummary,
  EdgeType,
  Edge,
  Evidence,
  Trade,
  Case,
  MemberFile,
  OrgFile,
  Board,
};

// ---------------------------------------------------------------------------
// Wire shapes announced by the pipeline (2026-11-13) ahead of the data
// dictionary update: columnar trades, a filings map, and a compact ledger for
// money ties that are not shipped as full Edge objects. The decoders in
// decode.ts accept both these and the original shapes above.
// ---------------------------------------------------------------------------

export type Columnar = { cols: string[]; rows: unknown[][] };

export type TradeWire = Omit<Trade, "url"> & {
  url?: string | null;
  doc?: string | null;
  ticker_source?: string | null;
};

export type LedgerTotals = {
  [type: string]: { edges: number; records: number; low: number | null; high: number | null; exact: number | null };
};

export type MemberFileWire = Omit<MemberFile, "trades"> & {
  trades: Trade[] | TradeWire[] | Columnar;
  filings?: { [doc: string]: string };
  ledger?: Columnar;
  ledger_totals?: LedgerTotals;
};

export type OrgFileWire = OrgFile & { ledger?: Columnar; ledger_totals?: LedgerTotals };

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
