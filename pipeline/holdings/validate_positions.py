"""Checks for the position timelines, the change since the first report and leverage; called by
pipeline.holdings.validate. Re-derives every snapshot sum from the holdings rows (range rules), checks that every
snapshot and trade cites a filing with an official URL, re-classifies every transition, and checks the counts
against the per-member summaries and holdings-index.json. Writes the hand-check sample of 20 asset timelines
(pipeline/build/timeline-sample.csv; docs/validation/timeline-sample.csv only when that file does not exist).
"""
from __future__ import annotations

import csv
import random
import re
from collections import Counter
from typing import Any

from ..util import BUILD, OUT, ROOT, read_json
from . import positions as P
from . import profile
from .ranges import band_sum
from .run import HOLD_DIR, INDEX, INDEX_EXTRA

SEED = 20261115
SAMPLE = BUILD / "timeline-sample.csv"
REVIEWED_SAMPLE = ROOT / "docs" / "validation" / "timeline-sample.csv"
PTR_URL = re.compile(r"^https://(?:disclosures-clerk\.house\.gov/public_disc/ptr-pdfs/\d{4}/\d+\.pdf|efdsearch\.senate\.gov/\S+)$")
ANNUAL_URL = re.compile(r"^https://disclosures-clerk\.house\.gov/public_disc/financial-pdfs/\d{4}/\d+\.pdf$")


