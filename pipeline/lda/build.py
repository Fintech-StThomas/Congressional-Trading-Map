"""Parse cached LDA pages into lobbyist_money and revolving_door rows (no network)."""
from __future__ import annotations

import csv
import gzip
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from ..util import normalise_name
from . import download as dl
from .match import Matcher, Member, fec_person_name, name_keys, serving_years

REPO = dl.REPO
BUILD = REPO / "pipeline" / "build"
FEC_DB = REPO / "pipeline" / ".cache" / "fec" / "fec.duckdb"
FEC_INDEX = dl.CACHE / "fec_committees.json.gz"
OVERRIDES = REPO / "pipeline" / "crosswalk" / "org_overrides.csv"

# LD-203 item types (constants/contribution/itemtypes). Counted as money to or for a member of Congress:
#   feca = contribution to a federal candidate, leadership PAC or party committee (FECA);
#   he   = honorary expense: paid to honour or recognise the official, or to an entity named for or designated
#          by the official;
#   me   = meeting expense: paid for a meeting, retreat or conference held by or in the name of the official.
# Not counted (the honoree is the President or an inaugural/library committee, not a member):
#   ple  = presidential library expense, pic = presidential inaugural committee.
COUNTED_TYPES = {"feca": "FECA contribution", "he": "honorary expense", "me": "meeting expense"}
EXCLUDED_TYPES = {"ple": "presidential library expense", "pic": "presidential inaugural committee"}
METHOD_LABEL = {"payee_committee": "payee is the member's FEC committee",
                "honoree_name": "honoree is the member's full name",
                "payee_name": "payee is the member's full name"}


# ---------------------------------------------------------------- reference data

def fec_committee_index() -> dict:
    """{"member": {normalised committee name: [bioguide, ...]}, "other": [normalised names]} from the FEC module's
    cache (authorised committees and sponsored leadership PACs, all cycles). Read-only; snapshotted into the LDA
    cache so the stage still runs when the DuckDB file is absent or locked."""
    try:
        import duckdb
        con = duckdb.connect(str(FEC_DB), read_only=True)
        rows = con.execute("""
            with link as (select CMTE_ID, bioguide from auth_member_saved
                          union select CMTE_ID, bioguide from lpac_saved)
            select distinct cm.CMTE_NM, link.bioguide from cm left join link using (CMTE_ID)
            where cm.CMTE_NM is not null""").fetchall()
        cand = con.execute("""select distinct cn.CAND_NAME, m.bioguide from cn
                              join cand_member_saved m on m.cand_id = cn.CAND_ID""").fetchall()
        con.close()
    except Exception as e:  # noqa: BLE001
        if FEC_INDEX.exists():
            print(f"  FEC DuckDB unavailable ({type(e).__name__}); using snapshot {FEC_INDEX.name}")
            return json.loads(gzip.decompress(FEC_INDEX.read_bytes()))
        raise
    member: dict[str, set[str]] = defaultdict(set)
    seen: set[str] = set()
    for name, bio in rows:
        n = normalise_name(name)
        if not n:
            continue
        seen.add(n)
        if bio:
            member[n].add(bio)
    cand_names: dict[str, set[str]] = defaultdict(set)
    for name, bio in cand:
        p = fec_person_name(name)
        if p:
            cand_names[bio].add(p)
    out = {"member": {k: sorted(v) for k, v in sorted(member.items())},
           "other": sorted(seen - set(member)),
           "cand_names": {k: sorted(v) for k, v in sorted(cand_names.items())}}
    FEC_INDEX.parent.mkdir(parents=True, exist_ok=True)
    FEC_INDEX.write_bytes(gzip.compress(json.dumps(out, sort_keys=True).encode(), mtime=0))
    return out


def load_matcher(spine: dict, fec: dict) -> Matcher:
    members = {}
    for bio, m in spine.items():
        names = [m["name"], f"{m.get('first') or ''} {m.get('last') or ''}"]
        names += fec["cand_names"].get(bio, [])
        members[bio] = Member(bio, m["name"], name_keys(names), serving_years(m.get("terms") or []))
    return Matcher(members, {k: set(v) for k, v in fec["member"].items()}, set(fec["other"]))


