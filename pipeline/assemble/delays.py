"""Disclosure-timing aggregate (`delays.json`). Data dictionary: "Disclosure timing (`delays.json`)".

Counts, per member and site-wide, how many days passed between each trade's transaction date as filed and the date
the trade first became publicly available (`lag_days`, already on every published trade; a House reprint marked
Amended is folded into its original by pipeline/trade_amendments.py and adds no trade and no days). Observed elapsed days only:
not a compliance finding. Pure functions; reads and writes nothing. The input rows are the same current-version
trades that are published in `trades/<id>.json`, so a member's row can be re-derived from their trade file
(`rows_from_trade_file`), which is what the validator does.

Missing is never zero: a trade with no transaction date or no availability date has no lag, is counted as
`undated`, and is in no band. A trade with both dates but no lag (a later version changed its transaction date, so
the first public filing showed another date) is counted as `date_corrected`, and a House row marked Amended whose
original was not identified exactly (first public date unknown) as `amended_unmatched`; both are in no band. A
negative lag is counted separately and is in no band and no statistic. A trade a later filing marks Deleted is
listed in the trade file but is not an input here (`TradeFile.not_counted`).
Percentiles use the nearest-rank method over dated, non-negative lags (integers; the median is the 50th percentile).
"""
from __future__ import annotations

from collections import defaultdict
from math import ceil
from typing import Any, Iterable, Mapping, Sequence

from ..config import LATE_DAYS
from ..contract import TRADE_COLUMNS

BAND_EDGES = (30, LATE_DAYS, 90, 365)          # upper bounds (inclusive) of the first four bands
BAND_LABELS = (f"0-{BAND_EDGES[0]}", f"{BAND_EDGES[0] + 1}-{BAND_EDGES[1]}", f"{BAND_EDGES[1] + 1}-{BAND_EDGES[2]}",
               f"{BAND_EDGES[2] + 1}-{BAND_EDGES[3]}", f"over-{BAND_EDGES[3]}")
BAND_COLS = ("b0_30", "b31_45", "b46_90", "b91_365", "b366_plus")
MEMBER_COLS = ["id", "count", "dated", *BAND_COLS, "negative", "undated", "amended", "median", "p90", "max",
               "first_year", "last_year", "date_corrected", "amended_unmatched"]
CHAMBERS = ("rep", "sen")

DEFINITION = {
    "measured": "days from the transaction date as filed to the date the report became publicly available",
    "threshold_days": LATE_DAYS,
    "bands": list(BAND_LABELS),
    "percentile": "nearest-rank over dated, non-negative trades: sorted ascending, the value at position "
                  "ceil(p/100*n); median is p=50; integers; null when there are none",
    "caveats": [
        "These are observed elapsed days, not a finding about whether any filing was on time or lawful.",
        "The statutory clock runs from the filer's notification of the transaction, up to 45 days after the "
        "transaction; notification dates are not in the data, and only the 45-day outer bound can be compared.",
        "Extensions and fee waivers granted by the ethics committees are not in the data.",
        "Each trade is counted once, from the earliest date it was public: the earliest version of its event, and "
        "the earliest filing when a later House filing marked Amended or Deleted prints it again unchanged.",
        "When a later version changed the transaction date, the first public filing showed a different date; no "
        "elapsed-days figure is given for that trade. It is counted as date corrected, in no band and no statistic.",
        "A House row marked Amended that changes the date, owner, action, amount or asset cannot be tied to its "
        "original exactly, so the date the trade was first public is unknown; no elapsed-days figure is given for "
        "it. It is counted as amended, original not matched, in no band and no statistic.",
        "A trade that a later House filing marks Deleted is listed on the member's page and is not counted here.",
        "amended counts every amended trade separately; it overlaps the bands and the other counts.",
        "Trades with no transaction date or no availability date are counted as undated, never as 0 days.",
        "A negative value means the recorded availability date precedes the transaction date on a trade with a "
        "single version; the filing is unexplained by these fields and is counted separately.",
    ],
}


def band_index(lag: int) -> int:
    for i, edge in enumerate(BAND_EDGES):
        if lag <= edge:
            return i
    return len(BAND_EDGES)


