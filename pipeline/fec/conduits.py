"""Committees whose pas2 rows are individuals' contributions forwarded, not the committee's own money.

Two exact-id lists (never names), both reviewed by hand; evidence per id: docs/fec-conduits.md.
- FORWARDERS: payment platforms. Every contribution-type row is dropped as `drop:earmarked_via_conduit`
  (as is any row whose memo text says EARMARK). Unchanged since the first FEC build.
- LISTED: PACs that forward contributions earmarked by individuals and report them as ordinary 24K rows with no
  memo code and no memo text, so the memo rule cannot see them. In the cycle files where that pattern is
  present, ALL their 24K rows are dropped as `drop:conduit_pass_through`, including the PAC's own direct gifts,
  because pas2 gives no exact way to tell the two apart. In-kind (24Z) rows and independent expenditures of these committees are kept.
`exclusions` counts what the rule removed (meta.json `exclusions.conduit_pass_through`); `review` lists what is
still kept and looks like forwarded money (counts in meta.json `reports.fec.conduit_review`, the full lists in
pipeline/build/fec_conduit_review.json, read by pipeline/validate_fec_conduits.py). Both read table `p_rules` after build.classify_rows.
"""
from __future__ import annotations

import json
from pathlib import Path

from .load import q

FORWARDERS = {"C00694323": "WINRED", "C00401224": "ACTBLUE", "C00468314": "DEMOCRACY ENGINE, INC., PAC"}
# id -> (name as in the FEC committee master, the cycle files in which its rows are dropped). A cycle is listed when
# the committee's non-memo 24K rows in that file include at least CYCLE_SMALL_ROWS rows under $200 or at least
# CYCLE_OVER_ROWS rows above $5,000 to candidate committees, or (marked "recipient") a recipient's own report shows
# the rows as earmarked receipts. Other cycles show ordinary gifts and stay counted. Table: docs/fec-conduits.md.
CYCLE_SMALL_ROWS, CYCLE_OVER_ROWS = 10, 2
LISTED = {
    "C00448696": ("SENATE CONSERVATIVES FUND", (2018, 2020, 2024)),
    "C00552851": ("HOUSE FREEDOM FUND", (2016, 2020, 2022, 2024, 2026)),
    "C00247403": ("NORPAC", (2010, 2012, 2016, 2018, 2020, 2022, 2024, 2026)),
    "C00345132": ("REPUBLICAN JEWISH COALITION-POLITICAL ACTION COMMITTEE (RJC-PAC)", (2018, 2020)),
    "C00484535": ("VOTESANE PAC", (2016, 2020, 2024)),            # 2016: recipient
    "C00678870": ("WINDEM", (2018,)),                             # 2018: recipient
}
TYPE = "24K"
RULE = "drop:conduit_pass_through"
KEY = "conduit_pass_through"
REVIEW_FILE = "fec_conduit_review.json"   # full review lists, under pipeline/build/ (not published)
REASON = ("FEC contribution rows (type 24K) to members' campaigns from PACs on a reviewed list that forward "
          "contributions earmarked by individuals and report them like their own, in the two-year cycles where "
          "their filings show it: not counted as PAC money or member-to-member money. These are the rows this rule "
          "took; some would otherwise have been dropped by another rule. The listed PACs' own direct gifts in those "
          "cycles are left out with them. Listed, by FEC committee id: "
          + "; ".join(f"{c} {n} ({', '.join(map(str, cycles))})" for c, (n, cycles) in sorted(LISTED.items())) + ".")

LIMIT = 5000          # a multicandidate PAC's limit per candidate per election; rows and sums above it are listed
HARD = 10000          # single rows above this are the candidates for a hard failure (see validate_fec_conduits.py)
SMALL = 200           # a "small" row: below the FEC's itemisation threshold for individuals
SMALL_ROWS = 25       # a giver with at least this many small rows in one cycle file is listed
PARTY = "('X','Y','Z')"


def sql_ids(ids) -> str:
    return ",".join(f"'{c}'" for c in sorted(ids))


def is_listed(committee: str | None, cycle: int | None) -> bool:
    return committee in LISTED and cycle in LISTED[committee][1]


