"""Company master: resolve filed tickers to SEC registrants by exact ticker, never by name.

Writes pipeline/build/ticker_orgs.json (ticker as filed -> org id), pipeline/build/companies.json
(org id -> company record with SIC) and pipeline/build/company_names.json (normalised name ->
org id, unique names only) for other modules (the FEC module matches PAC connected organisations
against it).
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date
from typing import Any

import pyarrow.parquet as pq
import requests

from .sic import POOLED_VEHICLE_SIC, sector
from .util import (BUILD, CACHE, CROSSWALK, DAY, SUFFIXES, RateLimiter, fetch, normalise_name, normalise_ticker,
                   print_table, read_json, write_json, write_source_meta)

SOURCE_ID = "sec"
TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
FSDS_URL = "https://www.sec.gov/files/dera/data/financial-statement-data-sets/{q}.zip"
FSDS_QUARTERS = 2
SEC_LIMIT = RateLimiter(10)
# Words too generic to show that a filed description and an SEC name refer to the same issuer.
GENERIC = {"A", "B", "C", "CL", "CLASS", "COM", "COMMON", "STOCK", "SHS", "SHARES", "ORD", "ORDINARY", "NEW",
           "ADR", "ADS", "SPONSORED", "INTERNATIONAL", "INTL", "AND", "OF", "US", "USA", "AMERICA", "AMERICAN",
           "NATIONAL", "FINANCIAL", "TRUST", "FUND", "CAPITAL", "SERIES", "PFD", "PREFERRED", "NA", "SA", "AG", "NV",
           "CMN", "SHARE", "CORPORATION", "INCORPORATED", "LIMITED", "ETF", "INDEX", "PLC"}


def load_overrides(source: str) -> dict[str, str]:
    """Reviewed rows of pipeline/crosswalk/org_overrides.csv whose `source` (case-insensitive) equals
    `source`; rows without reviewed_by are ignored, as in the FEC module."""
    with open(CROSSWALK / "org_overrides.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return {r["source_id_or_name"].strip(): r["org_id"].strip() for r in rows
            if (r.get("source") or "").strip().lower() == source and (r.get("reviewed_by") or "").strip()
            and r.get("source_id_or_name") and r.get("org_id")}


def recent_quarters(today: date, n: int) -> list[str]:
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(n + 3):  # the current quarter and maybe the last are not yet published
        q -= 1
        if q == 0:
            y, q = y - 1, 4
        out.append(f"{y}q{q}")
    return out


def fetch_sic() -> tuple[dict[int, int], list[str]]:
    """CIK -> SIC from the SEC Financial Statement Data Sets (sub.txt) of the latest quarters."""
    sic: dict[int, int] = {}
    used: list[str] = []
    for q in recent_quarters(date.today(), FSDS_QUARTERS):
        if len(used) == FSDS_QUARTERS:
            break
        try:
            path = CACHE / "sec" / f"fsds_{q}.zip"
            fetch(FSDS_URL.format(q=q), path, limiter=SEC_LIMIT)
        except requests.HTTPError:
            continue
        used.append(q)
        with zipfile.ZipFile(path) as z, z.open("sub.txt") as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"), delimiter="\t"):
                if row["sic"].strip().isdigit() and int(row["sic"]) > 0:
                    sic.setdefault(int(row["cik"]), int(row["sic"]))
    return sic, used


def significant_words(text: str) -> set[str]:
    words = re.sub(r"[^A-Z0-9]+", " ", re.sub(r"[.'\u2019]", "", text.upper())).split()
    return {w for w in words if len(w) > 1 and w not in GENERIC and w not in SUFFIXES}


def same_issuer_possible(filed: list[str], sec_name: str) -> bool:
    """False only when every filed description clearly names something else than the SEC registrant."""
    sec_words = significant_words(sec_name)
    sec_compact = "".join(sorted(sec_words))
    for d in filed:
        words = significant_words(d)
        if not words or not sec_words or words & sec_words:
            return True
        compact = re.sub(r"[^A-Z0-9]", "", d.upper())
        if any(w in compact for w in sec_words if len(w) > 2) or "".join(sec_words) in compact or sec_compact in compact:
            return True
    return False


def run() -> None:
    meta = fetch(TICKERS_URL, CACHE / "sec" / "company_tickers_exchange.json", max_age=DAY, limiter=SEC_LIMIT)
    sec = read_json(CACHE / "sec" / "company_tickers_exchange.json")
    fields = sec["fields"]
    registrants = [dict(zip(fields, r)) for r in sec["data"]]
    by_ticker: dict[str, set[int]] = defaultdict(set)
    names: dict[int, str] = {}
    for r in registrants:
        if r["ticker"]:
            by_ticker[normalise_ticker(r["ticker"])].add(r["cik"])
        names.setdefault(r["cik"], r["name"])
    sic, quarters = fetch_sic()

    table = pq.read_table(BUILD / "trades.parquet", columns=["ticker", "asset"]).to_pylist()
    descriptions: dict[str, list[str]] = defaultdict(list)
    for t in table:
        if t["ticker"]:
            descriptions[t["ticker"]].append(t["asset"])
    overrides = load_overrides("ticker")

    ticker_orgs: dict[str, str] = {}
    vetoed: dict[str, dict[str, Any]] = {}
    ambiguous: list[str] = []
    for ticker in sorted(descriptions):
        norm = normalise_ticker(ticker)
        ciks = by_ticker.get(norm, set())
        org = f"tk:{norm}"
        if len(ciks) > 1:
            ambiguous.append(ticker)
        elif len(ciks) == 1:
            cik = next(iter(ciks))
            # Veto (never add) a match when no filed description shares a word with the SEC name:
            # the symbol has probably been reassigned to a different issuer since the trade.
            if same_issuer_possible(descriptions[ticker], names[cik]):
                org = f"co:{cik}"
            else:
                vetoed[ticker] = {"sec_name": names[cik], "cik": cik, "filed_as": Counter(descriptions[ticker]).most_common(1)[0][0],
                                  "trades": len(descriptions[ticker])}
        ticker_orgs[ticker] = overrides.get(ticker) or overrides.get(norm) or org

    primary: dict[int, str] = {}
    for r in registrants:  # primary ticker = first listed by SEC for that CIK
        if r["ticker"]:
            primary.setdefault(r["cik"], r["ticker"])
    companies = {f"co:{cik}": {"name": name, "cik": cik, "sic": sic.get(cik), "sector": sector(sic.get(cik)),
                               "pooled_vehicle": sic.get(cik) in POOLED_VEHICLE_SIC, "ticker": primary.get(cik)}
                 for cik, name in names.items()}

    name_ids: dict[str, set[str]] = defaultdict(set)
    for org_id, c in companies.items():
        n = normalise_name(c["name"])
        if n:
            name_ids[n].add(org_id)
    company_names = {n: next(iter(ids)) for n, ids in sorted(name_ids.items()) if len(ids) == 1}

    write_json(BUILD / "ticker_orgs.json", ticker_orgs)
    write_json(BUILD / "companies.json", companies)
    write_json(BUILD / "company_names.json", company_names)

    trades_by_ticker = Counter(t["ticker"] for t in table if t["ticker"])
    unmatched = Counter({t: n for t, n in trades_by_ticker.items() if ticker_orgs[t].startswith("tk:")})
    matched_trades = sum(n for t, n in trades_by_ticker.items() if ticker_orgs[t].startswith("co:"))
    matched_ciks = {o for o in ticker_orgs.values() if o.startswith("co:")}
    with_sic = sum(1 for o in matched_ciks if companies[o]["sic"])
    print(f"tickers filed: {len(ticker_orgs)}; matched to SEC: {sum(o.startswith('co:') for o in ticker_orgs.values())}"
          f" ({len(matched_ciks)} companies, {with_sic} with SIC); trades with a ticker: {sum(trades_by_ticker.values())},"
          f" resolved to co: {matched_trades}")
    print(f"unmatched tickers: {len(unmatched)} covering {sum(unmatched.values())} trades; ambiguous: {len(ambiguous)};"
          f" vetoed reassigned symbols: {len(vetoed)}")
    print_table("top 25 unmatched tickers", unmatched.most_common(25), ("ticker", "trades"))
    print_table("top 15 vetoed (symbol now registered to a different-looking issuer)",
                [(t, v["trades"], v["filed_as"][:40], v["sec_name"][:40]) for t, v in
                 sorted(vetoed.items(), key=lambda x: -x[1]["trades"])[:15]], ("ticker", "trades", "filed as", "SEC name now"))
    print(f"company_names.json: {len(company_names)} unique normalised names")
    write_source_meta(SOURCE_ID, {SOURCE_ID: {
        "name": "SEC EDGAR company tickers and Financial Statement Data Sets (SIC)", "url": TICKERS_URL,
        "revision": meta.get("last_modified") or meta.get("etag"), "retrieved": meta["retrieved"],
        "licence": "U.S. government work (public domain)", "fsds_quarters": quarters,
        "files": [{"path": "company_tickers_exchange.json", "sha256": meta["sha256"], "rows": len(registrants)}],
    }}, {
        "sec_registrants": len(names), "sec_tickers": len(by_ticker), "tickers_filed": len(ticker_orgs),
        "tickers_matched": len(ticker_orgs) - len(unmatched), "tickers_unmatched": len(unmatched),
        "trades_unmatched_ticker": sum(unmatched.values()), "trades_matched_ticker": matched_trades,
        "top_unmatched": unmatched.most_common(100), "ambiguous_tickers": ambiguous,
        "vetoed_reassigned": vetoed, "overrides_applied": len(overrides), "company_names_unique": len(company_names),
        "notes": ["Current SEC tickers omit delisted and renamed companies; those trades keep a tk:<TICKER> node.",
                  "A ticker match is vetoed when no filed description shares a significant word with the SEC name."],
    })
