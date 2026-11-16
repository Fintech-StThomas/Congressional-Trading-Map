"""The disclosure-timing aggregate and its validator (pipeline/assemble/delays.py, pipeline/validate_delays.py)."""
from __future__ import annotations

import copy
import json
from datetime import date
from typing import Any

import pytest

from pipeline import validate
from pipeline.assemble.delays import BAND_LABELS, MEMBER_COLS, DEFINITION, build_delays, nearest_rank
from pipeline.assemble.members import trade_summary
from pipeline.config import LATE_DAYS
from pipeline.contract import TRADE_COLUMNS
from pipeline.validate_delays import check_delays


def tr(member: str = "A000001", lag: int | None = 10, *, amended: bool = False, chamber: str = "rep",
       year: int | None = 2020, tid: str = "x") -> dict[str, Any]:
    d = date(year, 3, 1) if year else None
    return {"id": tid, "member": member, "chamber": chamber, "date": d, "lag_days": lag, "amended": amended,
            "late": None if lag is None else lag > LATE_DAYS, "owner": "self", "action": "buy"}


def bands(doc: dict[str, Any]) -> list[int]:
    return list(doc["totals"]["bands"].values())


def test_empty() -> None:
    doc = build_delays([])
    assert doc["totals"]["count"] == 0 and doc["totals"]["median"] is None and doc["members"]["rows"] == []
    assert doc["by_year"] == {} and set(doc["by_chamber"]) == {"rep", "sen"}


def test_all_undated_is_not_zero_days() -> None:
    doc = build_delays([tr(lag=None, year=None), tr(lag=None)])
    t = doc["totals"]
    assert t["undated"] == 2 and t["dated"] == 0 and sum(t["bands"].values()) == 0
    assert t["median"] is None and t["p90"] is None and t["max"] is None
    assert doc["by_year"]["none"]["count"] == 1 and doc["by_year"]["2020"]["undated"] == 1
    row = dict(zip(MEMBER_COLS, doc["members"]["rows"][0]))
    assert row["first_year"] == 2020 and row["median"] is None


@pytest.mark.parametrize("lag,idx", [(0, 0), (30, 0), (31, 1), (45, 1), (46, 2), (90, 2), (91, 3), (365, 3), (366, 4), (4000, 4)])
def test_band_boundaries(lag: int, idx: int) -> None:
    doc = build_delays([tr(lag=lag)])
    expect = [0] * 5
    expect[idx] = 1
    assert bands(doc) == expect
    assert doc["definition"]["threshold_days"] == LATE_DAYS == 45


def test_negative_is_separate_and_out_of_stats() -> None:
    doc = build_delays([tr(lag=-3), tr(lag=7)])
    t = doc["totals"]
    assert t["negative"] == 1 and sum(t["bands"].values()) == 1 and t["max"] == 7 and t["median"] == 7
    assert sum(t["bands"].values()) + t["negative"] + t["undated"] == t["count"]


def test_amended_is_counted_and_stays_in_bands() -> None:
    doc = build_delays([tr(lag=100, amended=True), tr(lag=5)])
    t = doc["totals"]
    assert t["amended"] == 1 and bands(doc) == [1, 0, 0, 1, 0]


def test_nearest_rank_method() -> None:
    xs = list(range(1, 11))                 # 1..10
    assert nearest_rank(xs, 50) == 5 and nearest_rank(xs, 90) == 9 and nearest_rank(xs, 100) == 10
    assert nearest_rank([4], 90) == 4 and nearest_rank([], 50) is None
    doc = build_delays([tr(lag=n) for n in xs])
    assert (doc["totals"]["median"], doc["totals"]["p90"], doc["totals"]["max"]) == (5, 9, 10)


def test_chamber_year_and_members() -> None:
    doc = build_delays([tr("B", 10, chamber="sen", year=2015), tr("A", 50, year=2021), tr("A", None, year=None)])
    assert doc["by_chamber"]["sen"]["count"] == 1 and doc["by_chamber"]["rep"]["count"] == 2
    assert list(doc["by_year"]) == ["2015", "2021", "none"]
    assert [r[0] for r in doc["members"]["rows"]] == ["A", "B"]
    a = dict(zip(MEMBER_COLS, doc["members"]["rows"][0]))
    assert a["count"] == 2 and a["dated"] == 1 and a["b46_90"] == 1 and a["undated"] == 1 and a["median"] == 50
    assert a["first_year"] == a["last_year"] == 2021


