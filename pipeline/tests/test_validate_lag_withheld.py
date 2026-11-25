"""A null lag with both dates present is valid only when the trade file withholds it for a stated reason
(`lag_withheld[id]`: "date_corrected" or "amended_unmatched") on a trade flagged amended
(pipeline/validate_trade_amendments.py `lag_null_is_valid`, `check_trade_file`).
A wrongly withheld lag (no reason listed, an unknown reason, or no amended flag) fails validation, and so does a
lag published for a trade the file says is withheld."""
from __future__ import annotations

from datetime import date
from typing import Any

from pipeline import validate
from pipeline.assemble.members import trade_file
from pipeline.tests.test_trade_amendments import ev, mapped, versioned
from pipeline.contract import TRADE_COLUMNS


def _file(ts: list[dict[str, Any]]) -> dict[str, Any]:
    return trade_file([{**t, "org": None} for t in sorted(ts, key=lambda t: (t["date"], t["id"]), reverse=True)])


def _errors(tf: dict[str, Any]) -> dict[str, list[str]]:
    c = validate.Checker()
    validate.check_trades(c, tf, "trades/X", set())
    return {k: v for k, v in c.errors.items() if k.startswith(("lag null", "lag_withheld"))}


def _withhold(tf: dict[str, Any], tid: str) -> dict[str, Any]:
    """The same file with the lag of `tid` blanked, as a build that withheld it wrongly would publish it."""
    i = TRADE_COLUMNS.index("lag_days")
    late = TRADE_COLUMNS.index("late")
    rows = [[*r[:i], None, *r[i + 1:late], None, *r[late + 1:]] if r[0] == tid else r for r in tf["rows"]]
    return {**tf, "rows": rows}


def test_a_lag_withheld_for_a_corrected_version_is_valid() -> None:
    moved = versioned("20018011", "20018539", date(2021, 1, 4))
    ts, _ = mapped([moved])
    tf = _file(ts)
    row = dict(zip(TRADE_COLUMNS, tf["rows"][0]))
    assert row["lag_days"] is None and row["date"] and row["available"] and row["amended"] is True
    assert [a["status"] for a in tf["amendments"][row["id"]]] == ["Version"]
    assert _errors(tf) == {}


def test_a_wrongly_withheld_lag_fails() -> None:
    ts, _ = mapped([ev("20015042", 0)])                 # a single, unamended trade with a normal lag
    tf = _withhold(_file(ts), ts[0]["id"])
    assert dict(zip(TRADE_COLUMNS, tf["rows"][0]))["lag_days"] is None
    assert _errors(tf) != {}


def test_a_withheld_lag_needs_a_listed_reason_and_the_amended_flag() -> None:
    ts, _ = mapped([versioned("20018011", "20018539", date(2021, 1, 4))])
    tf = _file(ts)
    tid = ts[0]["id"]
    assert tf["lag_withheld"] == {tid: "date_corrected"}
    assert _errors({**tf, "amendments": {}}) == {}           # the reason is what counts, not the listed filings
    same, _ = mapped([versioned("20018011", "20018011", date(2021, 1, 4))])           # both versions in one filing
    assert _errors(_file(same)) == {}
    assert _errors({**tf, "lag_withheld": {}}) != {}          # no reason listed: wrongly withheld
    assert _errors({**tf, "lag_withheld": {tid: "because"}}) != {}
    i = TRADE_COLUMNS.index("amended")
    assert _errors({**tf, "rows": [[*r[:i], False, *r[i + 1:]] for r in tf["rows"]]}) != {}
    lag = TRADE_COLUMNS.index("lag_days")
    assert _errors({**tf, "rows": [[*r[:lag], 17, *r[lag + 1:]] for r in tf["rows"]]}) != {}   # a lag published for a withheld trade


def test_an_amended_row_without_its_original_is_withheld_not_timed_from_the_amendment() -> None:
    ts, _ = mapped([ev("20016961", 0, "Amended", "2000060675")])
    tf = _file(ts)
    row = dict(zip(TRADE_COLUMNS, tf["rows"][0]))
    assert row["lag_days"] is None and row["late"] is None and row["amended"] is True and row["available"] == "2020-07-20"
    assert tf["lag_withheld"] == {row["id"]: "amended_unmatched"} and _errors(tf) == {}
