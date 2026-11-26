"""The review-flag validator's own re-derivations (pipeline/validate_flags_derive.py) for money_both_ways and
sector_overseen: full edges and ledger-only ties, recomputed edge ids, ledger rows whose dates straddle the cycle,
trimmed ledgers, not-evaluated counts, prefix matching and the pooled-vehicle exclusion."""
from __future__ import annotations

from typing import Any

from pipeline.edges import edge_id
from pipeline.validate_flags import money_ok
from pipeline.validate_flags_derive import derive_money, derive_sector

M = "A000001"
COLS = ["type", "kind", "other", "via", "exact", "low", "high", "count", "first", "last", "note", "dir"]


def row(tid: str, d: str | None = "2025-10-30", org: str | None = "co:1", cls: str = "stock") -> dict[str, Any]:
    return {"id": tid, "date": d, "org": org, "asset_class": cls}


def mf(edges: list[dict[str, Any]] = (), ledger: list[list[Any]] = (), *, fec: bool = True, current: bool = True,
       totals: int | None = None, committees: tuple[str, ...] = ("cmte:HSBA",)) -> dict[str, Any]:
    n = sum(1 for r in ledger if r[0] == "pac_money")
    return {"member": {"id": M, "current": current, "fec_ids": ["H0"] if fec else [], "committees": [{"id": c} for c in committees]},
            "edges": list(edges), "ledger": {"cols": COLS, "rows": list(ledger)},
            "ledger_totals": {"pac_money": {"edges": n if totals is None else totals}}}


def ledger(org: str = "co:1", first: str = "2026-08-19", last: str = "2026-08-19", amount: float = 5000) -> list[Any]:
    return ["pac_money", "org", org, "pac:C1", amount, amount, amount, 1, first, last, None, "in"]


LEDGER_ID = edge_id("pac_money", {"id": "co:1"}, {"id": M}, {"id": "pac:C1"})  # type: ignore[arg-type]


def checker() -> tuple[Any, list[str]]:
    errs: list[str] = []
    return type("C", (), {"check": lambda self, ok, rule, d: errs.append(f"{rule} {d}") if not ok else None})(), errs


def test_ledger_only_tie_is_met_and_its_recomputed_id_is_the_named_edge() -> None:
    f = mf(ledger=[ledger()])
    met, ne, unsure = derive_money(M, [row("t")], f)
    assert met == {"t": LEDGER_ID} and ne == 0 and unsure == 0
    c, errs = checker()
    money_ok(c, M, [row("t")], {"t": LEDGER_ID}, met, f)
    assert errs == []
    money_ok(c, M, [row("t")], {"t": "000000000000"}, met, f)                # a wrong id fails both checks
    assert len(errs) == 2


def test_full_edge_by_year_and_cycle_boundary() -> None:
    e = {"id": "e1", "type": "pac_money", "from": {"id": "co:1"}, "to": {"id": M},
         "by_year": [{"y": 2024, "n": 1, "low": 9, "high": 9, "exact": 9}]}
    met, _, _ = derive_money(M, [row("a", "2024-03-01"), row("b", "2025-03-01")], mf([e]))
    assert met == {"a": "e1"}                                                 # 2025 is the 2026 cycle
    c, errs = checker()
    money_ok(c, M, [row("b", "2025-03-01")], {"b": "e1"}, {}, mf([e]))        # flagged with no record in the cycle
    assert len(errs) == 2


def test_straddling_ledger_row_and_trimmed_ledger_are_undetermined() -> None:
    straddle = mf(ledger=[ledger(first="2024-02-01", last="2026-03-01")])
    met, _, unsure = derive_money(M, [row("t")], straddle)
    assert unsure == 1 and met["t"] == {LEDGER_ID, None}
    c, errs = checker()
    money_ok(c, M, [row("t")], {}, met, straddle)                            # not met is accepted
    money_ok(c, M, [row("t")], {"t": LEDGER_ID}, met, straddle)              # and so is met with that tie
    assert errs == []
    trimmed = mf(current=False, totals=5)
    met, _, unsure = derive_money(M, [row("t")], trimmed)
    assert unsure == 1
    money_ok(c, M, [row("t")], {"t": "abcdefabcdef"}, met, trimmed)          # the tie may be unpublished
    assert errs == []


def test_money_not_evaluated_counts() -> None:
    rows = [row("a", None), row("b", org="tk:ZZ"), row("c", org=None), row("d")]
    assert derive_money(M, rows, mf())[1] == 3
    assert derive_money(M, rows, mf(fec=False))[1] == 4
    assert derive_money(M, [row("x", "2023-01-01")], mf(ledger=[ledger()]))[0] == {}   # 2026 money, 2024 cycle


def test_sector_rederivation_prefixes_and_pooled_vehicle() -> None:
    table = {"HSBA": (("60", "6798"), ()), "HSAG": (("20",), ("208",))}
    full = {"HSBA", "HSAG"}
    cos = {"co:1": {"sic": 6022}, "co:2": {"sic": 6798}, "co:3": {"sic": 6799}, "co:4": {"sic": 6022, "pooled_vehicle": True},
           "co:5": {"sic": 2086}, "co:6": {"sic": None}}
    rows = [row(f"t{i}", org=f"co:{i}") for i in range(1, 7)] + [row("early", "2025-01-02"), row("fund", cls="fund")]
    met, ne = derive_sector(rows, mf(committees=("cmte:HSBA", "cmte:HSAG", "cmte:HSBA01")), cos, full, table)
    assert met == {"t1": "cmte:HSBA", "t2": "cmte:HSBA"}
    assert "t4" not in met and "t5" not in met and "t3" not in met
    assert ne == 4                                                            # pooled, no SIC, before 2025-01-03, fund
    assert derive_sector(rows, mf(current=False), cos, full, table) == ({}, len(rows))