def test_deterministic_and_order_independent() -> None:
    ts = [tr("B", 3), tr("A", 400, amended=True), tr("A", None, year=None), tr("C", 46, chamber="sen")]
    a = json.dumps(build_delays(ts), sort_keys=True)
    assert a == json.dumps(build_delays(list(reversed(ts))), sort_keys=True)
    assert "violat" not in a.lower() and "late filer" not in a.lower()


# ------------------------------------------------------------------ validator
def published(ts: list[dict[str, Any]]) -> tuple[dict[str, list[list[Any]]], dict[str, dict[str, Any]]]:
    rows: dict[str, list[list[Any]]] = {}
    sums: dict[str, dict[str, Any]] = {}
    for m in sorted({t["member"] for t in ts}):
        mine = [t for t in ts if t["member"] == m]
        rows[m] = [[{**t, "date": t["date"].isoformat() if t["date"] else None, "version": 1}.get(c) for c in TRADE_COLUMNS]
                   for t in mine]
        sums[m] = trade_summary(mine)
    return rows, sums


def run_check(doc: dict[str, Any], ts: list[dict[str, Any]], members: set[str] | None = None) -> dict[str, list[str]]:
    rows, sums = published(ts)
    c = validate.Checker()
    check_delays(c, doc, members if members is not None else set(rows), rows, sums, validate.is_date)
    return dict(c.errors)


TS = [tr("A", 10), tr("A", 60, amended=True), tr("A", None, year=None), tr("B", 400, chamber="sen", year=2016), tr("B", -2, chamber="sen")]


def test_validator_passes_good_document() -> None:
    assert run_check(build_delays(TS), TS) == {}


def test_validator_empty_tree() -> None:
    assert run_check(build_delays([]), []) == {}


def mutate(fn: Any) -> dict[str, list[str]]:
    doc = copy.deepcopy(build_delays(TS))
    fn(doc)
    return run_check(doc, TS)


def test_validator_failure_paths() -> None:
    assert "delays: schema" in mutate(lambda d: d.pop("by_year"))
    assert "delays: definition is the fixed text" in mutate(lambda d: d["definition"].update(threshold_days=30))
    assert "delays: bands + negative + undated = count" in mutate(lambda d: d["totals"]["bands"].update({"0-30": 99}))
    assert "delays: group schema" in mutate(lambda d: d["totals"].pop("max"))
    assert "delays: median <= p90 <= max, null iff no dated non-negative trade" in mutate(lambda d: d["totals"].update(median=None))
    assert "delays: member row equals the one re-derived from trades/<id>.json" in mutate(lambda d: d["members"]["rows"][0].__setitem__(1, 4))
    assert "delays: totals equal the sum of member rows" in mutate(lambda d: d["totals"].update(amended=0))
    assert "delays: by_year group equals the figures re-derived from published trade files" in mutate(lambda d: d["by_year"]["2020"].update(median=1))
    assert "delays: chambers sum to totals" in mutate(lambda d: d["by_chamber"]["sen"].update(count=0))
    assert "delays: member rows sorted and unique" in mutate(lambda d: d["members"]["rows"].reverse())
    assert "delays: members table schema" in mutate(lambda d: d["members"]["cols"].reverse())


def test_validator_unknown_member_and_missing_row() -> None:
    assert "delays: every member id exists in members.json" in run_check(build_delays(TS), TS, members={"A"})
    doc = build_delays(TS)
    doc["members"]["rows"].pop()
    assert "delays: one row per member with published trades" in run_check(doc, TS)


def test_validator_late_and_count_must_match_trade_summary() -> None:
    rows, sums = published(TS)
    sums["A"]["late"] += 1
    sums["B"]["count"] += 1
    c = validate.Checker()
    check_delays(c, build_delays(TS), {"A", "B"}, rows, sums, validate.is_date)
    assert f"delays: trades over {LATE_DAYS} days equals trade_summary.late" in c.errors
    assert "delays: member count equals trade file rows and trade_summary.count" in c.errors
    assert "delays: total count equals the sum of trade_summary.count" in c.errors


def test_band_labels_in_definition() -> None:
    assert DEFINITION["bands"] == list(BAND_LABELS) == ["0-30", "31-45", "46-90", "91-365", "over-365"]
