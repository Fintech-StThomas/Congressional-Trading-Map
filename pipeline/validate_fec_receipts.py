"""Checks for `campaign_finance.receipts` (data dictionary: "Campaign finance block", `ReceiptsRow`). Called from
validate_fec_spending.check_campaign_finance. Checks: exact key set; cycle even; candidate id is one of the member's FEC ids;
office agrees with the id's first letter; amounts are numbers or null (null-safe), and not negative except `cash_on_hand`
(published as filed, may be negative); `through` is a real calendar date; no individual or component figure exceeds
`total_receipts` by more than the $1 rounding allowance; rows unique, ordered and the same (cycle, id) keys as `loans`.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from .fec.receipts import COMPONENTS, MONEY, OFFICE, TOLERANCE

KEYS = {"cycle", "candidate_id", "office", "through"} | {k for k, _ in MONEY}


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def real_date(v: Any) -> bool:
    if v is None:
        return True
    try:
        return isinstance(v, str) and len(v) == 10 and date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def check_receipts(c: Any, rows: Any, loans: Any, where: str, fec_ids: set[str]) -> None:
    c.check(isinstance(rows, list), "campaign_finance: schema", f"{where}.receipts")
    if not isinstance(rows, list):
        return
    keys: list[tuple[int, str]] = []
    for i, r in enumerate(rows):
        w = f"{where}.receipts[{i}]"
        ok = isinstance(r, dict) and set(r) == KEYS
        c.check(ok, "campaign_finance: schema", f"{w}: keys")
        if not ok:
            continue
        cid = r["candidate_id"]
        c.check(isinstance(r["cycle"], int) and not isinstance(r["cycle"], bool) and r["cycle"] % 2 == 0,
                "campaign_finance: schema", f"{w}.cycle")
        c.check(cid in fec_ids, "campaign_finance: candidate id is one of the member's FEC ids", f"{w}:{cid}")
        c.check(r["office"] == OFFICE.get(str(cid)[:1]), "campaign_finance: office agrees with the candidate id", w)
        c.check(real_date(r["through"]), "campaign_finance: coverage end date is a calendar date", f"{w}.through={r['through']}")
        for k, _ in MONEY:
            v = r[k]
            good = v is None or (_num(v) and (k == "cash_on_hand" or v >= 0))
            c.check(good, "campaign_finance: receipts amounts are numbers, null or non-negative", f"{w}.{k}={str(v)[:20]}")
        total = r["total_receipts"]
        if _num(total):
            for k in COMPONENTS:
                v = r[k]
                c.check(not _num(v) or v <= total + TOLERANCE, "campaign_finance: a receipts component never exceeds the total",
                        f"{w}.{k}={v} total={total}")
        keys.append((r["cycle"], cid))
    c.check(len(keys) == len(set(keys)) and keys == sorted(keys), "campaign_finance: receipts rows unique and ordered", where)
    if isinstance(loans, list) and all(isinstance(x, dict) for x in loans):
        c.check(keys == [(x.get("cycle"), x.get("candidate_id")) for x in loans],
                "campaign_finance: receipts rows are the same (cycle, candidate id) rows as loans", where)
