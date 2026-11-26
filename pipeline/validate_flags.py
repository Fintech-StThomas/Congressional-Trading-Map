"""Checks for the review flags (data dictionary: "Review flags"; docs/review-flags.md). Called from validate.py.

Every rule is re-derived from the published files by validate_flags_derive.py (its docstring says which parts are
independent of pipeline/assemble/flags.py and which are shared), and the published flags, details, not-evaluated
counts and "expected by chance" figures must agree. For money_both_ways the named edge must be the member's pac_money
tie from the trade's org (a full edge or a ledger row, whose id is recomputed) with a record in the trade's cycle; for
sector_overseen no trade in a pooled vehicle may be flagged. Everywhere: no not-counted trade is flagged, rule ids are
in the fixed set, and counts agree between trade files, member files (`trade_summary.flags`), flags.json and meta.json;
flags.json holds exactly the trades its selection rule names (or a stated, capped prefix) with each trade's owner.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from .assemble.flags import RULE_IDS, read_committee_sectors
from .assemble.flags_chance import DESCRIPTIVE
from .assemble.flags_out import FLAGS_COLS, selection
from .config import FLAGS_METHOD_VERSION
from .contract import TRADE_COLUMNS
from .util import BUILD, read_json
from .validate_flags_derive import (counted, derive_large, derive_late, derive_money, derive_pile_on, derive_sector,
                                    in_cycle, pac_ties)

__all__ = ["check_flags", "check_flags_file", "counted", "derive_large", "derive_late", "derive_pile_on"]
DETAIL_KEYS = {"late": {"lag_days"}, "large_amount": {"low"}, "pile_on": {"members", "observed", "expected"},
               "money_both_ways": {"edge"}, "sector_overseen": {"committee"}}
FILE_KEYS = {"method_version", "build_date", "statement", "rules", "selection", "cols", "rows"}
Files = dict[str, dict[str, Any]]


def same_pile(got: dict[str, Any], want: dict[str, Any]) -> bool:
    """Equal details; `expected` to its 3 published decimals (the two code paths sum in another order)."""
    return set(got) == set(want) and all(
        got[t]["members"] == want[t]["members"] and got[t]["observed"] == want[t]["observed"]
        and abs(got[t]["expected"] - want[t]["expected"]) <= 0.0011 for t in got)


def money_ok(c: Any, mid: str, rows: list[dict[str, Any]], got: dict[str, Any], want: dict[str, Any], mf: dict[str, Any]) -> None:
    """The published money flags against the re-derived ones, and each named edge against the member's ties."""
    ties, _ = pac_ties(mid, mf)
    by_id = {r["id"]: r for r in rows}
    for tid in set(got) | set(want):
        w, g = want.get(tid), got.get(tid)
        ok = (g == w) if not isinstance(w, set) else ((g is None and None in w) or g in w or (g is not None and "*" in w))
        c.check(ok, "flags: money_both_ways re-derived from the member file", f"trades/{mid}:{tid} {g} vs {w}")
        if g is None:
            continue
        r = by_id.get(tid)
        y = int(r["date"][:4]) if r and r["date"] else 0
        tie = next((t for t in ties.get(r["org"] if r else "", []) if t["id"] == g), None)
        if tie is None and isinstance(w, set) and "*" in w:
            continue          # a former member's trimmed ledger: the tie may be unpublished
        c.check(tie is not None and in_cycle(tie, y + y % 2) is not None,
                "flags: money_both_ways edge is the member's pac_money tie from the org, with a record in the cycle", f"trades/{mid}:{tid} {g}")