def when_sql() -> str:
    """The CASE branch build.classify_rows places straight after the earmark rule (`cycle` is the pas2 file's)."""
    listed = " OR ".join(f"(CMTE_ID = '{c}' AND cycle IN ({', '.join(map(str, cycles))}))"
                         for c, (_, cycles) in sorted(LISTED.items()))
    return f"WHEN tp = '{TYPE}' AND ({listed or 'FALSE'}) THEN '{RULE}'"


def _money(x) -> float:
    return round(float(x or 0), 2)


def exclusions(con) -> dict:
    """{KEY: {rows, dollars, ...}}: rows/dollars are the dropped rows whose recipient is a member's campaign (what
    would otherwise have been counted); all_recipients also counts rows to non-members."""
    per = q(con, f"""SELECT CMTE_ID, cycle, count(*), sum(amt), count(*) FILTER (WHERE to_member IS NOT NULL),
                            sum(amt) FILTER (WHERE to_member IS NOT NULL), count(DISTINCT to_member)
                     FROM p_rules WHERE rule = '{RULE}' GROUP BY 1, 2 ORDER BY 1, 2""")
    by_cmte = {c: {"committee": c, "name": n, "cycles": list(cycles), "rows": 0, "dollars": 0.0}
               for c, (n, cycles) in sorted(LISTED.items())}
    by_cycle: dict[str, dict] = {}
    tot = {"rows": 0, "dollars": 0.0, "all_rows": 0, "all_dollars": 0.0}
    for cmte, cycle, n_all, d_all, n, d, _members in per:
        cyc = by_cycle.setdefault(str(cycle), {"rows": 0, "dollars": 0.0})
        for tgt in (by_cmte[cmte], cyc, tot):
            tgt["rows"] += n
            tgt["dollars"] = _money(tgt["dollars"] + _money(d))
        tot["all_rows"] += n_all
        tot["all_dollars"] = _money(tot["all_dollars"] + _money(d_all))
    pairs = q(con, f"SELECT count(*) FROM (SELECT DISTINCT CMTE_ID, to_member FROM p_rules WHERE rule = '{RULE}' "
                   "AND to_member IS NOT NULL)")[0][0]
    return {KEY: {"rows": tot["rows"], "dollars": tot["dollars"], "reason": REASON,
                  "all_recipients": {"rows": tot["all_rows"], "dollars": tot["all_dollars"]},
                  "giver_member_pairs": pairs, "committees": list(by_cmte.values()),
                  "by_cycle": dict(sorted(by_cycle.items()))}}


