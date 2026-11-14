"""Validate the holdings output: python -m pipeline.holdings.validate [--no-pdf].

Checks schema, that totals and net-worth ranges equal the sums of their rows, that no owner is defaulted, that every
row cites a used document with an official URL, that joins kept row counts, that no residence or street address is
published, and the owns plug-in edges. Writes docs/validation/holdings-sample.csv: 25 asset rows (fixed seed) with the
filing URL beside the parsed fields, machine-checked against the PDF text layer (pdftotext), and empty
checked_by / matches_filing / comment columns for a human. Exits 1 on any failed check.
"""
from __future__ import annotations

import csv
import random
import re
import subprocess
import sys
from collections import Counter
from typing import Any

import duckdb

from ..util import BUILD, CACHE, ROOT, SOURCES_DIR, fetch, read_json, read_jsonl, write_json
from . import rules
from .run import ASSET_COLS, EDGE_FILE, HOLD_DIR, INDEX, LIAB_COLS, band_sum, net_worth

SEED = 20261113
SAMPLE = ROOT / "docs" / "validation" / "holdings-sample.csv"
OWNERS = {"unspecified", "spouse", "joint", "dependent"}
URL = re.compile(r"^https://disclosures-clerk\.house\.gov/public_disc/financial-pdfs/\d{4}/\d+\.pdf$")


class Checks:
    def __init__(self) -> None:
        self.n = Counter()
        self.fail: list[str] = []

    def check(self, ok: bool, what: str, where: str = "") -> None:
        self.n[what] += 1
        if not ok:
            self.fail.append(f"{what}: {where}")


def check_member(c: Checks, mid: str, m: dict[str, Any]) -> None:
    c.check(set(m) >= {"member", "docs", "years", "portfolio", "overlaps", "coverage", "net_worth_definition"}, "member keys", mid)
    for y, yr in m["years"].items():
        c.check(yr["assets"]["cols"] == ASSET_COLS and yr["liabilities"]["cols"] == LIAB_COLS, "cols", f"{mid} {y}")
        c.check(m["docs"].get(yr["doc"], {}).get("used") is True, "year doc is used", f"{mid} {y}")
        a_rows, l_rows = yr["assets"]["rows"], yr["liabilities"]["rows"]
        for r in a_rows:
            d = dict(zip(ASSET_COLS, r))
            c.check(len(r) == len(ASSET_COLS), "asset row length", f"{mid} {y}")
            c.check(d["owner"] in OWNERS, "asset owner in enum (never self by default)", f"{mid} {y} {d['row']}")
            c.check(d["doc"] == yr["doc"] and bool(URL.match(m["docs"][d["doc"]]["url"])), "asset cites used doc with URL", f"{mid} {y}")
            c.check(d["low"] is None or d["high"] is None or d["low"] <= d["high"], "band order", f"{mid} {y}")
            c.check(d["low"] is not None or d["high"] is None, "no high without low", f"{mid} {y}")
            c.check((d["ticker"] is None) == (d["ticker_source"] is None), "ticker_source iff ticker", f"{mid} {y}")
            c.check(d["org"] is None or d["ticker"] is not None, "org only from ticker", f"{mid} {y}")
            c.check(not rules.is_personal_residence(d["asset"], d["income_type"]), "no residence published", f"{mid} {y} {d['row']}")
            c.check(not rules.A1.search(d["asset"] or ""), "no street address (A1) in asset", f"{mid} {y} {d['row']}")
            c.check(d["location"] is None or d["location"].count(",") <= 1, "location at most city, state", f"{mid} {y}")
        for r in l_rows:
            d = dict(zip(LIAB_COLS, r))
            c.check(d["owner"] in OWNERS, "liability owner in enum", f"{mid} {y}")
            c.check(d["doc"] == yr["doc"], "liability cites used doc", f"{mid} {y}")
            c.check(d["low"] is not None, "liability has a band", f"{mid} {y}")
        t = yr["totals"]
        a = band_sum([(r[7], r[8]) for r in a_rows])
        lc = band_sum([(r[4], r[5]) for r in l_rows if not r[7]])
        lr = band_sum([(r[4], r[5]) for r in l_rows if r[7]])
        c.check(t["assets"] == a, "asset totals equal row sums", f"{mid} {y}")
        c.check(t["liabilities"] == lc and t["liabilities_residence_secured"] == lr, "liability totals equal row sums", f"{mid} {y}")
        c.check(sum(v["n"] for v in t["assets_by_owner"].values()) == a["n"]
                and sum(v["low"] for v in t["assets_by_owner"].values()) == a["low"], "owner split sums to totals", f"{mid} {y}")
        c.check(yr["net_worth"] == net_worth(a, lc), "net worth recomputes", f"{mid} {y}")
        nw = yr["net_worth"]
        c.check(nw["low"] is None or nw["high"] is None or nw["low"] <= nw["high"], "net worth low <= high", f"{mid} {y}")
    p = m["portfolio"]
    latest = m["years"][str(p["year"])]
    c.check(p["year"] == max(int(y) for y in m["years"]), "portfolio is latest year", mid)
    c.check(sum(r[4] for r in p["rows"]) == latest["totals"]["assets"]["n"], "portfolio rows cover every asset", mid)
    c.check(sum(r[5] for r in p["rows"]) == latest["totals"]["assets"]["low"], "portfolio lows sum to total", mid)
    for o in m["overlaps"]:
        c.check(bool(o["ties"]) and bool(URL.match(o["holding"]["url"])), "overlap has ties and filing URL", mid)