def rows_of(t: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


def check_member(c: Any, mid: str, m: dict[str, Any], pos: dict[str, Any], picks: list) -> Counter:
    """One member's positions file against its holdings file and published trade file."""
    for k in ("assets", "snapshots", "trades", "transitions"):
        c.check(pos[k]["cols"] == getattr(P, {"assets": "ASSET_COLS", "snapshots": "SNAP_COLS", "trades": "TRADE_COLS",
                                               "transitions": "TRANS_COLS"}[k]), "positions cols", f"{mid} {k}")
    tp = OUT / "trades" / f"{mid}.json"
    tf = read_json(tp) if tp.exists() else {"cols": [], "rows": [], "filings": {}}
    tby = {t["id"]: t for t in rows_of(tf)}
    assets = rows_of(pos["assets"])
    c.check(len({a["key"] for a in assets}) == len(assets), "asset keys unique", mid)
    used = sorted(int(y) for y in m["years"])
    c.check(pos["years"] == used, "positions years equal used report years", mid)
    snaps: dict[int, dict[int, dict[str, Any]]] = {}
    for s in rows_of(pos["snapshots"]):
        snaps.setdefault(s["a"], {})[s["year"]] = s
        yr = m["years"].get(str(s["year"]))
        c.check(yr is not None and s["doc"] == yr["doc"] and m["docs"][s["doc"]]["used"]
                and bool(ANNUAL_URL.match(pos["docs"].get(s["doc"]) or "")), "snapshot cites the used annual report", f"{mid} {s['year']}")
        lines = [r for r in (yr or {"assets": {"rows": []}})["assets"]["rows"] if r[0] in set(s["rows"])]
        c.check(len(lines) == s["lines"] == len(s["rows"]), "snapshot rows exist", f"{mid} {s['year']} {s['a']}")
        b = band_sum([(r[7], r[8]) for r in lines])
        c.check((b["low"], b["high"], b["unvalued"], b["open_ended"]) == (s["low"], s["high"], s["unvalued"], s["open_ended"]),
                "snapshot sum follows the range rules", f"{mid} {s['year']} {s['a']}")
        c.check(s["owners"] == sorted({r[6] for r in lines}), "snapshot owners as filed", f"{mid} {s['year']}")
    keys, _ = P.keys_for_rows([r for y in used for r in m["years"][str(y)]["assets"]["rows"]])
    c.check(set(keys) == {a["key"] for a in assets}, "every asset row is in exactly one timeline", mid)
    tr: dict[int, list[dict[str, Any]]] = {}
    for t in rows_of(pos["trades"]):
        tr.setdefault(t["a"], []).append(t)
        src = tby.get(t["id"])
        c.check(src is not None and src["date"] == t["date"] and src["action"] == t["action"] and src["low"] == t["low"]
                and src["high"] == t["high"] and src["owner"] == t["owner"], "timeline trade equals the published trade", f"{mid} {t['id']}")
        c.check(bool(PTR_URL.match(pos["filings"].get(t["doc"]) or "")), "timeline trade cites a filing URL", f"{mid} {t['id']}")
    counts = Counter()
    for x in rows_of(pos["transitions"]):
        sa, sb = snaps.get(x["a"], {}).get(x["from"]), snaps.get(x["a"], {}).get(x["to"])
        win = [t for t in tr.get(x["a"], []) if x["from"] < int(t["date"][:4]) <= x["to"]]
        n = Counter(t["action"] for t in win)
        last = sum(1 for t in tr.get(x["a"], []) if int(t["date"][:4]) == x["from"] and t["action"] in ("sell", "exchange")) \
            if sa and not sb else 0
        change = P.compare(sa, sb) if sa and sb else None
        want = P.classify(sa is not None, sb is not None, change, n["buy"], n["sell"], n["exchange"], last)
        c.check((x["change"], x["buys"], x["sells"], x["exchanges"], x["sold_last_listed_year"], x["class"]) ==
                (change, n["buy"], n["sell"], n["exchange"], last, want), "transition re-classified by rule", f"{mid} {x['a']} {x['from']}")
        c.check(used.index(x["to"]) == used.index(x["from"]) + 1, "transition joins consecutive used reports", mid)
        counts[x["class"]] += 1
    s = pos["summary"]
    c.check(s == m.get("positions_summary"), "positions summary equals the holdings file's", mid)
    c.check(all(counts[k] == s["transitions"][k] for k in P.CLASSES), "transition counts equal the summary", mid)
    c.check(s["assets"] == len(assets) and s["assets_with_trades"] == sum(1 for a in assets if a["trades"]), "asset counts", mid)
    c.check(s["trades_matched"] == len(pos["trades"]["rows"]), "matched trade count", mid)
    c.check(s["trades_matched"] + s["trades_in_unlisted_assets"] + s["trades_undated"] == len(tby), "every trade accounted for", mid)
    # change since first report and leverage, re-derived
    c.check(m.get("tenure_change") == profile.tenure_change(m["years"]), "change since first report re-derived", mid)
    c.check(m.get("leverage") == profile.leverage(m["years"]), "leverage re-derived", mid)
    tc = m.get("tenure_change")
    if tc and tc["known"]:
        c.check(tc["change"]["low"] <= tc["change"]["high"], "change range ordered", mid)
    for a_i, a in enumerate(assets):
        picks.append((mid, a_i, a))
    return counts


def write_sample(picks: list) -> None:
    pick = random.Random(SEED).sample(sorted(picks, key=lambda p: (p[0], p[1])), min(20, len(picks)))
    cache = {mid: read_json(HOLD_DIR / "positions" / f"{mid}.json") for mid in {p[0] for p in pick}}
    SAMPLE.parent.mkdir(parents=True, exist_ok=True)
    with open(SAMPLE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["member", "asset", "asset_key", "status", "snapshots (report year: band; owners; filing)",
                    "trades (date action band owner; filing)", "transitions (from-to: class)", "checked_by",
                    "matches_filings", "comment"])
        for mid, a_i, a in pick:
            pos = cache[mid]
            sn = [s for s in rows_of(pos["snapshots"]) if s["a"] == a_i]
            ts = [t for t in rows_of(pos["trades"]) if t["a"] == a_i]
            xs = [x for x in rows_of(pos["transitions"]) if x["a"] == a_i]
            band = lambda lo, hi: f"{lo}-{'open' if hi is None else hi}"
            w.writerow([mid, a["name"], a["key"], "; ".join(" ".join(map(str, s)) for s in a["status"]),
                        " | ".join(f"{s['year']}: {band(s['low'], s['high']) if not s['unvalued'] else str(s['low']) + '-unknown (' + str(s['unvalued']) + ' line(s) with no value)'}; "
                                   f"{','.join(s['owners'])}; {pos['docs'][s['doc']]}" for s in sn),
                        " | ".join(f"{t['date']} {t['action']} {band(t['low'], t['high'])} {t['owner']}; {pos['filings'][t['doc']]}" for t in ts),
                        " | ".join(f"{x['from']}-{x['to']}: {x['class']}" for x in xs), "", "", ""])
    if not REVIEWED_SAMPLE.exists():
        REVIEWED_SAMPLE.write_bytes(SAMPLE.read_bytes())


def run_checks(c: Any) -> dict[str, Any]:
    index = read_json(INDEX)
    cols = index["cols"]
    c.check(cols[-len(INDEX_EXTRA):] == INDEX_EXTRA, "index has the positions columns")
    picks: list = []
    total = Counter()
    for r in index["rows"]:
        row = dict(zip(cols, r))
        mid = row["id"]
        p = HOLD_DIR / "positions" / f"{mid}.json"
        c.check(p.exists(), "positions file per holdings file", mid)
        if not p.exists():
            continue
        m, pos = read_json(HOLD_DIR / f"{mid}.json"), read_json(p)
        total += check_member(c, mid, m, pos, picks)
        s = pos["summary"]
        c.check([row["pos_assets"], row["pos_consistent"], row["pos_unexplained_appearance"],
                 row["pos_unexplained_disappearance"], row["pos_band_change_no_trade"], row["pos_share_with_trades"]]
                == [s["assets"], *(s["transitions"][k] for k in P.CLASSES[:4]), s["share_with_trades"]], "index equals positions summary", mid)
        tc = m.get("tenure_change")
        c.check([row["nw_first_year"], row["nw_change_low"], row["nw_change_high"], row["nw_comparable"]] ==
                ([tc["first_year"], tc["change"]["low"], tc["change"]["high"], tc["comparable"]] if tc else [None] * 4),
                "index equals change since first report", mid)
    write_sample(picks)
    return dict(total)
