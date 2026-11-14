"""The assembler's rules (pipeline/assemble/): cases, publication budget and ledgers, party split, wall-years, and
the two-pass evidence loading."""
from __future__ import annotations

import json
from collections import Counter

from pipeline import assemble
from pipeline.assemble import plugins
from pipeline.config import FORMER_MEMBER_LEDGER_ROWS, MONEY_EDGES_PER_MEMBER, MONEY_MEMBERS_PER_ORG
from pipeline.edges import edge_id, make_edge, node

EV = [{"label": "x", "date": "2020-01-01", "url": None, "source": "s", "record": None}]


def edge(type_: str, frm: tuple[str, str], to: tuple[str, str], first: str, last: str, exact: float | None = None,
         count: int = 1, note: str | None = None, basis: str = "filed") -> dict:
    e = make_edge(type_, node(*frm), node(*to), directed=True, basis=basis,
                  years=[{"y": int(first[:4]), "n": count, "low": exact, "high": exact, "exact": exact}], first=first,
                  last=last, evidence=EV, evidence_total=1, note=note,
                  stat={"observed": 5, "expected": 1, "lift": 5, "method": "m"} if basis == "derived" else None)
    e["id"] = edge_id(e["type"], e["from"], e["to"], e["via"])
    return e


M, O = ("member", "A000001"), ("org", "co:1")


# ---------------------------------------------------------------- cases
def test_case_needs_holding_plus_money_or_people_overlapping() -> None:
    traded = edge("traded", M, O, "2018-01-01", "2022-01-01")
    pac = edge("pac_money", O, M, "2020-01-01", "2021-01-01", 5000)
    cases = assemble.find_cases([traded, pac])
    assert len(cases) == 1 and cases[0]["years"] == [2020, 2021] and cases[0]["types"] == ["pac_money", "traded"]
    assert cases[0]["score"] == 2 and cases[0]["money"] == 5000
    assert assemble.find_cases([traded, edge("pac_money", O, M, "2023-01-01", "2024-01-01", 1)]) == []  # no overlap
    assert assemble.find_cases([pac, edge("employee_money", O, M, "2020-01-01", "2021-01-01", 1)]) == []  # no holding
    assert assemble.find_cases([traded, edge("oversees", M, O, "2020-01-01", "2021-01-01")]) == []  # context never counts


def test_case_window_is_the_year_with_most_active_types() -> None:
    traded = edge("traded", M, O, "2010-01-01", "2022-01-01")
    owns = edge("owns", M, O, "2015-01-01", "2016-01-01")
    pac = edge("pac_money", O, M, "2012-01-01", "2020-01-01", 10)
    (case,) = assemble.find_cases([traded, owns, pac])
    assert case["types"] == ["owns", "pac_money", "traded"] and case["years"] == [2015, 2016] and case["score"] == 3


def test_case_ranking_types_then_money_then_trades() -> None:
    a = [edge("traded", M, ("org", "co:a"), "2020-01-01", "2020-01-01", count=9),
         edge("pac_money", ("org", "co:a"), M, "2020-01-01", "2020-01-01", 100)]
    b = [edge("traded", M, ("org", "co:b"), "2020-01-01", "2020-01-01", count=1),
         edge("pac_money", ("org", "co:b"), M, "2020-01-01", "2020-01-01", 900)]
    assert [c["org"] for c in assemble.find_cases(a + b)] == ["co:b", "co:a"]


# ---------------------------------------------------------------- publication budget and ledgers
def test_member_budget_keeps_largest_money_edges_case_edges_and_all_others() -> None:
    money = [edge("pac_money", ("org", f"pac:C{i:08d}"), M, "2020-01-01", "2020-01-01", float(i)) for i in range(1, 40)]
    traded = edge("traded", M, ("org", "co:1"), "2020-01-01", "2020-01-01")
    sits = edge("sits_with", M, ("member", "B000001"), "2020-01-01", "2020-01-01")
    small_case_edge = money[0]
    full, rest, context = assemble.split_member_edges(M[1], money + [traded, sits], {small_case_edge["id"]})
    assert context == [sits] and sits not in full
    assert traded in full and small_case_edge in full
    assert len(full) == MONEY_EDGES_PER_MEMBER + 2
    size = assemble.edge_size
    assert min(size(e) for e in full if e["type"] == "pac_money" and e is not small_case_edge) > max(size(e) for e in rest)
    assert [size(e) for e in rest] == sorted((size(e) for e in rest), reverse=True)