def check_edges(c: Checks, sources: set[str], members: set[str]) -> int:
    n = 0
    seen = set()
    for e in read_jsonl(EDGE_FILE):
        n += 1
        eid = f"{e['from']['id']}->{e['to']['id']}"
        c.check((e["from"]["id"], e["to"]["id"]) not in seen, "one owns edge per member and org", eid)
        seen.add((e["from"]["id"], e["to"]["id"]))
        c.check(e["type"] == "owns" and e["family"] == "holding" and e["basis"] == "filed" and "id" not in e, "edge type/family/basis", eid)
        c.check(e["from"]["id"] in members and e["to"]["id"][:3] in ("co:", "tk:"), "edge endpoints", eid)
        c.check(1 <= len(e["evidence"]) <= 5 and all(ev["source"] in sources and URL.match(ev["url"] or "") for ev in e["evidence"]),
                "edge evidence cites a listed source and URL", eid)
        by = e["by_year"]
        c.check(sum(b["n"] for b in by) == e["count"], "by_year n sums to count", eid)
        c.check(len(by) == 1 and {k: by[0][k] for k in ("low", "high", "exact")} == e["amount"], "by_year amounts equal totals", eid)
    return n


def pdf_text(doc: str, url: str) -> str | None:
    path = CACHE / "house_fd_pdfs" / f"{doc}.pdf"
    try:
        fetch(url, path)
    except Exception as e:  # noqa: BLE001
        return f"__error__ {e}"
    out = subprocess.run(["pdftotext", "-q", str(path), "-"], capture_output=True, text=True, timeout=120)
    return out.stdout


def machine_check(raw_asset: str, lo: int | None, hi: int | None, text: str | None) -> tuple[str, str, str]:
    if text is None or text.startswith("__error__"):
        return "", "", f"pdf not checked: {text}"
    if len(text.strip()) < 200:
        return "", "", "no text layer"
    flat = re.sub(r"\s+", "", text).casefold()
    seg = raw_asset.split("⇒")[-1]
    words = [w for w in re.findall(r"[A-Za-z0-9]{3,}", seg)]
    found = sum(1 for w in words if w.casefold() in flat)
    if lo is None:
        val = "yes" if re.search(r"none|undetermined", flat) else "no"
    else:
        want = [f"${lo:,}"] + ([f"${hi:,}"] if hi is not None else [])
        val = "yes" if all(w.casefold() in flat for w in want) else "no"
    return f"{found}/{len(words)}", val, ""


