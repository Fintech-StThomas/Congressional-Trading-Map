"""Published pieces of the review flags (data dictionary: "Review flags"; method: docs/review-flags.md): the `rules`
block (fixed id, short neutral label, one-sentence definition, thresholds, counts), the site-wide `flags.json`
(columnar rows, selection rule, row cap stated in the file) and the `meta.json.flags` summary. Pure functions over a
`flags.Review`; reads and writes nothing.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .. import config as K
from .budget import num
from .flags import RULE_IDS, Review
from .flags_chance import baseline

FLAGS_COLS = ["member", "id", "date", "available", "ticker", "org", "action", "low", "high", "rules", "owner"]
STATEMENT = ("A flag means a published rule was met and the trade may be worth a reporter's look. "
             "A flag is a prompt for reporting, not a finding.")
LABELS = {
    "late": ("Made public after 45 days",
             f"The trade became public more than {K.LATE_DAYS} days after the transaction date (the STOCK Act outer limit)."),
    "large_amount": ("Large disclosed amount",
                     f"The disclosed range starts at ${K.FLAGS_LARGE_MIN_LOW:,} or more (the STOCK Act bands from "
                     "$250,001-$500,000 up)."),
    "pile_on": (f"Several members, same stock, within {K.FLAGS_PILE_ON_DAYS} days",
                f"At least {K.FLAGS_PILE_ON_MIN_OTHERS} other members made a trade in the same company, in the same "
                f"direction, within {K.FLAGS_PILE_ON_DAYS} days, and at least {K.FLAGS_PILE_ON_LIFT} times as many as expected: "
                f"the sum, over members who traded that company that way within {K.FLAGS_PILE_ON_BASE_DAYS} days either side "
                "of the trade, of their trading days in that span x 15/365 (each capped at 1)."),
    "money_both_ways": ("Company PAC gave in the same cycle",
                        "The company's PAC gave money to the member in the same two-year FEC cycle as the trade."),
    "sector_overseen": ("Sector of a committee seat",
                        "The member sits on a full committee whose chamber-rule jurisdiction covers the company's SEC industry code."),
}


def thresholds(rule: str, committees: int) -> dict[str, Any]:
    return {
        "late": {"days": K.LATE_DAYS, "measure": "Trade.lag_days"},
        "large_amount": {"min_low": K.FLAGS_LARGE_MIN_LOW},
        "pile_on": {"window_days": K.FLAGS_PILE_ON_DAYS, "min_other_members": K.FLAGS_PILE_ON_MIN_OTHERS,
                    "members_listed": K.FLAGS_PILE_ON_LISTED, "eligibility": "traded_together rule", "actions": ["buy", "sell"],
                    "min_lift": K.FLAGS_PILE_ON_LIFT, "base_days": K.FLAGS_PILE_ON_BASE_DAYS,
                    "expected": "sum over the other members who traded the org in that direction within base_days either side "
                    "of the trade date of min(1, their distinct trading days in that span x (2 x window_days + 1) / 365), floored at 1/365"},
        "money_both_ways": {"edge_type": "pac_money", "cycle": "year + year % 2", "amount": "net positive in the cycle"},
        "sector_overseen": {"from": K.FLAGS_COMMITTEE_FROM, "committees": "full committees, current Congress",
                            "table": "pipeline/crosswalk/committee_sectors.csv", "committees_mapped": committees,
                            "match": "4-digit SIC code starts with a listed 2- to 4-digit prefix and with no carved-out one",
                            "assignments": "current rosters applied back to the from date; changes during the Congress are not dated",
                            "status": "drafted for team review"},
    }[rule]


def baselines(rv: Review) -> dict[str, dict[str, Any]]:
    """Per rule: "descriptive", or "chance" with the number and share of evaluated trades expected to meet it by chance
    (flags_chance.py). pile_on adds the summed expected and observed other members; null when there is no data."""
    totals, out = rv.totals(), {}
    for r in RULE_IDS:
        c = rv.chance.get(r, {})
        extra = ({"expected_others_sum": round(c["expected_sum"], 1), "observed_others_sum": c["observed_sum"],
                  "expected_others_mean": round(c["expected_sum"] / totals[r]["evaluated"], 4) if totals[r]["evaluated"] else None}
                 if r == "pile_on" and c else None)
        out[r] = baseline(r, totals[r]["evaluated"], c.get("expected_met"), extra)
    return out


def rules_block(rv: Review, committees: int) -> list[dict[str, Any]]:
    totals, base = rv.totals(), baselines(rv)
    out = []
    for r in RULE_IDS:
        out.append({"id": r, "label": LABELS[r][0], "definition": LABELS[r][1], "thresholds": thresholds(r, committees),
                    "counts": totals[r], "baseline": base[r], "note": None})
    return out


def flag_row(member: str, t: Any, rules: list[str]) -> list[Any]:
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return [member, t["id"], iso(t["date"]), iso(t["available"]), t["ticker"], t["org"], t["action"], num(t["low"]),
            num(t["high"]), rules, t["owner"]]


def selection(n_rules: int, available: date | None, build: date) -> bool:
    """flags.json keeps a flagged trade meeting FLAGS_MIN_RULES_LISTED rules, or made public in the last FLAGS_RECENT_DAYS."""
    return n_rules >= K.FLAGS_MIN_RULES_LISTED or (available is not None and build - timedelta(days=K.FLAGS_RECENT_DAYS) < available <= build)


def flags_file(rv: Review, build: date, committees: int) -> dict[str, Any]:
    picked = []
    for member, trades in rv.flags.items():
        for tid, d in trades.items():
            t = rv.trades[tid]
            if selection(len(d), t["available"], build):
                picked.append((member, t, sorted(d, key=RULE_IDS.index)))
    # Cap (stated in the file, never silent): most rules first, then newest public date, then trade id.
    picked.sort(key=lambda x: (-len(x[2]), -(x[1]["available"] or date.min).toordinal(), x[1]["id"]))
    kept = picked[:K.FLAGS_MAX_ROWS]
    return {
        "method_version": K.FLAGS_METHOD_VERSION, "build_date": build.isoformat(), "statement": STATEMENT,
        "rules": rules_block(rv, committees),
        "selection": {"rule": (f"Every counted trade meeting at least {K.FLAGS_MIN_RULES_LISTED} rules, plus every counted "
                               f"trade meeting any rule that became public in the {K.FLAGS_RECENT_DAYS} days up to the build date."),
                      "min_rules": K.FLAGS_MIN_RULES_LISTED, "recent_days": K.FLAGS_RECENT_DAYS, "max_rows": K.FLAGS_MAX_ROWS,
                      "order": "most rules, then newest public date, then trade id",
                      "rows_selected": len(picked), "rows_published": len(kept), "truncated": len(kept) < len(picked)},
        "cols": FLAGS_COLS, "rows": [flag_row(m, t, rules) for m, t, rules in kept]}


def flags_meta(rv: Review) -> dict[str, Any]:
    """meta.json.flags: method version and per-rule counts, for /method."""
    return {"method_version": K.FLAGS_METHOD_VERSION, "file": "flags.json", "rules": rv.totals(), "baselines": baselines(rv),
            "trades_counted": sum(rv.counted.values()), "trades_flagged": len(rv.trades), "statement": STATEMENT}