def test_ledger_totals_cover_every_hidden_tie() -> None:
    es = [edge("pac_money", ("org", f"pac:C{i:08d}"), M, "2020-01-01", "2020-01-01", 10.0, count=2) for i in range(3)]
    assert assemble.ledger_totals(es) == {"pac_money": {"edges": 3, "records": 6, "low": 30.0, "high": 30.0, "exact": 30.0}}


def test_member_ledger_direction() -> None:
    out = edge("funds", M, ("member", "B000001"), "2020-01-01", "2020-01-01", 5.0)
    rows = assemble.member_ledger(M[1], [out])["rows"]
    assert rows[0][1:3] == ["member", "B000001"] and rows[0][-1] == "out" and rows[0][4] == 5
    assert assemble.member_ledger("B000001", [out])["rows"][0][-1] == "in"


def test_org_ties_list_top_members_and_put_the_rest_in_totals() -> None:
    es = [edge("pac_money", O, ("member", f"M{i:06d}"), "2020-01-01", "2020-01-01", float(i + 1))
          for i in range(MONEY_MEMBERS_PER_ORG + 5)]
    es.append(edge("traded", ("member", "M000000"), O, "2020-01-01", "2020-01-01"))
    ties, rest = assemble.org_ties(es, {("M000204", es[204]["id"])})
    assert len(ties["rows"]) == MONEY_MEMBERS_PER_ORG + 1 and len(rest) == 5   # every non-money tie is listed
    assert max(assemble.edge_size(e) for e in rest) < min(r[2] for r in ties["rows"] if r[0] == "pac_money")
    assert ties["rows"][0][8] == es[204]["id"] and ties["rows"][1][8] is None   # edge id only when full in that file


def test_former_member_ledger_cap_constant_is_echoed() -> None:
    from pipeline.assemble.run import publication_budget
    b = publication_budget()
    assert b["former_member_ledger_rows"] == FORMER_MEMBER_LEDGER_ROWS and b["money_edges_per_member"] == MONEY_EDGES_PER_MEMBER


# ---------------------------------------------------------------- party split and org index
def test_party_split_counts_members_once_per_measure_under_latest_party() -> None:
    a, b = ("member", "A000001"), ("member", "B000001")
    es = [edge("pac_money", O, a, "2010-01-01", "2010-01-01", 100.0), edge("pac_money", O, a, "2012-01-01", "2012-01-01", 50.0),
          edge("pac_money", O, b, "2020-01-01", "2020-01-01", 7.5),
          edge("outside_spending", O, b, "2020-01-01", "2020-01-01", 3.0, note="oppose"),
          edge("traded", a, O, "2020-01-01", "2020-01-01")]
    # the two pac_money edges to A have distinct ids only through via in real data; here type/from/to repeat,
    # which is fine for the split (it counts distinct members)
    split = assemble.party_split(es, {"A000001": "R", "B000001": "D"})
    assert split["given"] == {"D": [1, 7.5], "I": [0, 0], "R": [1, 150]}
    assert split["oppose"]["D"] == [1, 3] and "support" not in split
    assert split["traded"]["R"] == [1, None]


def test_shard_is_stable() -> None:
    assert assemble.shard("co:320193") == assemble.shard("co:320193") and len(assemble.shard("x")) == 2


# ---------------------------------------------------------------- wall-years and coverage
def test_served_years_skip_the_january_3_end_year() -> None:
    assert assemble.served_years({"start": "2019-01-03", "end": "2021-01-03"}) == (2019, 2020)
    assert assemble.served_years({"start": "2019-01-03", "end": "2020-06-30"}) == (2019, 2020)


def test_merged_terms_keep_each_terms_party() -> None:
    t = lambda s, e, p, ch="rep": {"start": s, "end": e, "party": p, "chamber": ch, "state": "NJ", "district": 2}
    terms = [t("2019-01-03", "2021-01-03", "D"), t("2021-01-03", "2023-01-03", "R"), t("2023-01-03", "2025-01-03", "R"),
             t("1995-01-03", "1997-01-03", "D")]
    assert assemble.merged_terms(terms) == [[2019, 2020, "rep", "D", "NJ"], [2021, 2024, "rep", "R", "NJ"]]


