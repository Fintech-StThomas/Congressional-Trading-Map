"""Reference data for the FEC module (step 3: resolve identities): members (bioguide <-> FEC candidate ids), the
company-name index and the hand-reviewed org override file.

Each loader prefers the shared build file written by the pipeline-core module and
falls back to reading the same upstream data directly, so this module can run
before (or without) the rest of the pipeline. The fallback reproduces the shared
rules exactly: members are everyone with a term ending on or after 2000-01-01;
company names are normalised with the contract's rule and kept only where unique.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..util import clean_sec_name, normalise_name, read_overrides
from . import download

REPO = download.REPO_ROOT
BUILD = REPO / "pipeline" / "build"
SPINE = BUILD / "spine.json"
COMPANY_NAMES = BUILD / "company_names.json"

LEGISLATORS = "https://unitedstates.github.io/congress-legislators"
SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json"
CUTOFF = "2000-01-01"

# One implementation of each rule, shared with the core modules (data dictionary: "Identifiers").
_clean = clean_sec_name


# --- members ---------------------------------------------------------------------
@dataclass
class Members:
    source: str                                   # "spine.json" or "fallback:congress-legislators"
    info: dict[str, dict]                          # bioguide -> {name, current, chamber, state, party, fec_ids}
    cand_to_bio: dict[str, str] = field(default_factory=dict)
    conflicts: dict[str, list[str]] = field(default_factory=dict)  # cand id claimed by >1 bioguide (dropped)

    def build_index(self) -> None:
        claims: dict[str, set[str]] = {}
        for bio, m in self.info.items():
            for cid in m.get("fec_ids") or []:
                claims.setdefault(cid.strip().upper(), set()).add(bio)
        self.cand_to_bio = {c: next(iter(b)) for c, b in claims.items() if len(b) == 1}
        self.conflicts = {c: sorted(b) for c, b in claims.items() if len(b) > 1}


def _member_from_legislator(p: dict, current: bool) -> dict:
    terms = sorted(p["terms"], key=lambda t: t["start"])
    last = terms[-1]
    name = p["name"]
    display = name.get("official_full") or " ".join(x for x in (name.get("first"), name.get("last")) if x)
    party = {"Democrat": "D", "Republican": "R"}.get(last.get("party") or "", "I")
    return {"name": display, "current": current, "chamber": "sen" if last["type"] == "sen" else "rep",
            "state": last["state"], "party": party, "fec_ids": sorted(set(p["id"].get("fec", [])))}


def load_members(prefer_shared: bool = True) -> Members:
    if prefer_shared and SPINE.exists():
        spine = json.loads(SPINE.read_text(encoding="utf-8"))
        info = {bio: {k: m.get(k) for k in ("name", "current", "chamber", "state", "party", "fec_ids")}
                for bio, m in spine.items()}
        mem = Members("pipeline/build/spine.json", info)
    else:
        info: dict[str, dict] = {}
        for fname, current in (("legislators-historical.json", False), ("legislators-current.json", True)):
            path = download.generic(f"{LEGISLATORS}/{fname}", fname)
            for p in json.loads(path.read_text(encoding="utf-8")):
                if not any(t["end"] >= CUTOFF for t in p["terms"]):
                    continue
                info[p["id"]["bioguide"]] = _member_from_legislator(p, current)
        mem = Members("fallback:congress-legislators", info)
    mem.build_index()
    return mem


# --- companies ---------------------------------------------------------------------
@dataclass
class Companies:
    source: str
    index: dict[str, str]          # normalised name -> "co:<cik>"
    names: dict[str, str]          # org id -> display name (fallback only; may be empty)


def sec_company_info() -> dict[str, dict]:
    """org id -> {name, ticker, cik} from SEC company_tickers.json (first listed ticker per CIK)."""
    path = download.generic(SEC_TICKERS, "company_tickers.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for key in sorted(data, key=lambda k: int(k)):   # file order = SEC's ranking; keep the first ticker
        row = data[key]
        oid = f"co:{int(row['cik_str'])}"
        out.setdefault(oid, {"name": _clean(row["title"]), "ticker": row.get("ticker"), "cik": int(row["cik_str"])})
    return out


def load_companies(prefer_shared: bool = True) -> Companies:
    if prefer_shared and COMPANY_NAMES.exists():
        raw = json.loads(COMPANY_NAMES.read_text(encoding="utf-8"))
        # Accept {name: id} or {name: {"id": ...}}.
        index = {k: (v if isinstance(v, str) else v.get("id")) for k, v in raw.items()}
        return Companies("pipeline/build/company_names.json", {k: v for k, v in index.items() if v}, {})
    path = download.generic(SEC_TICKERS, "company_tickers.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    by_norm: dict[str, set[str]] = {}
    names: dict[str, str] = {}
    for row in data.values():
        oid = f"co:{int(row['cik_str'])}"
        n = normalise_name(_clean(row["title"]))
        if n:
            by_norm.setdefault(n, set()).add(oid)
        names.setdefault(oid, _clean(row["title"]))
    index = {n: next(iter(ids)) for n, ids in by_norm.items() if len(ids) == 1}
    return Companies("fallback:sec-company_tickers.json", index, names)


# --- overrides -----------------------------------------------------------------------
@dataclass
class Overrides:
    by_committee: dict[str, str]   # FEC committee id -> org id
    by_name: dict[str, str]        # normalised connected-org name -> org id
    rows: int
    ignored: int


def load_overrides() -> Overrides:
    """Rows with source fec (or fec_committee / fec_connected_org). source_id_or_name is an
    FEC committee id (C + 8 digits) or a connected-organisation name (normalised before lookup).
    Only reviewed rows (reviewed_by non-empty) are honoured."""
    by_c: dict[str, str] = {}
    by_n: dict[str, str] = {}
    used, rows = read_overrides({"fec", "fec_committee", "fec_connected_org"})
    for r in used:
        key, org = r["source_id_or_name"], r["org_id"]
        if re.fullmatch(r"C\d{8}", key.upper()):
            by_c[key.upper()] = org
        else:
            by_n[normalise_name(key)] = org
    return Overrides(by_c, by_n, rows, rows - len(used))
