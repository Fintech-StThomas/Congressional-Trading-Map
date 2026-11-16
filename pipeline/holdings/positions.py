"""Position timeline per asset: the yearly holdings snapshots of one House member joined with the household trades
filed between them, and each year-to-year transition classified by an explicit rule.

Pure functions (no I/O); run.py calls build() per member and writes holdings/positions/<id>.json. The rules are the
contract in docs/data-dictionary.md ("Position timelines"). They describe what the records show and never
explain it: a classification is a fact about two filings and the trades between them, not a finding about a person.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from ..util import normalise_name
from .ranges import band_sum

# Holdings asset row columns (run.ASSET_COLS order), by name.
A_ROW, A_TEXT, A_ORG, A_CAT, A_OWNER, A_LOW, A_HIGH, A_LOC, A_DOC = 0, 1, 4, 5, 6, 7, 8, 12, 13

ASSET_COLS = ["key", "name", "org", "ticker", "kind", "first", "last", "years", "trades", "latest_low",
              "latest_high", "status"]
SNAP_COLS = ["a", "year", "low", "high", "lines", "unvalued", "open_ended", "owners", "rows", "doc"]
TRADE_COLS = ["a", "id", "date", "action", "low", "high", "owner", "doc"]
TRANS_COLS = ["a", "from", "to", "gap", "change", "buys", "sells", "exchanges", "sold_last_listed_year", "class",
              "owner_change"]

# Transition classes. The first four are the ones summarised on the site; the rest complete the partition.
CLASSES = ["consistent", "unexplained_appearance", "unexplained_disappearance", "band_change_no_trade",
           "contrary", "traded_same_band", "unchanged", "not_comparable", "traded_while_unlisted"]


def issuer_text(text: str) -> str:
    """The issuer part of an asset as filed: the last segment of "Account ⇒ Sub-account ⇒ Asset", without
    parenthesised tickers or bracketed codes."""
    seg = (text or "").split("⇒")[-1]
    seg = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", seg)
    return re.sub(r"\s+", " ", seg).strip()


def name_key(text: str, location: str | None = None) -> str:
    """Exact normalised issuer name (util.normalise_name); never a similarity measure. When the issuer part was
    redacted (a street address or a minor's name), the whole text is used instead, and real property carries its
    filed city/state, so that two redacted or generically named properties are not joined."""
    seg = issuer_text(text)
    base = normalise_name(text or "") if "redacted]" in (text or "").split("⇒")[-1] or not normalise_name(seg) else normalise_name(seg)
    return base + (f" @{normalise_name(location)}" if location else "")


def option_suffix(is_option: bool) -> str:
    return "|option" if is_option else ""


def asset_kind(org: str | None, categories: set[str], trade_classes: set[str], companies: dict[str, Any]) -> str:
    """The asset's class from filed or registry facts only (no inference from names): an option or bond by the
    holdings category; "fund" when SEC lists the issuer as a pooled vehicle or a filed trade says fund; "stock"
    when SEC lists an operating company with a SIC code; otherwise "unlabelled"."""
    if "option" in categories or "option" in trade_classes:
        return "option"
    c = companies.get(org or "")
    if (c and c.get("pooled_vehicle")) or "fund" in trade_classes:
        return "fund"
    if "bond" in categories or "bond" in trade_classes:
        return "bond"
    if c and c.get("sic"):
        return "stock"
    return "unlabelled"


def keys_for_rows(rows: list[list[Any]]) -> tuple[list[str], dict[str, str]]:
    """Asset key per holdings row of one member (all years), and the name -> key map used for trades.
    A resolved org is the key (a separate key for options). An unresolved ticker (tk:) joins a co: org of this
    member with exactly the same normalised issuer name (a ticker that changed); a row without a ticker joins the
    one org of this member with exactly its normalised issuer name; any other row is keyed by that name. Exact
    equality only, never similarity."""
    co: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        if r[A_ORG] and r[A_ORG].startswith("co:"):
            co[name_key(r[A_TEXT]) + option_suffix(r[A_CAT] == "option")].add(r[A_ORG])

    def canon(org: str, nk: str) -> str:
        c = co.get(nk, set())
        return next(iter(c)) if org.startswith("tk:") and len(c) == 1 else org
    orgs: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        if r[A_ORG]:
            nk = name_key(r[A_TEXT]) + option_suffix(r[A_CAT] == "option")
            orgs[nk].add(canon(r[A_ORG], nk))
    out = []
    for r in rows:
        opt = option_suffix(r[A_CAT] == "option")
        nk = name_key(r[A_TEXT]) + opt
        if not r[A_ORG] and r[A_LOC]:
            out.append("name:" + name_key(r[A_TEXT], r[A_LOC]) + opt)
        elif r[A_ORG]:
            out.append(canon(r[A_ORG], nk) + opt)
        elif len(orgs.get(nk, ())) == 1:
            out.append(next(iter(orgs[nk])) + opt)
        else:
            out.append("name:" + nk)
    alias = {nk: next(iter(v)) + ("|option" if nk.endswith("|option") else "") for nk, v in orgs.items() if len(v) == 1}
    return out, alias


def trade_key(t: dict[str, Any], keys: set[str], alias: dict[str, str]) -> str | None:
    """The asset key a trade belongs to, by the same rules; None when no listed asset has that key."""
    opt = option_suffix(t["asset_class"] == "option")
    cands = []
    if t["org"]:
        direct = t["org"] + opt
        if direct in keys:
            return direct
        # A resolved registry identity must never be replaced by a different same-name issuer.
        if t["org"].startswith("co:"):
            return None
        cands.append(direct)
    nk = name_key(t["asset"]) + opt
    cands += [alias.get(nk, ""), "name:" + nk]
    return next((k for k in cands if k in keys), None)


def snapshot(lines: list[list[Any]]) -> dict[str, Any]:
    """One asset in one report year: its lines summed under the range rules (an unvalued or open-ended line
    makes the high bound null)."""
    s = band_sum([(r[A_LOW], r[A_HIGH]) for r in lines])
    return {"low": s["low"], "high": s["high"], "lines": s["n"], "unvalued": s["unvalued"],
            "open_ended": s["open_ended"], "owners": sorted({r[A_OWNER] for r in lines}),
            "rows": [r[A_ROW] for r in lines], "doc": lines[0][A_DOC]}


def compare(a: dict[str, Any], b: dict[str, Any]) -> str:
    """Band change between two snapshots of the same asset: up, down, same, or unclear (a line without a value,
    or bands that cross)."""
    if a["unvalued"] or b["unvalued"]:
        return "unclear"
    inf = float("inf")
    la, ha = a["low"], inf if a["high"] is None else a["high"]
    lb, hb = b["low"], inf if b["high"] is None else b["high"]
    if (la, ha) == (lb, hb):
        return "same"
    if lb >= la and hb >= ha:
        return "up"
    if lb <= la and hb <= ha:
        return "down"
    return "unclear"


def classify(in_a: bool, in_b: bool, change: str | None, buys: int, sells: int, exchanges: int,
             sold_last_listed_year: int = 0) -> str | None:
    """The transition class (CLASSES) from the trades dated after report year A up to the end of report year B.
    A filed exchange can explain a move either way, since its direction is not filed. A disappearance is also
    explained by a sale or exchange dated in year A itself (sold_last_listed_year): a report lists an asset that
    earned income during the year even when it was sold before the year ended (often with no value). Returns None
    when the asset is listed in neither year and nothing was traded."""
    traded = buys + sells + exchanges
    if not in_a and not in_b:
        return "traded_while_unlisted" if traded else None
    if not in_a:
        return "consistent" if buys or exchanges else "unexplained_appearance"
    if not in_b:
        return "consistent" if sells or exchanges or sold_last_listed_year else "unexplained_disappearance"
    if change == "up":
        return "consistent" if buys or exchanges else ("contrary" if sells else "band_change_no_trade")
    if change == "down":
        return "consistent" if sells or exchanges else ("contrary" if buys else "band_change_no_trade")
    if change == "same":
        return "traded_same_band" if traded else "unchanged"
    return "not_comparable"


def status(present: list[int], used: list[int]) -> list[list[Any]]:
    """Plain status codes over the member's used report years (a year with no report is never read as "sold"):
    ["throughout", first, last] | ["from", y] (first listed after the member's first report) |
    ["again", y] (listed again after a used report that did not list it) | ["until", y] (not listed in a later
    used report)."""
    ps = set(present)
    if all(y in ps for y in used):
        return [["throughout", used[0], used[-1]]]
    out: list[list[Any]] = []
    if present[0] > used[0]:
        out.append(["from", present[0]])
    seen_absent = False
    for y in used:
        if y < present[0]:
            continue
        if y in ps and seen_absent:
            out.append(["again", y])
            seen_absent = False
        elif y not in ps:
            seen_absent = True
    if present[-1] < used[-1]:
        out.append(["until", present[-1]])
    return out


def build(years: dict[str, Any], trades: dict[str, Any] | None, companies: dict[str, Any]) -> dict[str, Any]:
    """The positions file body for one member (see the data dictionary) with its summary."""
    used = sorted(int(y) for y in years)
    rows = [r for y in used for r in years[str(y)]["assets"]["rows"]]
    row_year = [y for y in used for _ in years[str(y)]["assets"]["rows"]]
    keys, alias = keys_for_rows(rows)
    lines: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    for k, y, r in zip(keys, row_year, rows):
        lines[k][y].append(r)
    tcols = trades["cols"] if trades else []
    tlist = [dict(zip(tcols, t)) for t in (trades or {}).get("rows", [])]
    by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    tstats = Counter()
    for t in tlist:
        k = trade_key(t, set(lines), alias)
        if k is None:
            tstats["trades_in_unlisted_assets"] += 1
        elif not t["date"]:
            tstats["trades_undated"] += 1
        else:
            by_key[k].append(t)
    # Order assets by latest value band, largest first, then by key.
    def latest(k: str) -> dict[str, Any]:
        return snapshot(lines[k][max(lines[k])])
    order = sorted(lines, key=lambda k: (-max(lines[k]), -latest(k)["low"], k))
    a_rows, s_rows, t_rows, x_rows = [], [], [], []
    counts = Counter()
    docs: dict[str, str] = {}
    for i, k in enumerate(order):
        snaps = {y: snapshot(lines[k][y]) for y in sorted(lines[k])}
        present = sorted(snaps)
        ts = sorted(by_key.get(k, []), key=lambda t: (t["date"], t["id"]))
        first_lines = lines[k][present[-1]]
        org = k.split("|")[0] if not k.startswith("name:") else None
        filed = first_lines[0][A_TEXT].split("⇒")[-1].strip() or first_lines[0][A_TEXT]
        if first_lines[0][A_LOC]:
            filed += f" ({first_lines[0][A_LOC]})"
        name = (companies.get(org or "", {}).get("name") if org and org.startswith("co:") else None) or filed
        ticker = (first_lines[0][2] or (org[3:] if org and org.startswith("tk:") else None)) if org else None
        kind = asset_kind(org, {r[A_CAT] for y in lines[k] for r in lines[k][y]}, {t["asset_class"] for t in ts}, companies)
        last = snaps[present[-1]]
        a_rows.append([k, name, org, ticker, kind, present[0], present[-1], present, len(ts), last["low"], last["high"],
                       status(present, used)])
        counts["assets"] += 1
        counts["assets_with_trades"] += bool(ts)
        for y, s in snaps.items():
            s_rows.append([i, y, s["low"], s["high"], s["lines"], s["unvalued"], s["open_ended"], s["owners"], s["rows"], s["doc"]])
        for t in ts:
            t_rows.append([i, t["id"], t["date"], t["action"], t["low"], t["high"], t["owner"], t["doc"]])
            docs[t["doc"]] = (trades or {}).get("filings", {}).get(t["doc"])
            yr = int(t["date"][:4])
            counts["trades_matched"] += 1
            counts["trades_before_first_report"] += yr <= used[0]
            counts["trades_after_latest_report"] += yr > used[-1]
        for ya, yb in zip(used, used[1:]):
            win = [t for t in ts if ya < int(t["date"][:4]) <= yb]
            n = Counter(t["action"] for t in win)
            sa, sb = snaps.get(ya), snaps.get(yb)
            change = compare(sa, sb) if sa and sb else None
            last_year = sum(1 for t in ts if int(t["date"][:4]) == ya and t["action"] in ("sell", "exchange")) if sa and not sb else 0
            cls = classify(sa is not None, sb is not None, change, n["buy"], n["sell"], n["exchange"], last_year)
            if cls is None:
                continue
            x_rows.append([i, ya, yb, yb - ya - 1, change, n["buy"], n["sell"], n["exchange"], last_year, cls,
                           bool(sa and sb and sa["owners"] != sb["owners"])])
            counts[cls] += 1
    summary = {"assets": counts["assets"], "assets_with_trades": counts["assets_with_trades"],
               "share_with_trades": round(counts["assets_with_trades"] / counts["assets"], 4) if counts["assets"] else None,
               "transitions": {c: counts[c] for c in CLASSES},
               "trades_matched": counts["trades_matched"],
               "trades_before_first_report": counts["trades_before_first_report"],
               "trades_after_latest_report": counts["trades_after_latest_report"],
               "trades_in_unlisted_assets": tstats["trades_in_unlisted_assets"],
               "trades_undated": tstats["trades_undated"]}
    return {"years": used, "assets": {"cols": ASSET_COLS, "rows": a_rows},
            "snapshots": {"cols": SNAP_COLS, "rows": s_rows}, "trades": {"cols": TRADE_COLS, "rows": t_rows},
            "transitions": {"cols": TRANS_COLS, "rows": x_rows}, "filings": dict(sorted(docs.items())),
            "summary": summary}