def test_wall_years_sum_to_wall_totals() -> None:
    m = {"terms": [{"start": "2019-01-03", "end": "2023-01-03", "party": "D", "chamber": "rep", "state": "NJ", "district": 2}]}
    pac = make_edge("pac_money", node(*O), node(*M), directed=True, basis="filed", first="2019-01-01", last="2020-01-01",
                    years=[{"y": 2019, "n": 1, "low": 10, "high": 10, "exact": 10}, {"y": 2020, "n": 2, "low": 5, "high": 5, "exact": 5}],
                    evidence=EV, evidence_total=3)
    pac["id"] = "x"
    wy = assemble.wall_years({M[1]: m}, {M[1]: [pac]}, {M[1]: [{"years": [2020, 2021]}]}, {}, 2026, {"rep": 2014, "sen": 2012})
    row = dict(zip(wy["cols"], wy["rows"][0]))
    assert row["pac"] == [2019, 10, 2020, 5] and row["cases"] == [2020, 1, 2021, 1] and row["trades"] == []
    summary = {M[1]: {"name": "n", "last": "l", "party": "D", "state": "NJ", "chamber": "rep", "district": 2, "current": True,
                      "photo": False, "counts": {"cases": 1, "trades": 0, "orgs": 1}}}
    wall = dict(zip(assemble.WALL_COLS, assemble.wall_rows(summary, {M[1]: [pac]})["rows"][0]))
    assert wall["pac"] == sum(row["pac"][1::2])


def test_trade_coverage_levels() -> None:
    cov = {"rep": {"first_filing": "2014-01-02"}, "sen": {"first_filing": "2012-07-25"}}
    assert assemble.trade_coverage({"rep"}, 2011, cov, set(), 2026) == "n/a"
    assert assemble.trade_coverage({"rep"}, 2013, cov, set(), 2026) == "none"
    assert assemble.trade_coverage({"sen"}, 2012, cov, set(), 2026) == "partial"
    assert assemble.trade_coverage({"rep"}, 2018, cov, {2018}, 2026) == "partial"
    assert assemble.trade_coverage({"rep", "sen"}, 2013, cov, set(), 2026) == "none"   # the weaker chamber wins
    assert assemble.trade_coverage({"rep"}, 2026, cov, set(), 2026) == "partial"


# ---------------------------------------------------------------- plug-in loading
def test_two_pass_evidence_equals_one_pass(tmp_path, monkeypatch) -> None:
    edges_dir = tmp_path / "edges"
    edges_dir.mkdir()
    a = edge("pac_money", O, M, "2020-01-01", "2020-01-01", 5.0)
    b = {**edge("pac_money", O, M, "2021-01-01", "2021-01-01", 7.0),
         "evidence": [{**EV[0], "date": "2021-02-02", "label": "later"}]}
    bad = {**edge("pac_money", O, M, "2022-01-01", "2022-01-01", 1.0), "evidence": [{**EV[0], "source": "unlisted"}]}
    other = edge("traded", M, ("org", "co:2"), "2020-01-01", "2020-01-01")
    for name, rows in (("a.jsonl", [a, other]), ("b.jsonl", [b, bad])):
        (edges_dir / name).write_text("".join(json.dumps({k: v for k, v in r.items() if k != "id"}) + "\n" for r in rows))
    monkeypatch.setattr(plugins, "EDGES_DIR", edges_dir)
    orgs = {"co:1": {}, "co:2": {}}
    one, rep = plugins.load_edges({M[1]}, orgs, {"s"})
    two, _ = plugins.load_edges({M[1]}, orgs, {"s"}, slim=True)
    assert all(e["evidence"] == [] for e in two)
    plugins.attach_evidence(two, {e["id"] for e in two}, {M[1]}, orgs, {"s"})
    assert one == two and len(one) == 2
    merged = next(e for e in one if e["type"] == "pac_money")
    assert merged["count"] == 2 and merged["amount"]["exact"] == 12.0 and merged["evidence"][0]["label"] == "later"
    assert sum(rep["edges_dropped"].values()) == 1 and Counter(rep["edges_read"]) == Counter({"a.jsonl": 2, "b.jsonl": 2})
