"""`traded` (member -> org) and `traded_together` (member <-> member) edges from trades.

Writes pipeline/build/trades_resolved.parquet (trades with org ids), pipeline/build/edges/trades.jsonl
and pipeline/build/orgs/trades.jsonl.
"""
from __future__ import annotations

import random
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .edges import by_year, make_edge, node, top_evidence
from .trades import SOURCE_ID
from .util import BUILD, EDGES_DIR, ORGS_DIR, print_table, read_json, write_jsonl, write_source_meta

WINDOW_DAYS = 7
MIN_TICKERS, MIN_OCCASIONS = 3, 5
MIN_OBSERVED, MIN_LIFT = 5, 3.0
SHUFFLES, SEED = 200, 20260101
WEAK_P = 0.05  # passing pairs above this permutation p-value, or on fewer than MIN_TICKERS tickers, are drawn weak
EXCLUDED_CLASSES = ("fund", "bond", "unknown")
EPOCH = date(2000, 1, 1)
OWNER_WORD = {"self": "Member", "spouse": "Spouse", "joint": "Joint", "dependent": "Dependent", "unspecified": "Owner not stated"}
ACTION_WORD = {"buy": "bought", "sell": "sold", "exchange": "exchanged", "other": "reported"}


def money(x: float | None) -> str:
    return "?" if x is None else f"${x:,.0f}"


def trade_label(t: dict[str, Any]) -> str:
    rng = f"{money(t['low'])}–{money(t['high'])}" if t["high"] is not None else (
        f"over {money(t['low'])}" if t["low"] is not None else "amount not stated")
    when = "" if t["date"] else " (date not stated)"
    return f"{OWNER_WORD[t['owner']]} {ACTION_WORD[t['action']]} {rng}{when}"


def record_date(t: dict[str, Any]) -> date:
    """Transaction date; the public-availability date stands in when the filing gives none."""
    return t["date"] or t["available"]


def resolve(trades: list[dict[str, Any]], ticker_orgs: dict[str, str]) -> list[dict[str, Any]]:
    out = [{**t, "org": ticker_orgs.get(t["ticker"]) if t["ticker"] else None} for t in trades]
    if len(out) != len(trades):
        raise AssertionError("org resolution changed the trade count")
    missing = [t["ticker"] for t in out if t["ticker"] and t["org"] is None]
    if missing:
        raise AssertionError(f"{len(missing)} tickers absent from ticker_orgs.json, rerun companies")
    return out


