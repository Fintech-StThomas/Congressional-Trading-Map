"""Every tunable constant of the pipeline, in one place.

Reads nothing and writes nothing. Stages import their thresholds from here; the assembler echoes the publication
budget and the case rule into `meta.json.publication_budget` (data dictionary: "Publication budget"), and the
`traded_together` thresholds appear in each such edge's `stat.method`. Changing a value here changes the published
data, so say why in the commit message and rerun validation.
"""
from __future__ import annotations

# ---------------------------------------------------------------- members (data dictionary: "Scope")
MEMBER_CUTOFF = "2000-01-01"   # a person is in scope when any term ends on or after this date

# ---------------------------------------------------------------- downloads
DAY = 86400.0                  # seconds; cache age after which a non-content-addressed download is refetched
FEC_RECENT_CYCLES_MAX_AGE = DAY        # current and previous FEC cycle files change daily
FEC_OLDER_CYCLES_MAX_AGE = 7 * DAY     # older cycles still receive amendments, but rarely
SEC_REQUESTS_PER_SECOND = 10   # SEC fair-access limit
FSDS_QUARTERS = 2              # SEC Financial Statement Data Sets quarters read for SIC codes

# ---------------------------------------------------------------- trades (data dictionary: "Trade")
LATE_DAYS = 45                 # `late` = public availability more than this many days after the transaction
STOCK_ACT_YEAR = 2012          # periodic transaction reports begin; coverage is n/a before this year

# ---------------------------------------------------------------- edges (data dictionary: "Edge")
MAX_EVIDENCE = 5               # evidence items kept per edge (largest first, then most recent)

# ---------------------------------------------------------------- traded_together (data dictionary: "traded_together rule")
TOGETHER_WINDOW_DAYS = 7       # two members' same-direction trades of one org at most this many days apart
TOGETHER_MIN_TICKERS = 3       # distinct orgs; fewer draws the edge weak
TOGETHER_MIN_OCCASIONS = 5     # alternative to MIN_TICKERS in the keep rule (see the note in edges_trades.py)
TOGETHER_MIN_OBSERVED = 5      # co-occurrences needed before a pair is tested at all
TOGETHER_MIN_LIFT = 3.0        # observed / expected under the permutation baseline
TOGETHER_SHUFFLES = 200        # permutations of each member's trade dates within the calendar year
TOGETHER_SEED = 20260101       # fixed seed: the baseline is reproducible
TOGETHER_WEAK_P = 0.05         # passing pairs with a permutation p-value above this are drawn weak
TOGETHER_EXCLUDED_CLASSES = ("fund", "bond", "unknown")

# ---------------------------------------------------------------- cases (data dictionary: "Case")
CASE_FAMILIES = ("money", "holding", "people")
CASE_MIN_TYPES = 2             # distinct filed types; at least one holding and one money or people type, overlapping in time
CASE_RULE = ("A Case is a member-org pair with at least 2 distinct filed edge types, at least one of family holding "
             "and at least one of family money or people, whose year ranges overlap. Ranked by number of types, "
             "then money amount, then trade count.")

# ---------------------------------------------------------------- publication budget (data dictionary: "Publication budget")
BOARD_EDGES = 12                     # edge ids listed in MemberFile.board
MONEY_EDGES_PER_MEMBER = 10          # largest money edges per member kept as full Edges (plus every Case edge)
FORMER_MEMBER_LEDGER_ROWS = 100      # ledger rows kept for former members; current members keep all
LEDGER_ONLY_TYPES = ("sits_with",)   # published only as member-ledger rows, never as full edges
MONEY_MEMBERS_PER_ORG = 200          # members listed per org for money ties; the rest is in ledger_totals
ORG_INDEX_TOP = 300                  # organisations per ranking in org-index.json
WALL_YEAR_MIN = 2000                 # first year of wall-years.json

# ---------------------------------------------------------------- validation
SAMPLE_SIZE, SAMPLE_SEED = 25, 13107  # hand-check sample of trades (pipeline/build/validation_sample.csv)
