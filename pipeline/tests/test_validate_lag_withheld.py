"""A null lag with both dates present is valid only for a trade a later dataset version corrected: flagged amended and
either a later version (version > 1) or listing a later filing in its trade file's `amendments`
(pipeline/validate_trade_amendments.py `lag_null_is_valid`).
A wrongly withheld lag (no version, or no amended flag) fails validation."""
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
    return {k: v for k, v in c.errors.items() if k.startswith("lag null")}


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


def test_a_withheld_lag_needs_the_amended_flag_and_a_later_version_or_filing() -> None:
    ts, _ = mapped([versioned("20018011", "20018539", date(2021, 1, 4))])
    tf = _file(ts)
    tid = ts[0]["id"]
    assert _errors({**tf, "amendments": {}}) == {}           # versions in one filing list no Version entry: still valid
    assert _errors({**tf, "amendments": {tid: [{**tf["amendments"][tid][0], "status": "Amended"}]}}) == {}  # folded printing
    same, _ = mapped([versioned("20018011", "20018011", date(2021, 1, 4))])           # both versions in one filing
    assert _errors(_file(same)) == {}
    v = TRADE_COLUMNS.index("version")
    first = {**tf, "amendments": {}, "rows": [[*r[:v], 1, *r[v + 1:]] for r in tf["rows"]]}
    assert _errors(first) != {}                               # amended but version 1 with nothing listed: wrongly withheld
    i = TRADE_COLUMNS.index("amended")
    unflagged = {**tf, "rows": [[*r[:i], False, *r[i + 1:]] for r in tf["rows"]]}
    assert _errors(unflagged) != {}
