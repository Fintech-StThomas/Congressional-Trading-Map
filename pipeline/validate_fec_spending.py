"""Checks for the `campaign_finance` block of a member file (data dictionary: "Campaign finance block"). Called from
pipeline/validate.py for every member file; reads nothing itself except, when it exists, the committee links in
pipeline/build/campaign_finance.json (committee -> member and method, written by pipeline/fec/spending.py).

Checks: schema and key sets; amounts non-negative or null; category spent and refund sums and counts add up to the committee-cycle
sums; purpose groups (validate_fec_purposes.py); candidate ids are among the member's `fec_ids` and committee ids are linked to that member (exact ids only);
cycles even, unique and ordered; no member without an FEC id has a block; and no payee, lender, address or similar key
and no street-address-looking text anywhere in the block.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from .fec.spending_oppexp import CATEGORY_LABELS
from .validate_fec_purposes import LINK_METHODS, check_coverage, check_purposes
from .util import BUILD, read_json

OFFICES = {"house", "senate", "president", None}
LOAN_KEYS = ("candidate_loans", "other_loans", "candidate_loan_repayments", "other_loan_repayments", "debts_owed_by")
CANDIDATE_ID = re.compile(r"^(?:[HS]\d[A-Z]{2}\d{5}|P\d{8})$")   # House/Senate: H8VA01233; president: P60003225
COMMITTEE_ID = re.compile(r"^C\d{8}$")
# Key names that would mean an individual-level or address field leaked into the block.
FORBIDDEN_KEYS = re.compile(r"payee|lender|recipient|vendor|address|street|city|zip|state|phone|purpose(?!s?$|s_)|memo|"
                            r"^name$|^entity|^employer|^occupation", re.I)
ADDRESS_TEXT = re.compile(r"\b\d{1,6}\s+[A-Za-z0-9.' ]{2,30}\s(?:STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|DRIVE|DR|"
                          r"LANE|LN|WAY|SUITE|STE|FLOOR|FL)\b\.?|\bP\.?\s?O\.?\s+BOX\b", re.I)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_date(v: Any) -> bool:
    return isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) is not None


def _cycle_ok(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 2000 <= v <= 2100 and v % 2 == 0


def walk(obj: Any, path: str = "") -> list[tuple[str, str, Any]]:
    """(path, key, value) for every dict entry and (path, '', value) for every list item, recursively."""
    out: list[tuple[str, str, Any]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append((f"{path}.{k}", k, v))
            out.extend(walk(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.append((f"{path}[{i}]", "", v))
            out.extend(walk(v, f"{path}[{i}]"))
    return out


def check_privacy(c: Any, cf: Any, where: str) -> None:
    for path, key, val in walk(cf, where):
        c.check(not (key and FORBIDDEN_KEYS.search(key)), "campaign_finance: no payee or address field", path)
        if isinstance(val, str):
            c.check(ADDRESS_TEXT.search(val) is None, "campaign_finance: no street address text", f"{path}={val[:40]}")


def _shape(c: Any, obj: Any, spec: dict[str, Callable[[Any], bool]], where: str) -> bool:
    ok = isinstance(obj, dict) and set(obj) == set(spec)
    c.check(ok, "campaign_finance: schema", f"{where}: keys {sorted(set(obj) ^ set(spec)) if isinstance(obj, dict) else 'not an object'}")
    if isinstance(obj, dict):
        for k, pred in spec.items():
            if k in obj:
                c.check(pred(obj[k]), "campaign_finance: schema", f"{where}.{k}={str(obj[k])[:40]}")
    return ok


def _amount_req(v: Any) -> bool:
    return _is_num(v) and v >= 0


def _count(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _amount(v: Any) -> bool:
    return v is None or (_is_num(v) and v >= 0)


def check_loans(c: Any, rows: Any, where: str, fec_ids: set[str]) -> None:
    c.check(isinstance(rows, list), "campaign_finance: schema", f"{where}.loans")
    seen: list[tuple[int, str]] = []
    spec = {"cycle": _cycle_ok, "candidate_id": lambda v: isinstance(v, str) and CANDIDATE_ID.match(v) is not None,
            "office": lambda v: v in OFFICES, "through": lambda v: v is None or _is_date(v),
            **{k: _amount for k in LOAN_KEYS}}
    for i, r in enumerate(rows if isinstance(rows, list) else []):
        if _shape(c, r, spec, f"{where}.loans[{i}]"):
            c.check(r["candidate_id"] in fec_ids, "campaign_finance: candidate id is one of the member's FEC ids",
                    f"{where}:{r['candidate_id']}")
            seen.append((r["cycle"], r["candidate_id"]))
    c.check(len(seen) == len(set(seen)) and seen == sorted(seen), "campaign_finance: loan rows unique and ordered", where)


def check_pacs(c: Any, rows: Any, where: str, mid: str, links: dict[str, Any] | None,
               purposes_cycles: list[int] | None = None) -> None:
    c.check(isinstance(rows, list), "campaign_finance: schema", f"{where}.leadership_pac")
    cat_spec = {"category": lambda v: v is None or v in CATEGORY_LABELS, "label": lambda v: isinstance(v, str),
                "total": _amount_req, "count": _count, "refunds": _amount_req, "refund_count": _count}
    spec = {"committee_id": lambda v: isinstance(v, str) and COMMITTEE_ID.match(v) is not None,
            "committee_name": lambda v: isinstance(v, str) and v != "", "cycle": _cycle_ok,
            "sponsor_link": lambda v: v in LINK_METHODS, "total": _amount_req, "count": _count, "refunds": _amount_req, "refund_count": _count,
            "categories": lambda v: isinstance(v, list) and len(v) > 0, "purposes": lambda v: v is None or isinstance(v, list)}
    keys: list[tuple[int, str]] = []
    for i, p in enumerate(rows if isinstance(rows, list) else []):
        w = f"{where}.leadership_pac[{i}]"
        if not _shape(c, p, spec, w):
            continue
        keys.append((p["cycle"], p["committee_id"]))
        cats = [x for j, x in enumerate(p["categories"]) if _shape(c, x, cat_spec, f"{w}.categories[{j}]")]
        c.check(len(cats) == len(p["categories"]), "campaign_finance: schema", w)
        c.check(len({x["category"] for x in cats}) == len(cats), "campaign_finance: one row per category", w)
        for amt, n in (("total", "count"), ("refunds", "refund_count")):
            c.check(abs(sum(x[amt] for x in cats) - p[amt]) < 0.005 and sum(x[n] for x in cats) == p[n],
                    "campaign_finance: category sums equal the committee-cycle sums", f"{w} {amt} {p[amt]}")
        c.check(all(x["total"] >= 0 and x["refunds"] >= 0 for x in cats + [p]), "campaign_finance: amounts are not negative", w)
        check_purposes(c, p["purposes"], f"{w}.purposes", p["cycle"], purposes_cycles or [])
        if links is not None:
            link = links.get(p["committee_id"])
            c.check(link is not None and link["member"] == mid and link["method"] == p["sponsor_link"],
                    "campaign_finance: committee is linked to this member by the sponsor linkage", f"{w}:{p['committee_id']}")
    c.check(len(keys) == len(set(keys)) and keys == sorted(keys), "campaign_finance: leadership PAC rows unique and ordered", where)


def load_links() -> dict[str, Any] | None:
    """Committee links written by the FEC module, or None when the build file is absent (the check is then skipped)."""
    path = BUILD / "campaign_finance.json"
    return read_json(path).get("links") if path.exists() else None


def check_campaign_finance(c: Any, cf: Any, where: str, mid: str, fec_ids: list[str],
                           links: dict[str, Any] | None = None) -> None:
    """Validate one member file's `campaign_finance` (null or a block). `links` is the committee -> {member, method} map."""
    if cf is None:
        return
    c.check(bool(fec_ids), "campaign_finance: only members with an FEC id have a block", where)
    cyc = lambda v: isinstance(v, list) and all(_cycle_ok(x) for x in v) and v == sorted(set(v))   # noqa: E731
    cov_spec = {"loans_cycles": cyc, "leadership_pac_cycles": cyc, "purposes_cycles": cyc,
                "purposes_source": lambda v: isinstance(v, str),
                "leadership_pac_note": lambda v: v is None or (isinstance(v, str) and v != "")}
    if not _shape(c, cf, {"loans": lambda v: True, "leadership_pac": lambda v: True, "coverage": lambda v: isinstance(v, dict)}, where):
        return
    check_loans(c, cf["loans"], where, set(fec_ids))
    cov = cf["coverage"]
    check_pacs(c, cf["leadership_pac"], where, mid, links, cov.get("purposes_cycles") if isinstance(cov, dict) else None)
    if _shape(c, cov, cov_spec, f"{where}.coverage"):
        check_coverage(c, cov, f"{where}.coverage")
    c.check(bool(cf["loans"]) or bool(cf["leadership_pac"]), "campaign_finance: an empty block is published as null", where)
    c.check((cf["coverage"].get("leadership_pac_note") is None) == bool(cf["leadership_pac"]),
            "campaign_finance: a note when and only when there is no leadership PAC", where)
    check_privacy(c, cf, where)