@dataclass
class OrgResolver:
    companies: dict[str, str]
    info: dict[str, dict]
    overrides: dict[tuple[str, str], str]
    used: Counter = field(default_factory=Counter)
    orgs: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls) -> "OrgResolver":
        names = json.loads((BUILD / "company_names.json").read_text())
        names = {k: (v if isinstance(v, str) else v.get("id")) for k, v in names.items()}
        info = json.loads((BUILD / "companies.json").read_text())
        ov: dict[tuple[str, str], str] = {}
        if OVERRIDES.exists():
            with open(OVERRIDES, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    src = (r.get("source") or "").strip().lower()
                    if src in ("lda_registrant", "lda_client") and (r.get("reviewed_by") or "").strip() \
                            and (r.get("org_id") or "").strip():
                        key = (r.get("source_id_or_name") or "").strip()
                        ov[(src, key if key.isdigit() else normalise_name(key))] = r["org_id"].strip()
        return cls({k: v for k, v in names.items() if v}, info, ov)

    def resolve(self, role: str, lda_id: int, name: str) -> str:
        """role is 'registrant' or 'client'. Override by LDA id or normalised name, then exact company name."""
        n = normalise_name(name or "")
        src = f"lda_{role}"
        oid = self.overrides.get((src, str(lda_id))) or self.overrides.get((src, n))
        how = "override" if oid else None
        if not oid and n in self.companies:
            oid, how = self.companies[n], "company_name"
        if oid:
            self.used[f"{role}:{how}"] += 1
            if oid.startswith("co:") and oid not in self.orgs:
                c = self.info.get(oid, {})
                self.orgs[oid] = {"id": oid, "name": c.get("name") or name, "kind": "company",
                                  "ticker": c.get("ticker"), "cik": c.get("cik"), "sector": c.get("sector")}
            return oid
        self.used[f"{role}:unmatched"] += 1
        oid = f"lda:{role}-{lda_id}"
        if oid not in self.orgs:
            self.orgs[oid] = {"id": oid, "name": (name or "").strip(), "kind": "lobby" if role == "registrant"
                              else "other", "ticker": None, "cik": None, "sector": None}
        return oid


# ---------------------------------------------------------------- cache reading

def read_slices(kinds: list[str], years: list[int]) -> tuple[dict[int, dict[str, dict]], dict]:
    """{year: {filing_uuid: record}} from every cached page (complete or not) plus per-year completeness."""
    out: dict[int, dict[str, dict]] = defaultdict(dict)
    status: dict[int, dict] = {}
    for kind, year, _after, _before, d in dl.iter_slices(kinds, years):
        st = dl.read_state(d)
        s = status.setdefault(year, {"slices": 0, "complete": 0, "pages": 0, "pages_cached": 0, "rows": 0})
        s["slices"] += 1
        s["complete"] += bool(st.get("complete"))
        s["pages"] += st.get("pages", 0)
        for p in sorted(d.glob("p*.json.gz")) if d.exists() else []:
            s["pages_cached"] += 1
            for r in dl.load_page(p):
                s["rows"] += 1
                out[year][r["filing_uuid"]] = r
    return out, status


def manifest_hash(kinds: list[str]) -> tuple[str, int]:
    import hashlib
    h = hashlib.sha256()
    n = 0
    for kind in kinds:
        for st in sorted((dl.CACHE / "pages" / kind).glob("*/*/state.json")):
            h.update(st.parent.relative_to(dl.CACHE).as_posix().encode())
            h.update(st.read_bytes())
            n += 1
    return h.hexdigest(), n


# ---------------------------------------------------------------- helpers

def money(v) -> float | None:
    try:
        return round(float(str(v).replace(",", "").replace("$", "")), 2)
    except (TypeError, ValueError):
        return None


def person(p: dict | None) -> str:
    if not p:
        return ""
    return " ".join(x for x in (p.get("first_name"), p.get("middle_name"), p.get("last_name"),
                                p.get("suffix_display") or p.get("suffix")) if x).strip()


def fmt_usd(x: float) -> str:
    return f"${x:,.0f}" if float(x).is_integer() else f"${x:,.2f}"


def _key(text: str) -> str:
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", (text or "").upper()).split())
