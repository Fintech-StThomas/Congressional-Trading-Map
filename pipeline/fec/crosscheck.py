"""Cross-check of giver-reported contributions (pas2) against the recipient's own FEC summary (weball).

For a few well-known members and the 2018-2024 cycles, the FEC stage prints and reports, side by side:
- our positive rows from non-party committees (pac_money + member-to-member funds + other candidates' campaigns),
  against weball line 11c "contributions from other political committees" (a gross figure);
- our negative rows (refunds and voids the giver reported) on their own, against weball's refunds to committees,
  instead of netting them into a figure the recipient reports gross (a voided check the recipient never banked is
  in neither of the recipient's figures, so the residual after our negatives is given as well);
- the part of our positive rows dated in December of the even year, which a recipient may receive (and report) in
  January of the next cycle: a timing difference, not a missing receipt;
- what the listed conduit PACs' rows would have added (conduits.py), now left out of our side.
The residual is labelled "giver-reported minus recipient line 11c". It is a difference of definitions (amended
recipient reports, the date given against the date received, money routed through a joint fundraising committee)
and is printed for a human to read; nothing here fails the build. A cycle runs from 1 January of the odd year to
31 December of the even year by transaction date. Reads `p_rules`, `cm_latest` and `weball`.
"""
from __future__ import annotations

from typing import Callable

from . import conduits
from .load import q

# Well-known members across parties and both chambers.
MEMBERS = ["P000197", "S000148", "M000355", "O000172", "J000289", "C001098"]
CYCLES = (2018, 2020, 2022, 2024)
OURS = "('keep:pac_money','keep:funds','drop:giver_campaign_of_non_member')"
RESIDUAL = "giver-reported minus recipient line 11c"


def _f(x) -> float:
    return round(float(x or 0), 2)


def rows_for(con, bio: str, name: str, fec_ids: list[str]) -> list[dict]:
    idl = conduits.sql_ids(fec_ids)
    if not idl:
        return []
    wb = q(con, f"""SELECT cycle, sum(try_cast(OTHER_POL_CMTE_CONTRIB AS DOUBLE)), sum(try_cast(POL_PTY_CONTRIB AS DOUBLE)),
                           sum(try_cast(CMTE_REFUNDS AS DOUBLE))
                    FROM weball WHERE CAND_ID IN ({idl}) GROUP BY 1 ORDER BY 1""")
    out = []
    for cyc, other, party, refunds in wb:
        if cyc not in CYCLES:
            continue
        party_giver = f"coalesce(c.CMTE_TP, '') IN {conduits.PARTY}"
        mine = q(con, f"""SELECT
                sum(amt) FILTER (WHERE rule IN {OURS} AND NOT ({party_giver}) AND amt > 0),
                sum(amt) FILTER (WHERE rule IN {OURS} AND NOT ({party_giver}) AND amt < 0),
                sum(amt) FILTER (WHERE rule IN {OURS} AND NOT ({party_giver}) AND amt > 0
                                 AND dt >= DATE '{cyc}-12-01'),
                sum(amt) FILTER (WHERE rule = '{conduits.RULE}' AND amt > 0),
                sum(amt) FILTER (WHERE rule = 'keep:pac_money' AND {party_giver} AND amt > 0)
              FROM p_rules r LEFT JOIN cm_latest c USING (CMTE_ID)
              WHERE to_member = '{bio}' AND dt BETWEEN DATE '{cyc - 1}-01-01' AND DATE '{cyc}-12-31'""")[0]
        pos, neg, december, conduit, pty = (_f(x) for x in mine)
        other_f = None if other is None else _f(other)
        out.append({"member": bio, "name": name, "cycle": cyc,
                    "recipient_line_11c": other_f, "ours_positive": pos,
                    "residual": None if other_f is None else _f(pos - other_f), "residual_label": RESIDUAL,
                    "residual_pct": round(100 * (pos - other_f) / other_f, 1) if other_f else None,
                    "ours_positive_dated_december_even_year": december,
                    "ours_negative": neg, "recipient_refunds_to_committees": None if refunds is None else _f(refunds),
                    "residual_after_our_negatives": None if other_f is None else _f(pos + neg - other_f),
                    "listed_conduits_left_out": conduit,
                    "recipient_party": None if party is None else _f(party), "ours_party_positive": pty})
    return out


def run(con, info: dict, report: dict, table: Callable) -> None:
    out = [r for bio in MEMBERS if bio in info
           for r in rows_for(con, bio, info[bio]["name"], info[bio].get("fec_ids") or [])]
    report["weball_check"] = out
    table(f"weball check: {RESIDUAL} (positive rows only; timing = our rows dated December of the even year; "
          "refunds compared on their own; listed conduits left out)",
          ("member", "cycle", "line_11c", "ours_pos", "residual", "res%", "timing", "ours_neg", "their_refunds",
           "res_after_neg", "conduits_out", "their_party", "ours_party"),
          [(f"{o['member']} {o['name'][:22]}", o["cycle"], o["recipient_line_11c"], o["ours_positive"], o["residual"],
            "" if o["residual_pct"] is None else f"{o['residual_pct']:.1f}%", o["ours_positive_dated_december_even_year"],
            o["ours_negative"], o["recipient_refunds_to_committees"], o["residual_after_our_negatives"], o["listed_conduits_left_out"],
            o["recipient_party"], o["ours_party_positive"]) for o in out])
