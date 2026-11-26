"""The "expected by chance" figures of the review flags (pipeline/assemble/flags_chance.py), their place in flags.json
and meta.json (flags_out.py), and their re-derivation in pipeline/validate_flags.py."""
from __future__ import annotations

from datetime import date
from math import exp
from typing import Any

import pytest

from pipeline.assemble.flags_chance import DESCRIPTIVE, baseline, pile_on_chance, poisson_at_least
from pipeline.assemble.flags_out import baselines, flags_file, flags_meta
from pipeline.assemble.members import trade_file
from pipeline.tests.test_flags import MEMBERS, build
from pipeline.validate_flags import check_baselines, derive_pile_on


def test_poisson_tail_and_pile_on_bar() -> None:
    assert poisson_at_least(1.0, 2) == pytest.approx(1 - 2 * exp(-1))
    assert poisson_at_least(0.5, 0) == 1.0
    lam = 2 * 15 / 365
    assert pile_on_chance(lam) == pytest.approx(poisson_at_least(lam, 2))       # bar is 2 while 3 x expected < 2
    assert pile_on_chance(1.5) == pytest.approx(poisson_at_least(1.5, 5))       # 3 x 1.5 = 4.5: at least 5


def test_baseline_blocks() -> None:
    assert baseline("late", 10, None) == {"kind": "descriptive", "expected_met": None, "expected_share": None,
                                          "method": baseline("late", 0, None)["method"]}
    b = baseline("pile_on", 200, 10.04)
    assert b["kind"] == "chance" and b["expected_met"] == 10.0 and b["expected_share"] == 0.0502
    assert baseline("pile_on", 0, 0.0)["expected_share"] is None
    assert baseline("pile_on", 1, None)["expected_met"] is None


def test_flags_json_and_meta_carry_baselines_and_validator_agrees() -> None:
    ts, rv = build()
    doc, meta = flags_file(rv, date(2026, 11, 25), 2), {"flags": flags_meta(rv)}
    base = {r["id"]: r["baseline"] for r in doc["rules"]}
    assert base == meta["flags"]["baselines"] == baselines(rv)
    assert all(base[r]["kind"] == "descriptive" for r in DESCRIPTIVE)
    assert base["pile_on"]["observed_others_sum"] == rv.chance["pile_on"]["observed_sum"] >= 2
    files = {m: {**trade_file([t for t in ts if t["member"] == m]), **rv.trade_fields(m)} for m in MEMBERS}
    assert set(base) == set(DESCRIPTIVE) | {"pile_on"} and set(rv.chance) == {"pile_on"}
    _, _, sums = derive_pile_on(files, {})
    assert sums["expected_met"] == pytest.approx(rv.chance["pile_on"]["expected_met"])
    chance = {"pile_on": {**sums, "expected_others_sum": sums["expected_sum"], "observed_others_sum": sums["observed_sum"]}}
    errs: list[str] = []
    checker: Any = type("C", (), {"check": lambda self, ok, rule, d: errs.append(rule) if not ok else None})()
    check_baselines(checker, doc, meta, chance)
    assert errs == []
    bad = {"pile_on": {**chance["pile_on"], "expected_met": sums["expected_met"] + 5}}
    check_baselines(checker, doc, meta, bad)
    assert errs == ["flags: chance baseline re-derived"]