def nearest_rank(sorted_vals: Sequence[int], p: int) -> int | None:
    if not sorted_vals:
        return None
    return sorted_vals[max(ceil(p * len(sorted_vals) / 100) - 1, 0)]


class Acc:
    """Accumulates one group (a member, a chamber, a year, or everything)."""

    def __init__(self) -> None:
        self.count = 0
        self.bands = [0] * len(BAND_LABELS)
        self.negative = self.undated = self.amended = self.date_corrected = self.amended_unmatched = 0
        self.lags: list[int] = []
        self.years: list[int] = []

    def add(self, t: Mapping[str, Any]) -> None:
        self.count += 1
        self.amended += bool(t["amended"])
        if t["date"]:
            self.years.append(int(str(t["date"])[:4]))
        lag = t["lag_days"]
        if lag is None and t["date"] and t.get("available"):    # withheld; the reason is TradeFile.lag_withheld
            unmatched = t.get("lag_withheld") == "amended_unmatched"
            self.amended_unmatched += unmatched
            self.date_corrected += not unmatched
        elif lag is None:
            self.undated += 1
        elif lag < 0:
            self.negative += 1
        else:
            self.bands[band_index(lag)] += 1
            self.lags.append(lag)

    def stats(self) -> tuple[int | None, int | None, int | None]:
        s = sorted(self.lags)
        return nearest_rank(s, 50), nearest_rank(s, 90), (s[-1] if s else None)

    def group(self) -> dict[str, Any]:
        med, p90, mx = self.stats()
        return {"count": self.count, "dated": self.count - self.undated - self.date_corrected - self.amended_unmatched,
                "bands": dict(zip(BAND_LABELS, self.bands)), "negative": self.negative, "undated": self.undated,
                "date_corrected": self.date_corrected, "amended_unmatched": self.amended_unmatched, "amended": self.amended,
                "median": med, "p90": p90, "max": mx}

    def row(self, member: str) -> list[Any]:
        med, p90, mx = self.stats()
        return [member, self.count, self.count - self.undated - self.date_corrected - self.amended_unmatched,
                *self.bands, self.negative, self.undated, self.amended, med, p90, mx,
                min(self.years) if self.years else None, max(self.years) if self.years else None, self.date_corrected,
                self.amended_unmatched]


def build_delays(trades: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """trades: the counted trades. Each needs: member, chamber, date (date, ISO string or None), lag_days (int or
    None), amended; `available` to tell a withheld lag from a missing date (absent or None: undated); and
    `lag_withheld` to tell the two withheld buckets apart (absent: date_corrected)."""
    total, per_member = Acc(), defaultdict(Acc)
    per_chamber, per_year = {ch: Acc() for ch in CHAMBERS}, defaultdict(Acc)
    for t in trades:
        year = str(t["date"])[:4] if t["date"] else "none"
        for acc in (total, per_member[t["member"]], per_chamber[t["chamber"]], per_year[year]):
            acc.add(t)
    return {"definition": DEFINITION, "totals": total.group(),
            "by_chamber": {ch: per_chamber[ch].group() for ch in CHAMBERS},
            "by_year": {y: per_year[y].group() for y in sorted(per_year)},
            "members": {"cols": MEMBER_COLS, "rows": [per_member[m].row(m) for m in sorted(per_member)]}}


def rows_from_trade_file(member: str, tf: Mapping[str, Any] | Iterable[Sequence[Any]]) -> list[dict[str, Any]]:
    """A published trade file (or bare rows in TRADE_COLUMNS order) -> builder input: the counted rows, each with its
    `lag_withheld` reason. The published file has no chamber."""
    tf = tf if isinstance(tf, Mapping) else {"rows": list(tf)}
    skip, withheld = tf.get("not_counted") or {}, tf.get("lag_withheld") or {}
    out = []
    for r in tf.get("rows", []):
        d = dict(zip(TRADE_COLUMNS, r))
        if d["id"] not in skip:
            out.append({"member": member, "chamber": None, "date": d["date"], "lag_days": d["lag_days"],
                        "amended": d["amended"], "available": d["available"], "lag_withheld": withheld.get(d["id"])})
    return out
