"""Print the two filed records a reviewer reads for a single FEC contribution row above $10,000 (docs/fec-reviewed-rows.md):

- the giver's Schedule B lines to the recipient committee, three days either side of the date, largest first: payee,
  purpose, memo code and memo text (OpenFEC /v1/schedules/schedule_b/);
- the recipient's Schedule A receipts from the giver, 60 days before to 150 days after, largest first: line, receipt
  type, memo code and memo text (OpenFEC /v1/schedules/schedule_a/).

Usage (from the repository root): python -m scripts.ops.review_fec_row <giver committee id> <recipient committee id> <YYYY-MM-DD> <amount>
Needs FEC_API_KEY (or a proxy that injects it). Reads only; prints the evidence and decides nothing: the reviewer adds
the row's SUB_ID to pipeline/fec/reviewed_rows.py ROWS or to pipeline/validate_fec_conduits.py ALLOWED_ROWS by hand.
"""
from __future__ import annotations

import re
import sys
from datetime import date, timedelta
from typing import Any

ID = re.compile(r"^C\d{8}$")


def periods(d0: date, before: int, after: int) -> list[int]:
    """The FEC two-year periods (even years) a window around d0 touches."""
    first, last = d0 - timedelta(days=before), d0 + timedelta(days=after)
    return sorted({y + (y % 2) for y in range(first.year, last.year + 1)})


def queries(giver: str, recipient: str, d0: date) -> list[tuple[str, str, dict[str, Any]]]:
    """(label, path, params) for each OpenFEC request, largest amounts first so the row itself is on the first page."""
    out: list[tuple[str, str, dict[str, Any]]] = []
    for p in periods(d0, 3, 3):
        out.append(("giver Schedule B", "/schedules/schedule_b/", {
            "committee_id": giver, "recipient_committee_id": recipient, "two_year_transaction_period": p,
            "min_date": (d0 - timedelta(days=3)).isoformat(), "max_date": (d0 + timedelta(days=3)).isoformat(),
            "sort": "-disbursement_amount", "per_page": 100}))
    for p in periods(d0, 60, 150):
        out.append(("recipient Schedule A", "/schedules/schedule_a/", {
            "committee_id": recipient, "contributor_id": giver, "two_year_transaction_period": p,
            "min_date": (d0 - timedelta(days=60)).isoformat(), "max_date": (d0 + timedelta(days=150)).isoformat(),
            "sort": "-contribution_receipt_amount", "per_page": 100}))
    return out


def line(label: str, r: dict[str, Any]) -> str:
    if label.startswith("giver"):
        return (f"  {str(r.get('disbursement_date'))[:10]} {r.get('disbursement_amount'):>12} line {r.get('line_number')} "
                f"memo {r.get('memo_code') or '-'} payee {r.get('recipient_name')!r} purpose {r.get('disbursement_description')!r} "
                f"memo text {r.get('memo_text')!r} sub_id {r.get('sub_id')} image {r.get('image_number')}")
    return (f"  {str(r.get('contribution_receipt_date'))[:10]} {r.get('contribution_receipt_amount'):>12} line {r.get('line_number')} "
            f"type {r.get('receipt_type') or '-'} memo {r.get('memo_code') or '-'} from {r.get('contributor_name')!r} "
            f"memo text {r.get('memo_text')!r} image {r.get('image_number')}")


def main(argv: list[str]) -> int:
    if len(argv) != 4 or not ID.match(argv[0]) or not ID.match(argv[1]):
        print(__doc__, file=sys.stderr)
        return 2
    giver, recipient, d0, amount = argv[0], argv[1], date.fromisoformat(argv[2]), float(argv[3])
    from pipeline.fec.api import ApiError, FecApi
    api = FecApi()
    print(f"row: {giver} -> {recipient} {d0} ${amount:,.2f}")
    for label, path, params in queries(giver, recipient, d0):
        try:
            body = api.get(path, params)
        except ApiError as e:
            print(f"{label} {params['two_year_transaction_period']}: not read ({e})")
            return 1
        rows = body["results"]
        print(f"{label}, period {params['two_year_transaction_period']}: {body['pagination'].get('count')} rows "
              f"(largest {len(rows)} shown)")
        for r in rows:
            print(line(label, r))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
