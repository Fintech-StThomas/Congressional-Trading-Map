"""Checks and a printed report for the conduit rule (pipeline/fec/conduits.py; docs/fec-conduits.md). Called from
validate.main with meta.json. A build without the FEC stage has no `reports.fec` and is skipped. meta.json carries
counts only; the full review lists are read from pipeline/build/fec_conduit_review.json (written by the FEC stage).

Hard checks (fail the build):
- `meta.exclusions.conduit_pass_through` is the FEC stage's own count, with rows and dollars as numbers, a reason,
  one entry per listed committee id and per-committee rows that add up to the total;
- the review file is present and its lists have the lengths meta.json counts (and meta.json holds no list);
- no kept 24K row is from a listed conduit in a listed cycle (a kept in-kind 24Z row of a listed id is expected:
  the rule covers 24K only; the sums and small-row lists are 24K only).
Report only (printed, never fails): kept pac_money rows from non-party givers above $5,000, giver -> member ->
election sums above $5,000, and givers with many rows under $200. These are candidates for the reviewed list, to be
checked against the recipient's own Schedule A before an id is added.

Single rows above $10,000 (hard): every kept one must be on the reviewed allow-list `ALLOWED_ROWS` (FEC SUB_IDs read
against the giver's and the recipient's filings and kept as filed). The 51 rows of 2026-11-24 were reviewed
(docs/fec-reviewed-rows.md): 38 are dropped by fec/reviewed_rows.py and 13 are allowed here. A new row above $10,000 fails the build until it is reviewed and added
to one list or the other.
`meta.exclusions.reviewed_not_received` must be the FEC stage's own count, its reasons adding up to it.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .fec import conduits, reviewed_rows
from .util import BUILD, read_json

# FEC SUB_IDs of single rows above $10,000 reviewed and kept as filed (evidence: docs/fec-reviewed-rows.md)
ALLOWED_ROWS: frozenset[str] = frozenset({
    "4032920101124718041", "2120820161357086158", "2042620181530472549", "4100720242069224697", "4101720141226179175",
    "4100220061069805649", "4061520141215164304", "2042720181530585822", "1091720090000738695", "4012520241816510641",
    "4041920231743310395", "4012720111134918788", "4112220161351132702",
})
ENFORCE_HARD = True
LISTS = (("rows_over_limit", "rows"), ("rows_over_hard", "rows"), ("sums_over_limit", "sums"), ("small_row_givers", "givers"))


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def unreviewed_hard_rows(review: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in review.get("rows_over_hard", {}).get("rows", []) if str(r.get("sub_id")) not in ALLOWED_ROWS]


def check_conduits(c: Any, meta: dict[str, Any], review: dict[str, Any] | None = None, enforce_hard: bool = ENFORCE_HARD,
                   review_path: Path | None = None) -> None:
    fec = (meta.get("reports") or {}).get("fec")
    if not isinstance(fec, dict):
        return
    rule = "fec conduits: exclusion is counted in meta.json"
    ex = (meta.get("exclusions") or {}).get(conduits.KEY)
    c.check(isinstance(ex, dict) and ex == (fec.get("exclusions") or {}).get(conduits.KEY), rule, "meta.exclusions vs reports.fec")
    rr = (meta.get("exclusions") or {}).get(reviewed_rows.KEY)
    by = rr.get("by_reason") if isinstance(rr, dict) and isinstance(rr.get("by_reason"), dict) else {}
    c.check(isinstance(rr, dict) and rr == (fec.get("exclusions") or {}).get(reviewed_rows.KEY) and _num(rr.get("rows"))
            and isinstance(rr.get("reason"), str) and sorted(by) == sorted(reviewed_rows.REASONS)
            and sum(v.get("rows", 0) for v in by.values()) == rr.get("rows"),
            "fec reviewed rows: exclusion is counted in meta.json", "meta.exclusions vs reports.fec")
    counts = fec.get("conduit_review")
    path = review_path or BUILD / conduits.REVIEW_FILE
    if review is None and path.exists():
        review = read_json(path)
    c.check(isinstance(counts, dict) and isinstance(review, dict), "fec conduits: review of kept rows is present",
            f"reports.fec.conduit_review and {path.name}")
    if not isinstance(ex, dict) or not isinstance(counts, dict) or not isinstance(review, dict):
        return
    cm = ex.get("committees") if isinstance(ex.get("committees"), list) else []
    c.check(_num(ex.get("rows")) and _num(ex.get("dollars")) and isinstance(ex.get("reason"), str) and ex["reason"], rule, "rows/dollars/reason")
    c.check([x.get("committee") for x in cm] == sorted(conduits.LISTED), "fec conduits: one count per listed committee id", str(len(cm)))
    c.check(sum(x.get("rows", 0) for x in cm) == ex.get("rows")
            and abs(sum(x.get("dollars", 0) for x in cm) - (ex.get("dollars") or 0)) < 0.01 * max(1, len(cm)),
            "fec conduits: committee counts add up to the total", f"{ex.get('rows')} rows")
    for name, items in LISTS:
        part = review.get(name) if isinstance(review.get(name), dict) else {}
        lst = part.get(items) if isinstance(part.get(items), list) else None
        in_meta = counts.get(name) if isinstance(counts.get(name), dict) else {}
        c.check(lst is not None and len(lst) == part.get("count") == in_meta.get("count") and items not in in_meta,
                "fec conduits: review counts agree with their lists", name)
        for r in lst or []:
            kept_24k = r.get("type", conduits.TYPE) == conduits.TYPE
            c.check(not (kept_24k and (r.get("committee") in conduits.FORWARDERS or conduits.is_listed(r.get("committee"), r.get("cycle")))),
                    "fec conduits: no kept row is from a listed conduit", f"{name}:{r.get('committee')}:{r.get('cycle')}")
    todo = unreviewed_hard_rows(review)
    if enforce_hard:
        for r in todo:
            c.check(False, f"fec conduits: single pac_money row above ${conduits.HARD:,} not on the reviewed allow-list",
                    f"{r.get('sub_id')} {r.get('committee')} -> {r.get('to')} {r.get('date')} ${r.get('amount')}")
    print_report(ex, review, todo, enforce_hard)


def print_report(ex: dict[str, Any], review: dict[str, Any], todo: list[dict[str, Any]], enforce_hard: bool) -> None:
    over, sums, small = review["rows_over_limit"], review["sums_over_limit"], review["small_row_givers"]
    print(f"fec conduits: {ex['rows']:,} rows (${ex['dollars']:,.0f}) from {len(conduits.LISTED)} listed conduit PACs left out of pac_money")
    print(f"fec conduits report: {over['count']:,} kept rows above ${conduits.LIMIT:,} from non-party givers "
          f"(${over['dollars']:,.0f}, {over['givers']:,} givers); {sums['count']:,} giver-member-election sums above "
          f"${conduits.LIMIT:,}; {small['count']:,} giver-cycles with {conduits.SMALL_ROWS}+ rows under ${conduits.SMALL}")
    print(f"fec conduits report: {len(todo)} single rows above ${conduits.HARD:,} not on the allow-list "
          f"({'enforced: each fails the build' if enforce_hard else 'report only, see validate_fec_conduits.py'})")
    for r in todo[:40]:
        print(f"  {r.get('date')} {r.get('committee')} {str(r.get('committee_name') or '')[:40]:40} -> {r.get('to')} "
              f"${r.get('amount'):,.0f} sub_id {r.get('sub_id')}")
