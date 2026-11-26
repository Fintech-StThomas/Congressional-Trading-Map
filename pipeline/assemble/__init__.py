"""The assembler: merges every source's plug-in files into web/public/data/ (see run.py for the steps).

Modules, one job each: plugins (load and merge plug-in files), cases (the Case rule), budget (full edge vs ledger
row), orgs (shards, party split, org index), wall (wall.json, wall-years.json), members (member and trade file
pieces, coverage), finance (the campaign_finance block), flags, flags_chance and flags_out (review flags), publish (staging and swap), run (the orchestrator).
Constants live in pipeline/config.py, contract shapes in pipeline/contract.py.
"""
from __future__ import annotations

from ..config import (BOARD_EDGES, CASE_MIN_TYPES, CASE_RULE, FORMER_MEMBER_LEDGER_ROWS, LEDGER_ONLY_TYPES,
                      MONEY_EDGES_PER_MEMBER, MONEY_MEMBERS_PER_ORG, ORG_INDEX_TOP, WALL_YEAR_MIN)
from ..contract import (MEMBER_LEDGER_COLS, ORG_INDEX_COLS, ORG_TIE_COLS, PARTIES, SPLIT_MEASURES, TRADE_COLUMNS,
                        WALL_COLS, WALL_YEARS_COLS)
from .budget import edge_size, ledger_totals, member_ledger, org_ties, rank, split_member_edges
from .cases import case_ok, find_cases
from .finance import load_campaign_finance
from .members import coverage, in_office, trade_coverage
from .orgs import SplitStats, org_index, party_split, shard, year_party
from .plugins import load_edges, load_orgs, merge_edges
from .run import run
from .wall import merged_terms, served_years, wall_rows, wall_years

__all__ = [n for n in dir() if not n.startswith("_")]
