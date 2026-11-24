"""Campaign receipts per cycle (data dictionary: "Campaign finance block", `ReceiptsRow`). Read from the same `weball<yy>`
(FEC all-candidates summary) rows as the loans, with the same linkage: exact CAND_ID of the member, the first row per
(cycle, candidate id), presidential `P` ids included. Column layout: https://www.fec.gov/campaign-finance-data/all-candidates-file-description/
The file has one total for individual contributions (TTL_INDIV_CONTRIB); it has no itemised/unitemised split. The individual-level
(`indiv`) file is never read, so no contributor name, employer or address enters the pipeline.

Blank -> None, never 0. Cents are kept. A negative total or contribution figure is not published (None, listed in the report);
COH_COP (cash on hand at close) is published as filed because a committee can report a negative balance. A row whose individual,
committee, party, candidate or transfer figure exceeds TTL_RECEIPTS by more than TOLERANCE has those five set to None (listed in the
report): a breakdown larger than its total is a filing inconsistency, and the total is kept as filed.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import duckdb

from .load import q

OFFICE = {"H": "house", "S": "senate", "P": "president"}
TOLERANCE = 1.0   # dollars: rounding allowance when a component is compared with the total
MONEY = (("total_receipts", "TTL_RECEIPTS"), ("from_individuals", "TTL_INDIV_CONTRIB"),
         ("from_other_committees", "OTHER_POL_CMTE_CONTRIB"), ("from_party_committees", "POL_PTY_CONTRIB"),
         ("from_candidate", "CAND_CONTRIB"), ("transfers_from_authorised", "TRANS_FROM_AUTH"),
         ("total_disbursements", "TTL_DISB"), ("cash_on_hand", "COH_COP"))
COMPONENTS = ("from_individuals", "from_other_committees", "from_party_committees", "from_candidate", "transfers_from_authorised")
SIGNED = {"cash_on_hand"}   # may be negative as filed


def money(x: Any) -> float | int | None:
    if x is None:
        return None
    f = round(float(x), 2)
    return int(f) if f == int(f) else f


def receipt_rows(con: duckdb.DuckDBPyConnection, cycles: list[int], cand_to_bio: dict[str, str],
                 report: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """{bioguide: [row per (cycle, candidate id)]} in the same order as the loan rows. Writes report["receipts"]."""
    cyc = ",".join(str(c) for c in cycles)
    num = ", ".join(f"try_cast(nullif(trim({c}), '') AS DOUBLE)" for _, c in MONEY)
    rows = q(con, f"""SELECT cycle, CAND_ID, {num}, try_strptime(nullif(trim(CVG_END_DT), ''), '%m/%d/%Y')
                      FROM weball WHERE cycle IN ({cyc}) ORDER BY cycle, CAND_ID, line_no""")
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    negative: list[dict[str, Any]] = []
    inconsistent: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for cycle, cand, *vals, through in rows:
        bio = cand_to_bio.get(cand)
        if bio is None or (cycle, cand) in seen:
            continue
        seen.add((cycle, cand))
        row: dict[str, Any] = {"cycle": cycle, "candidate_id": cand, "office": OFFICE.get(cand[:1])}
        for (key, col), v in zip(MONEY, vals):
            if v is not None and v < 0 and key not in SIGNED:
                negative.append({"cycle": cycle, "candidate_id": cand, "field": col, "value": money(v)})
                v = None
            row[key] = money(v)
        total = row["total_receipts"]
        over = [k for k in COMPONENTS if total is not None and row[k] is not None and row[k] > total + TOLERANCE]
        if over:
            inconsistent.append({"cycle": cycle, "candidate_id": cand, "total_receipts": total,
                                 "exceeding": {k: row[k] for k in over}})
            for k in COMPONENTS:
                row[k] = None
        row["through"] = through.date().isoformat() if through else None
        out[bio].append(row)
    report["receipts"] = {"rows_of_members": sum(len(v) for v in out.values()), "members": len(out),
                          "negative_figures_not_published": negative, "components_exceed_total_not_published": inconsistent}
    return out
