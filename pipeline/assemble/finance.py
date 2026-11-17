"""The `campaign_finance` block of a member file (data dictionary: "Campaign finance block"). Reads
pipeline/build/campaign_finance.json (written by pipeline/fec/spending.py); writes nothing.

A member without an entry gets null (no FEC candidacy row and no leadership PAC row), never an empty block with zeros.
When the file does not exist (the FEC module has not run) every member gets null. Entries for ids that are not in the
spine are ignored. The committee links in the file are for the validator and are not published.
"""
from __future__ import annotations

from typing import Any

from ..util import BUILD, read_json

CAMPAIGN_FINANCE_FILE = BUILD / "campaign_finance.json"


def load_campaign_finance(spine_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not CAMPAIGN_FINANCE_FILE.exists():
        return {}
    members = read_json(CAMPAIGN_FINANCE_FILE).get("members", {})
    return {mid: block for mid, block in members.items() if mid in spine_ids}