def check_baselines(c: Any, doc: dict[str, Any], meta: dict[str, Any], chance: dict[str, dict[str, Any]]) -> None:
    """flags.json and meta.json carry the same baseline per rule; descriptive rules carry none; the chance figures
    equal the ones re-derived here (to rounding: sums run in another order)."""
    base = meta.get("flags", {}).get("baselines", {})
    c.check({r["id"]: r.get("baseline") for r in doc["rules"]} == base and set(base) == set(RULE_IDS), "flags: baselines in flags.json = meta.json", "")
    for rule, b in base.items():
        if rule in DESCRIPTIVE:
            c.check(b["kind"] == "descriptive" and b["expected_met"] is None and b["expected_share"] is None, "flags: descriptive rules have no chance figure", rule)
            continue
        want = chance[rule]
        ok = b["kind"] == "chance" and ((b["expected_met"] is None) == (want["expected_met"] is None))
        if ok and want["expected_met"] is not None:
            ok = abs(b["expected_met"] - want["expected_met"]) <= 0.1 and all(
                abs(b[k] - want[k]) <= 0.1 for k in ("expected_others_sum", "observed_others_sum") if k in b)
            ok = ok and ("observed_others_sum" not in b or b["observed_others_sum"] == want["observed_sum"])
        c.check(ok, "flags: chance baseline re-derived", f"{rule} {b.get('expected_met')} vs {want['expected_met']}")


def check_flags(c: Any, out: Path, files: Files, summaries: dict[str, dict[str, Any]], meta: dict[str, Any]) -> None:
    companies = read_json(BUILD / "companies.json")
    full = {cid for cid, x in read_json(BUILD / "committees.json").items() if x["parent"] is None}
    table = read_committee_sectors()
    pile, pile_ne, pile_sums = derive_pile_on(files, companies)
    met_total: Counter[str] = Counter()
    ne_total: Counter[str] = Counter()
    flagged: dict[tuple[str, str], list[str]] = {}
    n_counted = undetermined = 0
    for mid in sorted(summaries):
        tf = files.get(mid) or {"rows": []}
        rows = counted(tf)
        n_counted += len(rows)
        flags, ne = tf.get("flags", {}), tf.get("flags_not_evaluated", {r: 0 for r in RULE_IDS})
        where = f"trades/{mid}"
        if tf.get("rows"):
            c.check("flags" in tf and isinstance(flags, dict) and isinstance(ne, dict) and set(ne) == set(RULE_IDS)
                    and all(isinstance(v, int) and v >= 0 for v in ne.values()), "schema", f"{where} flags")
        by_id = {r["id"]: r for r in rows}
        per_rule: Counter[str] = Counter()
        for tid, d in flags.items():
            c.check(tid not in (tf.get("not_counted") or {}), "flags: no not-counted trade is flagged", f"{where}:{tid}")
            c.check(tid in by_id and bool(d) and set(d) <= set(RULE_IDS), "flags: a listed trade, rule ids in the fixed set", f"{where}:{tid}")
            c.check(all(set(v) == DETAIL_KEYS.get(k) for k, v in d.items()), "flags: detail keys per rule", f"{where}:{tid}")
            per_rule.update(list(d))
            flagged[(mid, tid)] = sorted(d, key=lambda r: RULE_IDS.index(r) if r in RULE_IDS else 99)
            if "sector_overseen" in d and tid in by_id:
                c.check((companies.get(by_id[tid]["org"]) or {}).get("pooled_vehicle") is not True,
                        "flags: pooled vehicles are not evaluated for sector_overseen", f"{where}:{tid}")
        got = lambda rule: {tid: d[rule] for tid, d in flags.items() if rule in d}  # noqa: E731
        for rule, (exp, exp_ne) in {"late": derive_late(rows), "large_amount": derive_large(rows)}.items():
            c.check(got(rule) == exp, f"flags: {rule} re-derived from the trade file", f"{where} {len(got(rule))} vs {len(exp)}")
            c.check(ne.get(rule, 0) == exp_ne, f"flags: {rule} not-evaluated count re-derived", f"{where} {ne.get(rule)} vs {exp_ne}")
        c.check(same_pile(got("pile_on"), {t: pile[t] for t in by_id if t in pile}), "flags: pile_on re-derived from the trade files", where)
        c.check(ne.get("pile_on", 0) == pile_ne[mid], "flags: pile_on not-evaluated count re-derived", f"{where} {ne.get('pile_on')} vs {pile_ne[mid]}")
        if rows:
            mf = read_json(out / "members" / f"{mid}.json")
            money, money_ne, unsure = derive_money(mid, rows, mf)
            undetermined += unsure
            money_ok(c, mid, rows, {t: v["edge"] for t, v in got("money_both_ways").items()}, money, mf)
            c.check(ne.get("money_both_ways", 0) == money_ne, "flags: money_both_ways not-evaluated count re-derived", f"{where} {ne.get('money_both_ways')} vs {money_ne}")
            sector, sector_ne = derive_sector(rows, mf, companies, full, table)
            c.check({t: v["committee"] for t, v in got("sector_overseen").items()} == sector, "flags: sector_overseen re-derived from the roster and table", where)
            c.check(ne.get("sector_overseen", 0) == sector_ne, "flags: sector_overseen not-evaluated count re-derived", f"{where} {ne.get('sector_overseen')} vs {sector_ne}")
        c.check(summaries[mid].get("flags") == {r: per_rule[r] for r in RULE_IDS}, "flags: trade_summary.flags = trade file flags", where)
        met_total.update(per_rule)
        ne_total.update({r: ne.get(r, 0) for r in RULE_IDS})
    print(f"  flags: money_both_ways undetermined from the published files (ledger dates straddle the cycle, or a trimmed ledger): {undetermined}")
    doc = read_json(out / "flags.json")
    check_flags_file(c, doc, meta, flagged, files, met_total, ne_total, n_counted)
    check_baselines(c, doc, meta, {"pile_on": {**pile_sums, "expected_others_sum": pile_sums["expected_sum"],
                                               "observed_others_sum": pile_sums["observed_sum"]}})