def review(con) -> dict:
    """Kept pac_money rows that look like forwarded money, in full: single rows over LIMIT (any contribution type,
    with the type), and for 24K rows giver -> member -> election sums over LIMIT within one cycle file (the election
    code as filed) and givers with many small rows. Party committees are left out (their limits are higher);
    candidate committees and joint fundraising committees never reach pac_money."""
    kept = f"""FROM p_rules r LEFT JOIN cm_latest c USING (CMTE_ID)
               WHERE r.rule = 'keep:pac_money' AND coalesce(c.CMTE_TP, '') NOT IN {PARTY}"""
    rows = q(con, f"""SELECT r.SUB_ID, r.cycle, r.CMTE_ID, c.CMTE_NM, r.to_member, r.OTHER_ID, r.TRANSACTION_PGI, r.dt,
                             r.amt, r.IMAGE_NUM, r.tp {kept} AND r.amt > {LIMIT} ORDER BY r.amt DESC, r.SUB_ID""")
    over = [{"sub_id": s, "cycle": cy, "committee": cm, "committee_name": nm, "to": to, "recipient_committee": oid,
             "election": pgi, "date": d.isoformat(), "amount": _money(a), "type": tp,
             "url": f"https://docquery.fec.gov/cgi-bin/fecimg/?{img}" if img else None}
            for s, cy, cm, nm, to, oid, pgi, d, a, img, tp in rows]
    sums = q(con, f"""SELECT r.cycle, r.CMTE_ID, any_value(c.CMTE_NM), r.to_member, coalesce(r.TRANSACTION_PGI, ''),
                             count(*), sum(r.amt), max(r.amt) {kept} AND r.tp = '{TYPE}' GROUP BY 1, 2, 4, 5
                      HAVING sum(r.amt) > {LIMIT} ORDER BY 7 DESC, 1, 2, 4, 5""")
    small = q(con, f"""SELECT r.cycle, r.CMTE_ID, any_value(c.CMTE_NM), count(*) FILTER (WHERE r.amt > 0 AND r.amt < {SMALL}),
                              count(*), sum(r.amt) {kept} AND r.tp = '{TYPE}' GROUP BY 1, 2
                       HAVING count(*) FILTER (WHERE r.amt > 0 AND r.amt < {SMALL}) >= {SMALL_ROWS}
                       ORDER BY 4 DESC, 1, 2""")
    hard = [r for r in over if r["amount"] > HARD]
    return {
        "thresholds": {"limit": LIMIT, "hard": HARD, "small": SMALL, "small_rows": SMALL_ROWS},
        "rows_over_limit": {"count": len(over), "dollars": _money(sum(r["amount"] for r in over)),
                            "givers": len({r["committee"] for r in over}), "rows": over},
        "rows_over_hard": {"count": len(hard), "dollars": _money(sum(r["amount"] for r in hard)), "rows": hard},
        "sums_over_limit": {"count": len(sums), "sums": [
            {"cycle": cy, "committee": cm, "committee_name": nm, "to": to, "election": pgi or None, "rows": n,
             "dollars": _money(d), "largest_row": _money(mx)} for cy, cm, nm, to, pgi, n, d, mx in sums]},
        "small_row_givers": {"count": len(small), "givers": [
            {"cycle": cy, "committee": cm, "committee_name": nm, "small_rows": k, "rows": n, "dollars": _money(d)}
            for cy, cm, nm, k, n, d in small]},
    }


def counts_only(rev: dict) -> dict:
    """The review without its lists: what goes into the FEC report and so into meta.json."""
    return {k: ({kk: vv for kk, vv in v.items() if not isinstance(vv, list)} if k != "thresholds" else v)
            for k, v in rev.items()} | {"lists_in": f"pipeline/build/{REVIEW_FILE}"}


def report_all(con, report: dict, build_dir: Path) -> None:
    """FEC stage hook: exclusion counts and review counts into the report; the full review lists into REVIEW_FILE."""
    excl, rev = exclusions(con), review(con)
    report["exclusions"], report["conduit_review"] = excl, counts_only(rev)
    build_dir.mkdir(parents=True, exist_ok=True)
    (build_dir / REVIEW_FILE).write_text(json.dumps(rev, indent=1, sort_keys=True) + "\n")
    print_report(excl, rev)


def print_report(excl: dict, rev: dict) -> None:
    e = excl[KEY]
    print(f"\nlisted conduit PACs ({RULE}): {e['rows']:,} rows to members' campaigns, ${e['dollars']:,.0f} "
          f"({e['all_recipients']['rows']:,} rows, ${e['all_recipients']['dollars']:,.0f} to all recipients)")
    for c in e["committees"]:
        print(f"  {c['committee']} {c['name'][:44]:44} {c['rows']:>7,} ${c['dollars']:>12,.0f}")
    print(f"kept pac_money rows (non-party givers) over ${LIMIT:,}: {rev['rows_over_limit']['count']:,} "
          f"(${rev['rows_over_limit']['dollars']:,.0f}, {rev['rows_over_limit']['givers']:,} givers); over ${HARD:,}: "
          f"{rev['rows_over_hard']['count']:,}; 24K giver-member-election sums over ${LIMIT:,}: "
          f"{rev['sums_over_limit']['count']:,}; givers with {SMALL_ROWS}+ 24K rows under ${SMALL}: "
          f"{rev['small_row_givers']['count']:,}")
    for r in rev["rows_over_hard"]["rows"][:25]:
        print(f"  {r['date']} {r['committee']} {(r['committee_name'] or '')[:36]:36} -> {r['to']} ${r['amount']:,.0f}")
