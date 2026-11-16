"""Two derived figures for a House member's holdings file, from data already in it: the change in the disclosed net
worth range between the first and the latest report used, and leverage (liabilities by year and filed type).

Pure functions; run.py adds their output to holdings/<id>.json and holdings-index.json. Rules: the data dictionary,
"Holdings and net worth" ("Change since first report", "Liabilities and leverage"). Ranges only: no midpoints, no
percentages of growth, no annualised rates.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from ..util import normalise_name
from .ranges import band_sum

# Liability row columns (run.LIAB_COLS order), by name.
L_CRED, L_TYPE, L_LOW, L_HIGH, L_RES = 1, 2, 4, 5, 7

# Filed liability type (and creditor) text -> bucket. Checked in this order; the first match wins. A liability
# that run.py marked residence_secured is "residence" before any of these.
LIABILITY_BUCKETS: list[tuple[str, str, re.Pattern[str]]] = [
    ("margin", "Margin or securities-backed loan",
     re.compile(r"\bmargin\b|securities[- ]?(?:backed|based)|pledged asset|portfolio loan|loan against (?:securities|"
                r"stock|portfolio)|\bpal\b|liquidity access|\bsbl(?:oc)?\b|stock loan|brokerage (?:collateral )?loan|collateral loan", re.I)),
    ("student", "Student loan", re.compile(r"\bstudent\b|\beducation(?:al)? loan|\bsallie mae\b|\bnavient\b|"
                                           r"\bnelnet\b|\bgreat lakes\b|\bfedloan\b|school loan|parent[- ]plus|department of education", re.I)),
    ("property", "Mortgage or loan on investment or other property",
     re.compile(r"\brent(?:al|ed)?\b|\binvestment\b|\bcommercial\b|\bfarm\b|\branch\b|\bland\b|\bconstruction\b|"
                r"\bduplex\b|\bapartment|\bcondo|\bbuilding\b|\bproperty\b|\breal estate\b|\blot\b|"
                r"street address redacted", re.I)),
    ("mortgage_unstated", "Mortgage, property not stated", re.compile(r"\bmortgage\b|\bmtg\b", re.I)),
    ("credit", "Credit card or credit line",
     re.compile(r"credit card|\brevolving\b|charge account|line of credit|credit line|\bloc\b|\bheloc\b|"
                r"\bamex\b|american express|\bvisa\b|\bmastercard\b|\bdiscover\b", re.I)),
    ("vehicle", "Vehicle or boat loan", re.compile(r"\bauto(?:mobile)?\b|\bcar\b|\bvehicle\b|\bpickup\b|"
                                                 r"\btruck\b|\bboat\b", re.I)),
    ("business", "Business loan, equipment or guarantee",
     re.compile(r"\bbusiness\b|\bequipment\b|\bguarant|\bfloor plan\b|\bco-?maker\b", re.I)),
    ("personal", "Personal loan or note", re.compile(r"\bpersonal\b|\bnote payable\b|\bpromissory\b|\bnote\b", re.I)),
]
BUCKET_LABELS = {"residence": "Secured by a residence (not subtracted)",
                 **{k: label for k, label, _ in LIABILITY_BUCKETS}, "other": "Other or unclear"}


def liability_bucket(kind: str | None, creditor: str | None, residence_secured: bool) -> str:
    """The bucket of one liability row from its filed type text (creditor text only as a fallback for margin)."""
    if residence_secured:
        return "residence"
    text = kind or ""
    for key, _, rx in LIABILITY_BUCKETS:
        if rx.search(text):
            return key
    if LIABILITY_BUCKETS[0][2].search(creditor or ""):
        return "margin"
    return "other"


def range_change(first: dict[str, Any], latest: dict[str, Any]) -> dict[str, Any]:
    """Possible change between two disclosed net worth ranges: latest low - first high to latest high - first
    low. Unknown (both null) unless both figures are full ranges ("range"): an open-ended band, an open-ended
    liability or an unvalued item leaves a bound unknown."""
    full = first["label"] == "range" and latest["label"] == "range" and None not in (
        first["low"], first["high"], latest["low"], latest["high"])
    return {"low": latest["low"] - first["high"] if full else None,
            "high": latest["high"] - first["low"] if full else None}


def tenure_change(years: dict[str, Any]) -> dict[str, Any] | None:
    """First used report year against the latest; None with fewer than two report years."""
    ys = sorted(int(y) for y in years)
    if len(ys) < 2:
        return None
    f, l = years[str(ys[0])]["net_worth"], years[str(ys[-1])]["net_worth"]
    keep = ("low", "high", "high_valued", "label")
    ch = range_change(f, l)
    return {"first_year": ys[0], "latest_year": ys[-1], "years_between": ys[-1] - ys[0],
            "reports_between": len(ys) - 2,
            "first": {k: f[k] for k in keep}, "latest": {k: l[k] for k in keep},
            "change": ch, "known": ch["low"] is not None,
            "comparable": f["label"] == l["label"],
            "doc_first": years[str(ys[0])]["doc"], "doc_latest": years[str(ys[-1])]["doc"]}


def share_range(liab: dict[str, Any], assets: dict[str, Any]) -> dict[str, Any]:
    """Liabilities (not residence-secured) as a share of disclosed assets: low / high to high / low; a bound is
    null when an input is open-ended, unvalued or zero."""
    lo = liab["low"] / assets["high"] if assets["high"] else None
    hi = liab["high"] / assets["low"] if liab["high"] is not None and assets["low"] else None
    return {"low": None if lo is None else round(lo, 4), "high": None if hi is None else round(hi, 4)}


LEV_COLS = ["year", "n", "low", "high", "residence_low", "residence_high", "share_low", "share_high", "by_type"]
FLAG_COLS = ["year", "creditor", "type", "owner", "low", "high", "doc"]


def leverage(years: dict[str, Any]) -> dict[str, Any]:
    """Per report year: all liabilities as a range, the residence-secured part, the share of disclosed assets
    (non-residence liabilities only, as in the net worth range), and the breakdown by bucket ([n, low, high]).
    Also creditors that recur in more than one report year (exact normalised name; creditor as filed), and every
    margin or securities-backed loan, as filed."""
    rows, flags = [], []
    cred: dict[str, dict[str, Any]] = defaultdict(lambda: {"names": {}, "years": set()})
    buckets_seen: dict[str, int] = defaultdict(int)
    for y in sorted(years, key=int):
        yr = years[y]
        ls = yr["liabilities"]["rows"]
        allsum = band_sum([(r[L_LOW], r[L_HIGH]) for r in ls])
        by: dict[str, list] = defaultdict(list)
        for r in ls:
            b = liability_bucket(r[L_TYPE], r[L_CRED], bool(r[L_RES]))
            by[b].append(r)
            buckets_seen[b] += 1
            nk = normalise_name(r[L_CRED] or "")
            if nk:
                cred[nk]["names"][int(y)] = r[L_CRED]
                cred[nk]["years"].add(int(y))
            if b == "margin":
                flags.append([int(y), r[L_CRED], r[L_TYPE], r[3], r[L_LOW], r[L_HIGH], r[-1]])
        by_type = {}
        for b, rs in sorted(by.items()):
            s = band_sum([(r[L_LOW], r[L_HIGH]) for r in rs])
            by_type[b] = [s["n"], s["low"], s["high"]]
        res = yr["totals"]["liabilities_residence_secured"]
        sh = share_range(yr["totals"]["liabilities"], yr["totals"]["assets"])
        rows.append([int(y), allsum["n"], allsum["low"] if ls else 0, allsum["high"] if ls else 0, res["low"],
                     res["high"], sh["low"], sh["high"], by_type])
    recurring = sorted(([v["names"][max(v["years"])], sorted(v["years"])] for v in cred.values() if len(v["years"]) > 1),
                       key=lambda r: (-len(r[1]), r[0]))
    return {"by_year": {"cols": LEV_COLS, "rows": rows}, "buckets": BUCKET_LABELS,
            "recurring_creditors": {"cols": ["creditor", "years"], "rows": recurring},
            "margin_loans": {"cols": FLAG_COLS, "rows": flags}, "bucket_rows": dict(sorted(buckets_seen.items()))}
