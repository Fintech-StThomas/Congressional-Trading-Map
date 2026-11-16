"""Checks for delays.json (data dictionary: "Disclosure timing (`delays.json`)"). Called from validate.py.

Every figure is re-derived from the published trade files (`trades/<id>.json` rows), so the aggregate cannot drift
from what a reader can see. The chamber split cannot be re-derived (published trades carry no chamber); it is checked
for internal consistency against the overall totals.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable

from .assemble.delays import BAND_LABELS, CHAMBERS, DEFINITION, MEMBER_COLS, Acc, rows_from_trade_file
from .config import LATE_DAYS

GROUP_KEYS = {"count", "dated", "bands", "negative", "undated", "amended", "median", "p90", "max"}


def check_group(c: Any, g: Any, where: str) -> None:
    ok = isinstance(g, dict) and set(g) == GROUP_KEYS and isinstance(g["bands"], dict) \
        and list(g["bands"]) == list(BAND_LABELS)
    c.check(ok, "delays: group schema", where)
    if not ok:
        return
    c.check(all(isinstance(g[k], int) and g[k] >= 0 for k in ("count", "dated", "negative", "undated", "amended"))
            and all(isinstance(v, int) and v >= 0 for v in g["bands"].values()), "delays: counts are non-negative integers", where)
    c.check(sum(g["bands"].values()) + g["negative"] + g["undated"] == g["count"], "delays: bands + negative + undated = count", where)
    c.check(g["dated"] == g["count"] - g["undated"] and g["amended"] <= g["count"], "delays: dated and amended consistent", where)
    stats = (g["median"], g["p90"], g["max"])
    none_ok = all(s is None for s in stats) if sum(g["bands"].values()) == 0 else all(isinstance(s, int) and s >= 0 for s in stats)
    c.check(none_ok and (stats[0] is None or stats[0] <= stats[1] <= stats[2]), "delays: median <= p90 <= max, null iff no dated non-negative trade", where)


def add_groups(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {"count": a["count"] + b["count"], "negative": a["negative"] + b["negative"],
            "undated": a["undated"] + b["undated"], "amended": a["amended"] + b["amended"],
            "bands": {k: a["bands"][k] + b["bands"][k] for k in BAND_LABELS}}


def counts_of(g: dict[str, Any]) -> dict[str, Any]:
    return {k: g[k] for k in ("count", "negative", "undated", "amended")} | {"bands": g["bands"]}


def check_delays(c: Any, doc: Any, members: set[str], published: dict[str, list[list[Any]]],
                 summaries: dict[str, dict[str, Any]], is_date: Callable[[Any], bool]) -> None:
    """published: member id -> rows of trades/<id>.json; summaries: member id -> MemberFile.trade_summary."""
    keys = {"definition", "totals", "by_chamber", "by_year", "members"}
    c.check(isinstance(doc, dict) and set(doc) == keys, "delays: schema", "keys")
    if not isinstance(doc, dict) or set(doc) != keys:
        return
    c.check(doc["definition"] == DEFINITION and doc["definition"]["threshold_days"] == LATE_DAYS, "delays: definition is the fixed text", "")
    check_group(c, doc["totals"], "totals")
    c.check(list(doc["by_chamber"]) == list(CHAMBERS), "delays: by_chamber keys", "")
    for ch, g in doc["by_chamber"].items():
        check_group(c, g, f"by_chamber:{ch}")
    if all(isinstance(g, dict) and "bands" in g for g in doc["by_chamber"].values()) and "bands" in doc["totals"]:
        both = add_groups(*[doc["by_chamber"][ch] for ch in CHAMBERS])
        c.check(both == add_groups(counts_of(doc["totals"]), {"count": 0, "negative": 0, "undated": 0, "amended": 0,
                "bands": dict.fromkeys(BAND_LABELS, 0)}), "delays: chambers sum to totals", "")
    years = doc["by_year"]
    c.check(list(years) == sorted(years) and all(y == "none" or (y.isdigit() and len(y) == 4) for y in years), "delays: by_year keys", "")
    for y, g in years.items():
        check_group(c, g, f"by_year:{y}")
    tbl = doc["members"]
    c.check(isinstance(tbl, dict) and set(tbl) == {"cols", "rows"} and tbl["cols"] == MEMBER_COLS, "delays: members table schema", "")
    if not (isinstance(tbl, dict) and tbl.get("cols") == MEMBER_COLS):
        return
    rows = tbl["rows"]
    ids = [r[0] for r in rows]
    c.check(all(len(r) == len(MEMBER_COLS) for r in rows), "delays: members row width", "")
    c.check(ids == sorted(ids) and len(set(ids)) == len(ids), "delays: member rows sorted and unique", "")
    c.check(all(m in members for m in ids), "delays: every member id exists in members.json", str([m for m in ids if m not in members][:3]))
    c.check(set(ids) == {m for m, r in published.items() if r}, "delays: one row per member with published trades", "")
    pooled, by_year = Acc(), defaultdict(Acc)
    sums = defaultdict(int)
    for r in rows:
        row = dict(zip(MEMBER_COLS, r))
        mid = row["id"]
        pub = rows_from_trade_file(mid, published.get(mid, []))
        acc = Acc()
        for t in pub:
            acc.add(t)
            pooled.add(t)
            by_year[str(t["date"])[:4] if t["date"] else "none"].add(t)
        c.check(r == acc.row(mid), "delays: member row equals the one re-derived from trades/<id>.json", mid)
        c.check(row["count"] == len(pub) == summaries.get(mid, {}).get("count"), "delays: member count equals trade file rows and trade_summary.count", mid)
        c.check(sum(row[k] for k in MEMBER_COLS[3:8]) + row["negative"] + row["undated"] == row["count"], "delays: bands + negative + undated = count", mid)
        over = sum(row[k] for k in MEMBER_COLS[5:8])
        c.check(over == summaries.get(mid, {}).get("late"), f"delays: trades over {LATE_DAYS} days equals trade_summary.late", mid)
        fy, ly = row["first_year"], row["last_year"]
        c.check((fy is None) == (ly is None) and (fy is None or fy <= ly), "delays: first_year <= last_year", mid)
        for k in ("count", "negative", "undated", "amended"):
            sums[k] += row[k]
        for i, label in enumerate(BAND_LABELS):
            sums[label] += row[MEMBER_COLS[3 + i]]
    t = doc["totals"]
    if isinstance(t, dict) and "bands" in t:
        c.check({k: sums[k] for k in ("count", "negative", "undated", "amended")} == {k: t[k] for k in ("count", "negative", "undated", "amended")}
                and {k: sums[k] for k in BAND_LABELS} == t["bands"], "delays: totals equal the sum of member rows", "")
        c.check(t == {**pooled.group()}, "delays: totals equal the figures re-derived from published trade files", "")
        c.check(t["count"] == sum(s["count"] for s in summaries.values()), "delays: total count equals the sum of trade_summary.count", "")
        c.check(sum(g["count"] for g in years.values() if isinstance(g, dict) and "count" in g) == t["count"], "delays: by_year counts sum to totals", "")
    for y, g in years.items():
        c.check(g == by_year[y].group() if y in by_year else False, "delays: by_year group equals the figures re-derived from published trade files", y)
    c.check(set(years) == set(by_year), "delays: by_year keys equal the years present", "")
