"""The member wall: `wall.json` (all-time figures per member) and `wall-years.json` (the same figures per calendar
year, so the site can redraw the wall for any year). Data dictionary: "Wall", "WallYears", "Coverage".

Reads member summaries, member edges, cases and trades from the orchestrator; writes nothing itself.
Money figures count only ties *received* by the member (`to` is the member): pac_money -> pac, outside_spending
support/oppose -> support/oppose. Per-year values come from each edge's by_year (exact, else high, else low), so
they sum to the all-time value; the validator checks this.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from ..config import STOCK_ACT_YEAR, WALL_YEAR_MIN
from ..contract import WALL_COLS, WALL_YEARS_COLS, Case, Edge, SpineMember, Term, Trade
from .budget import edge_size, num


def wall_rows(summaries: dict[str, dict[str, Any]], member_edges: dict[str, list[Edge]]) -> dict[str, Any]:
    rows = []
    for mid in sorted(summaries):
        s = summaries[mid]
        got: Counter[str] = Counter()
        for e in member_edges.get(mid, []):
            if e["to"]["id"] != mid:
                continue
            if e["type"] == "pac_money":
                got["pac"] += edge_size(e)
            elif e["type"] == "outside_spending" and e["note"] in ("support", "oppose"):
                got[e["note"]] += edge_size(e)
        rows.append([mid, s["name"], s["last"], s["party"], s["state"], s["chamber"], s["district"], int(s["current"]),
                     int(s["photo"]), s["counts"]["cases"], s["counts"]["trades"], num(float(got["pac"])),
                     num(float(got["support"])), num(float(got["oppose"])), s["counts"]["orgs"]])
    return {"cols": WALL_COLS, "rows": rows}


def served_years(t: Term) -> tuple[int, int]:
    """Calendar years a term covers under the coverage rule (a term ending on 3 January does not count that year)."""
    end_y = int(t["end"][:4])
    return int(t["start"][:4]), end_y if t["end"] > f"{end_y}-01-03" else end_y - 1


def merged_terms(terms: list[Term]) -> list[list[Any]]:
    """[start year, end year, chamber, party, state] runs, clipped to WALL_YEAR_MIN; consecutive terms with the same
    chamber, party and state are merged. Party and chamber come from each term, not the latest one."""
    out: list[list[Any]] = []
    for t in sorted(terms, key=lambda t: t["start"]):
        a, b = served_years(t)
        if b < max(a, WALL_YEAR_MIN):
            continue
        a = max(a, WALL_YEAR_MIN)
        last = out[-1] if out else None
        if last and last[2:] == [t["chamber"], t["party"], t["state"]] and a <= last[1] + 1:
            last[1] = max(last[1], b)
        else:
            out.append([a, b, t["chamber"], t["party"], t["state"]])
    return out


def flat(c: Counter[int]) -> list[int]:
    """Sparse [year, value, year, value, ...] with zero (after rounding) years left out."""
    return [v for y in sorted(c) if round(c[y]) for v in (y, int(round(c[y])))]


def wall_years(spine: dict[str, SpineMember], member_edges: dict[str, list[Edge]],
               member_cases: dict[str, list[Case]], trades: dict[str, list[Trade]],
               this_year: int, trade_first: dict[str, int]) -> dict[str, Any]:
    """Per member: merged terms and sparse per-year arrays for cases active, household trades (record date: the
    transaction date, else the availability date), PAC dollars received and outside spending against."""
    rows = []
    for mid in sorted(spine):
        cases: Counter[int] = Counter()
        for c in member_cases.get(mid, []):
            for y in range(c["years"][0], c["years"][1] + 1):
                cases[y] += 1
        tr: Counter[int] = Counter()
        for t in trades.get(mid, []):
            d = t["date"] or t["available"]
            if d:
                tr[d.year] += 1
        pac: Counter[int] = Counter()
        opp: Counter[int] = Counter()
        for e in member_edges.get(mid, []):
            if e["to"]["id"] != mid:
                continue
            into = pac if e["type"] == "pac_money" else opp if e["type"] == "outside_spending" and e["note"] == "oppose" else None
            if into is not None:
                for b in e["by_year"]:
                    into[b["y"]] += b["exact"] or b["high"] or b["low"] or 0
        rows.append([mid, merged_terms(spine[mid]["terms"]), flat(cases), flat(tr), flat(pac), flat(opp)])
    return {"years": [WALL_YEAR_MIN, this_year], "cols": WALL_YEARS_COLS, "rows": rows,
            "first": {"trades": trade_first, "cases": STOCK_ACT_YEAR, "money": WALL_YEAR_MIN - 1}}