def sample(c: Checks, pdf: bool) -> dict[str, Any]:
    rows = read_json(BUILD / "holdings_rows.json")
    pick = random.Random(SEED).sample(rows, 25)
    root = next(CACHE.glob("hf/ziplime-*/data/holdings"))
    con = duckdb.connect()
    ids = ",".join(f"'{r['dataset_id']}'" for r in pick)
    raw = dict(con.execute(f"select id, asset_name from read_parquet('{root}/holdings-house.parquet') where id in ({ids})").fetchall())
    c.check(len(raw) == 25, "sample rows found in source parquet")
    spine = read_json(BUILD / "spine.json")
    SAMPLE.parent.mkdir(parents=True, exist_ok=True)
    stats = Counter()
    with open(SAMPLE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["member", "name", "report_year", "dataset_id", "asset_published", "asset_as_extracted", "ticker", "org",
                    "owner", "value_low", "value_high", "income_type", "income_low", "income_high", "doc", "filing_url",
                    "machine_asset_words_found", "machine_value_band_found", "machine_note",
                    "checked_by", "matches_filing", "comment"])
        for r in pick:
            text = pdf_text(r["doc"], r["url"]) if pdf else None
            words, val, note = machine_check(raw[r["dataset_id"]], r["low"], r["high"], text) if pdf else ("", "", "not run")
            if words:
                a, b = map(int, words.split("/"))
                stats["asset_all_words" if a == b else "asset_some_words_missing"] += 1
                stats[f"value_{val}"] += 1
            else:
                stats["not_checked"] += 1
            asset_raw = raw[r["dataset_id"]] if raw[r["dataset_id"]] == r["asset"] else "(redacted; see filing)"
            w.writerow([r["member"], spine[r["member"]]["name"], r["year"], r["dataset_id"], r["asset"], asset_raw, r["ticker"],
                        r["org"], r["owner"], r["low"], r["high"], r["income_type"], r["income_low"], r["income_high"],
                        r["doc"], r["url"], words, val, note, "", "", ""])
    return dict(stats)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    c = Checks()
    src = read_json(SOURCES_DIR / "holdings.json")
    rep = src["report"]
    for k, j in rep["joins"].items():
        c.check(j["before"] == j["after"] and j["unmatched"] == 0, "join kept row count", k)
    index = read_json(INDEX)
    ids = {r[0] for r in index["rows"]}
    files = {p.stem for p in HOLD_DIR.glob("*.json")}
    c.check(ids == files, "index lists exactly the member files")
    n_assets = 0
    for mid in sorted(files):
        m = read_json(HOLD_DIR / f"{mid}.json")
        check_member(c, mid, m)
        n_assets += sum(len(y["assets"]["rows"]) for y in m["years"].values())
    c.check(n_assets == rep["asset_rows_published"], "published asset rows equal the report count")
    n_edges = check_edges(c, set(src["sources"]), files)
    c.check(n_edges == rep["owns_edges"], "edge count equals report")
    stats = sample(c, "--no-pdf" not in argv)
    print(f"checks: {sum(c.n.values())} in {len(c.n)} kinds; failures: {len(c.fail)}; sample: {stats}")
    for f in c.fail[:30]:
        print("  FAIL", f)
    result = {"checks": sum(c.n.values()), "kinds": dict(c.n), "failures": len(c.fail), "first_failures": c.fail[:30],
              "sample": stats, "sample_file": str(SAMPLE.relative_to(ROOT)), "seed": SEED}
    src["report"]["validation"] = result

    write_json(SOURCES_DIR / "holdings.json", src, pretty=True)
    return 1 if c.fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