def traded_edges(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for t in trades:
        if t["org"]:
            groups[(t["member"], t["org"])].append(t)
    edges = []
    for (member, org), ts in sorted(groups.items()):
        dates = [record_date(t) for t in ts]
        owners = Counter(t["owner"] for t in ts)
        incomplete = sum(t["date"] is None or t["high"] is None for t in ts)
        note = "owners: " + ", ".join(f"{k} {v}" for k, v in sorted(owners.items()))
        if incomplete:
            note += f"; {incomplete} with a missing date or open/missing amount"
        evidence = top_evidence([{"label": trade_label(t), "date": t["date"].isoformat() if t["date"] else None,
                                  "url": t["url"], "source": SOURCE_ID, "record": t["id"],
                                  "_size": t["high"] or t["low"]} for t in ts])
        edges.append(make_edge(
            "traded", node("member", member), node("org", org), directed=True, basis="filed",
            years=by_year((record_date(t).year, 1, {"low": t["low"], "high": t["high"], "exact": None}) for t in ts),
            first=min(dates).isoformat(), last=max(dates).isoformat(), evidence=evidence, evidence_total=len(ts),
            weak=incomplete > 0, note=note))
    return edges


def eligible(t: dict[str, Any], companies: dict[str, dict[str, Any]]) -> bool:
    """Dated buys and sells with a ticker, outside EXCLUDED_CLASSES. A row whose filing gives no asset
    type ("unknown", most House rows) counts only when its ticker resolves to an SEC operating company:
    one with a SIC code in the Financial Statement Data Sets that is not a pooled vehicle."""
    if not t["ticker"] or t["date"] is None or t["action"] not in ("buy", "sell"):
        return False
    if t["asset_class"] == "unknown":
        c = companies.get(t["org"] or "")
        return bool(c and c["sic"] and not c["pooled_vehicle"])
    return t["asset_class"] not in EXCLUDED_CLASSES


# Week buckets make the band join an equi-join: days within WINDOW_DAYS are at most one bucket apart.
PAIR_JOIN = f"""from {{t}} a
        join (select *, unnest([-1, 0, 1]) as off from {{t}}) b
          on {{p}}a.org = b.org and a.action = b.action and a.day // {WINDOW_DAYS} = b.day // {WINDOW_DAYS} + b.off
        where a.member < b.member and abs(a.day - b.day) <= {WINDOW_DAYS}"""


def cooccurrences(table: str, perm: bool) -> str:
    """SQL counting member pairs trading the same org in the same direction within WINDOW_DAYS."""
    cols = "a.perm, " if perm else ""
    return f"select {cols}a.member as m1, b.member as m2, count(*) as n {PAIR_JOIN.format(t=table, p='a.perm = b.perm and ' if perm else '')} group by all"


def shuffled(rows: list[dict[str, Any]]) -> pa.Table:
    """SHUFFLES copies of rows; within each member-year the dates are permuted among that member's trades."""
    rng = random.Random(SEED)
    groups: dict[tuple[str, int], list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        groups[(r["member"], r["year"])].append(i)
    keys = sorted(groups)
    perm_col, member, org, action, day = [], [], [], [], []
    for s in range(SHUFFLES):
        for k in keys:
            idx = groups[k]
            days = [rows[i]["day"] for i in idx]
            rng.shuffle(days)
            for i, d in zip(idx, days):
                perm_col.append(s)
                member.append(rows[i]["member"])
                org.append(rows[i]["org"])
                action.append(rows[i]["action"])
                day.append(d)
    return pa.table({"perm": perm_col, "member": member, "org": org, "action": action, "day": day})


def traded_together(trades: list[dict[str, Any]], companies: dict[str, dict[str, Any]],
                    spine: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    # One row per member, org, direction and day: several lots on one day are one decision.
    reps: dict[tuple[str, str, str, int], dict[str, Any]] = {}
    for t in sorted((t for t in trades if eligible(t, companies)), key=lambda t: t["id"]):
        key = (t["member"], t["org"], t["action"], (t["date"] - EPOCH).days)
        reps.setdefault(key, t)
    rows = [{"member": k[0], "org": k[1], "action": k[2], "day": k[3], "year": t["date"].year, "id": t["id"]}
            for k, t in sorted(reps.items())]
    con = duckdb.connect()
    con.register("d", pa.Table.from_pylist(rows))
    observed = {(m1, m2): n for m1, m2, n in con.execute(cooccurrences("d", False)).fetchall()}
    candidates = {k for k, n in observed.items() if n >= MIN_OBSERVED}
    con.register("s", shuffled(rows))
    # totals[pair] = [co-occurrences summed over shuffles, shuffles with at least the observed count]
    totals: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for _, m1, m2, n in con.execute(cooccurrences("s", True)).fetchall():
        pair = (m1, m2)
        if pair in candidates:
            totals[pair][0] += n
            totals[pair][1] += n >= observed[pair]

    detail = con.execute(f"""select a.member, b.member, a.org, a.action, a.day, b.day, a.id, b.id
        {PAIR_JOIN.format(t="d", p="")}""").fetchall()
    occasions: dict[tuple[str, str], list[tuple[Any, ...]]] = defaultdict(list)
    for m1, m2, *rest in detail:
        if (m1, m2) in candidates:
            occasions[(m1, m2)].append(tuple(rest))
    by_id = {t["id"]: t for t in trades}

    edges, table = [], []
    for pair in sorted(candidates):
        obs = observed[pair]
        expected_raw = totals[pair][0] / SHUFFLES
        expected = max(expected_raw, 1 / SHUFFLES)
        lift = obs / expected
        tickers = {o[0] for o in occasions[pair]}
        passes = (len(tickers) >= MIN_TICKERS or obs >= MIN_OCCASIONS) and obs >= MIN_OBSERVED and lift >= MIN_LIFT
        p_value = (totals[pair][1] + 1) / (SHUFFLES + 1)
        table.append((pair, obs, expected_raw, lift, len(tickers), p_value, passes))
        if not passes:
            continue
        evid = []
        years = []
        for org, action, d1, d2, id1, id2 in occasions[pair]:
            first_day = EPOCH + timedelta(days=min(d1, d2))
            years.append((first_day.year, 1, {"low": None, "high": None, "exact": None}))
            t1, t2 = by_id[id1], by_id[id2]
            evid.append({"label": f"Both {ACTION_WORD[action]} {t1['ticker']}: {spine[pair[0]]['name']} on {t1['date']}, "
                                  f"{spine[pair[1]]['name']} on {t2['date']}",
                         "date": first_day.isoformat(), "url": t1["url"] if d1 <= d2 else t2["url"], "source": SOURCE_ID,
                         "record": f"{id1} + {id2}", "_size": None})
        days = [EPOCH + timedelta(days=min(o[2], o[3])) for o in occasions[pair]]
        stat = {"observed": obs, "expected": round(expected, 4), "lift": round(lift, 2), "p": round(p_value, 4),
                "method": (f"permutation: {SHUFFLES} shuffles (seed {SEED}) of each member's trade dates within the calendar "
                           f"year; same ticker and direction within {WINDOW_DAYS} days"
                           + ("; no shuffle produced a match, expected floored at 1/shuffles" if expected_raw == 0 else ""))}
        edges.append(make_edge(
            "traded_together", node("member", pair[0]), node("member", pair[1]), directed=False, basis="derived",
            years=by_year(years), first=min(days).isoformat(), last=max(days).isoformat(), evidence=top_evidence(evid),
            evidence_total=len(evid), stat=stat, weak=p_value > WEAK_P or len(tickers) < MIN_TICKERS,
            note=f"{len(tickers)} distinct tickers; {obs} same-direction trades within {WINDOW_DAYS} days vs {expected:.2f} expected"))
    report = {
        "eligible_trades": sum(1 for t in trades if eligible(t, companies)), "member_day_rows": len(rows),
        "pairs_with_any_cooccurrence": len(observed), "pairs_tested": len(candidates),
        "pairs_passed": len(edges), "shuffles": SHUFFLES, "seed": SEED,
        "eligible_by_class": dict(Counter(t["asset_class"] for t in trades if eligible(t, companies))),
        "top": [{"pair": list(p), "names": [spine[p[0]]["name"], spine[p[1]]["name"]], "observed": o,
                 "expected": round(e, 4), "lift": round(l, 2), "tickers": k, "p": round(pv, 4)}
                for p, o, e, l, k, pv, ok in sorted(table, key=lambda r: (-r[3], -r[1], r[0])) if ok][:15],
    }
    return edges, report


def org_rows(edges: list[dict[str, Any]], trades: list[dict[str, Any]], companies: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    names: dict[str, Counter[str]] = defaultdict(Counter)
    for t in trades:
        if t["org"]:
            names[t["org"]][t["asset"]] += 1
    rows = []
    for org in sorted({e["to"]["id"] for e in edges if e["type"] == "traded"}):
        if org.startswith("co:"):
            c = companies[org]
            rows.append({"id": org, "name": c["name"], "kind": "company", "ticker": c["ticker"], "cik": c["cik"], "sector": c["sector"]})
        else:
            label = min(names[org].items(), key=lambda kv: (-kv[1], kv[0]))[0]
            rows.append({"id": org, "name": label, "kind": "other", "ticker": org[3:], "cik": None, "sector": None})
    return rows


def run() -> None:
    trades = pq.read_table(BUILD / "trades.parquet").to_pylist()
    trades = resolve(trades, read_json(BUILD / "ticker_orgs.json"))
    pq.write_table(pa.Table.from_pylist(trades), BUILD / "trades_resolved.parquet")
    companies = read_json(BUILD / "companies.json")
    spine = read_json(BUILD / "spine.json")
    traded = traded_edges(trades)
    together, report = traded_together(trades, companies, spine)
    write_jsonl(EDGES_DIR / "trades.jsonl", traded + together)
    orgs = org_rows(traded, trades, companies)
    write_jsonl(ORGS_DIR / "trades.jsonl", orgs)
    print(f"traded edges: {len(traded)} over {len(orgs)} orgs; trades without org: {sum(t['org'] is None for t in trades)}")
    print(f"traded_together: eligible trades {report['eligible_trades']} -> {report['member_day_rows']} member-day rows; "
          f"pairs with any co-occurrence {report['pairs_with_any_cooccurrence']}, tested (observed >= {MIN_OBSERVED}) "
          f"{report['pairs_tested']}, passed {report['pairs_passed']}")
    print_table("top 15 traded_together pairs by lift", [
        (r["names"][0], r["names"][1], r["observed"], r["expected"], r["lift"], r["tickers"], r["p"]) for r in report["top"]],
        ("member 1", "member 2", "obs", "expected", "lift", "tickers", "p"))
    write_source_meta("trade_edges", {}, {"traded_edges": len(traded), "traded_orgs": len(orgs), "traded_together": report})
