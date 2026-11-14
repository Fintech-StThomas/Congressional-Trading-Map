"""Range arithmetic, by-year aggregation, evidence ranking and edge ids (pipeline/edges.py)."""
from __future__ import annotations

from pipeline.edges import by_year, edge_id, make_edge, node, sum_amounts, top_evidence

R = lambda low, high, exact=None: {"low": low, "high": high, "exact": exact}  # noqa: E731


def test_missing_amount_is_unknown_not_zero() -> None:
    assert sum_amounts([R(1001, 15000), R(None, None)]) == R(1001, None)
    assert sum_amounts([R(None, None)]) == R(None, None)
    assert sum_amounts([]) == R(None, None)


def test_open_ended_band_keeps_its_low_and_nulls_the_high() -> None:
    # "over $1,000,000": low known, no upper bound
    assert sum_amounts([R(1_000_001, None), R(1001, 15000)]) == R(1_001_002, None)


def test_exact_sums_and_refunds_net() -> None:
    assert sum_amounts([R(500, 500, 500), R(-200, -200, -200)]) == R(300, 300, 300)
    assert sum_amounts([R(0.1, 0.1, 0.1), R(0.2, 0.2, 0.2)]) == R(0.3, 0.3, 0.3)   # rounded to cents


def test_by_year_groups_sorts_and_sums_to_totals() -> None:
    years = by_year([(2021, 1, R(5, None)), (2020, 1, R(1, 2)), (2020, 1, R(3, 4))])
    assert years == [{"y": 2020, "n": 2, **R(4, 6)}, {"y": 2021, "n": 1, **R(5, None)}]
    assert sum_amounts(years) == sum_amounts([R(5, None), R(1, 2), R(3, 4)]) == R(9, None)


def test_undirected_edges_are_ordered_and_ids_stable() -> None:
    ev = [{"label": "x", "date": "2020-01-01", "url": None, "source": "s", "record": None}]
    e = make_edge("traded_together", node("member", "Z000001"), node("member", "A000001"), directed=False, basis="derived",
                  years=[{"y": 2020, "n": 5, **R(None, None)}], first="2020-01-01", last="2020-01-01", evidence=ev,
                  evidence_total=1, stat={"observed": 5, "expected": 1, "lift": 5, "p": 0.01, "method": "m"})
    assert e["from"]["id"] == "A000001" and e["count"] == 5 and e["family"] == "holding"
    assert edge_id("traded", node("member", "A"), node("org", "co:1")) == edge_id("traded", node("member", "A"), node("org", "co:1"))
    assert edge_id("x", node("member", "A"), node("org", "B"), {"id": "v"}) != edge_id("x", node("member", "A"), node("org", "B"))


def test_top_evidence_largest_then_latest() -> None:
    items = [{"label": str(i), "date": d, "url": None, "source": "s", "record": str(i), "_size": s}
             for i, (d, s) in enumerate([("2020-01-01", 10), ("2021-01-01", 10), ("2019-01-01", 99), (None, None)])]
    assert [e["label"] for e in top_evidence(items)] == ["2", "1", "0", "3"]
    assert "_size" not in top_evidence(items)[0]
    assert len(top_evidence(items * 3)) == 5