def check_flags_file(c: Any, doc: dict[str, Any], meta: dict[str, Any], flagged: dict[tuple[str, str], list[str]],
                     files: Files, met: Counter[str], ne: Counter[str], n_counted: int) -> None:
    totals = {r: {"met": met[r], "evaluated": n_counted - ne[r], "not_evaluated": ne[r]} for r in RULE_IDS}
    c.check(set(doc) == FILE_KEYS and doc["cols"] == FLAGS_COLS and doc["method_version"] == FLAGS_METHOD_VERSION,
            "schema", "flags.json keys")
    c.check([r["id"] for r in doc["rules"]] == list(RULE_IDS), "flags: flags.json rules in the fixed order", "")
    c.check({r["id"]: r["counts"] for r in doc["rules"]} == totals, "flags: flags.json counts = trade files", str(totals))
    mf = meta.get("flags", {})
    c.check(mf.get("method_version") == FLAGS_METHOD_VERSION and mf.get("rules") == totals
            and mf.get("trades_counted") == n_counted == meta["counts"]["trades"]
            and mf.get("trades_flagged") == len(flagged), "flags: meta.json flags = trade files", str(mf.get("rules")))
    build = date.fromisoformat(doc["build_date"])
    avail = {(m, r[0]): r[TRADE_COLUMNS.index("available")] for m, tf in files.items() for r in tf.get("rows", [])}
    want = {k for k, rules in flagged.items()
            if selection(len(rules), date.fromisoformat(avail[k]) if avail.get(k) else None, build)}
    rows = [dict(zip(FLAGS_COLS, r)) for r in doc["rows"]]
    got = {(r["member"], r["id"]) for r in rows}
    sel = doc["selection"]
    c.check(len(got) == len(rows) == sel["rows_published"] and sel["rows_selected"] == len(want)
            and sel["truncated"] == (len(rows) < len(want)) and len(rows) <= sel["max_rows"], "flags: flags.json selection counts", "")
    c.check(got == want if not sel["truncated"] else got <= want, "flags: flags.json rows = the selection rule", f"{len(got ^ want)} differ")
    owner = {(m, r[0]): r[TRADE_COLUMNS.index("owner")] for m, tf in files.items() for r in tf.get("rows", [])}
    for r in rows:
        c.check(flagged.get((r["member"], r["id"])) == r["rules"], "flags: flags.json row rules = trade file", f"{r['member']}:{r['id']}")
        c.check(owner.get((r["member"], r["id"])) == r["owner"], "flags: flags.json row owner = trade file", f"{r['member']}:{r['id']}")
