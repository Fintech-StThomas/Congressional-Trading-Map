"""Holdings, liabilities and the disclosed net-worth range from House annual financial disclosure reports.

Source: Hugging Face dataset ZipLime/congress-trading (pinned revision), tables holdings-house, liabilities-house
and filings. The dataset has no Senate annual reports, so this stage covers the House only. Rules are in
docs/data-dictionary.md ("Holdings and net worth") and pipeline/holdings/README.md.

Writes web/public/data/holdings/<bioguide>.json, web/public/data/holdings-index.json,
pipeline/build/edges/holdings_owns.jsonl, pipeline/build/orgs/holdings.jsonl, pipeline/build/sources/holdings.json
and pipeline/build/holdings_rows.json (every published asset row, for validate.py).
Run it after `assemble`: the assembler swaps web/public/data/ wholesale, and the overlaps read its member files.
"""
from __future__ import annotations

import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import duckdb

from ..companies import load_overrides, same_issuer_possible
from ..util import (BUILD, CACHE, EDGES_DIR, ORGS_DIR, OUT, SOURCES_DIR, clean_sec_name, normalise_name,
                    normalise_ticker, print_table, read_json, write_json, write_jsonl)
from . import rules
from .source import DATASET, SOURCE_ID, download, pinned_revision

HOLD_DIR = OUT / "holdings"
INDEX = OUT / "holdings-index.json"
EDGE_FILE = EDGES_DIR / "holdings_owns.jsonl"
HOUSE_GUIDE = "https://ethics.house.gov/wp-content/uploads/2026/04/2025-Final-Instruction-Guide.pdf"
SENATE_GUIDE = "https://www.ethics.senate.gov/public/index.cfm/financial-disclosure-instructions"
NET_WORTH = {
    "name": "disclosed net worth range",
    "rule": "low = sum of asset lows - sum of liability highs; high = sum of asset highs - sum of liability lows. "
            "Unvalued assets add 0 to low (a value is never negative) and make high null; high_valued is the same "
            "figure over valued assets only. An open-ended band (\"Over $X\") makes high null: the figure is then "
            "'at least' low. Liabilities secured by a personal residence are listed but not subtracted, because the "
            "residence itself is not reported.",
    "excludes": [
        "personal residences and non-rental second or vacation homes (not reported on Schedule A), and mortgages "
        "or home-equity loans on them (reported by Members on Schedule D, but left out of this figure)",
        "federal retirement benefits including the Thrift Savings Plan",
        "non-interest-bearing checking and savings deposits; personal property (cars, art, jewellery, furniture)",
        "debts owed to the filer by close relatives or without interest; term life insurance; HSA/FSA cash",
        "assets that were not reported because their value was $1,000 or less and income $200 or less; "
        "liabilities of $10,000 or less",
        "the spouse's assets when separated; underlying assets of excepted and qualified blind trusts",
        "assets held solely by a spouse or dependent child reported as 'Spouse/DC over $1,000,000' (open-ended)",
        "earned income, gifts, positions and agreements (Schedules C, E-J are not in the source dataset)",
    ],
    "caveats": [
        "asset values are as of the end of the reporting year; liabilities are the highest amount owed during it",
        "amounts are the disclosed bands; no midpoint is stored",
    ],
    "instructions": HOUSE_GUIDE,
}
ASSET_COLS = ["row", "asset", "ticker", "ticker_source", "org", "category", "owner", "low", "high",
              "income_type", "income_low", "income_high", "location", "doc"]
LIAB_COLS = ["row", "creditor", "type", "owner", "low", "high", "incurred", "residence_secured", "doc"]


def q(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def one(con: duckdb.DuckDBPyConnection, sql: str) -> Any:
    return con.execute(sql).fetchone()[0]


# ---------------------------------------------------------------- member resolution
def parse_district(sd: str | None) -> tuple[str, int] | None:
    m = re.fullmatch(r"([A-Z]{2})(\d{1,2}|AL)", (sd or "").strip().upper())
    if not m:
        return None
    state = {"AQ": "AS"}.get(m.group(1), m.group(1))  # the Clerk codes American Samoa "AQ"
    return state, 0 if m.group(2) == "AL" else int(m.group(2))


def same_district(term: dict[str, Any], sd: tuple[str, int]) -> bool:
    """At-large seats are district 0 in the spine; the Clerk codes some of them 01 (ND01)."""
    return term["state"] == sd[0] and (term["district"] == sd[1] or (term["district"] == 0 and sd[1] in (0, 1)))


def served_house(terms: list[dict[str, Any]], lo: str, hi: str) -> list[dict[str, Any]]:
    return [t for t in terms if t["chamber"] == "rep" and t["start"] <= hi and t["end"] > lo]


def ascii_name(s: str) -> str:
    return normalise_name(unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode())


def resolve_unlinked(spine: dict[str, Any], docs: list[dict[str, Any]]) -> dict[str, tuple[str, str]]:
    """Docs with no bioguide in the dataset: exact rule = same state and district, a House term overlapping
    the report year or the year after, and the filer's surname equal to the member's (normalised; any single
    surname word may match). Unique match only. Returns doc_id -> (bioguide, how)."""
    out: dict[str, tuple[str, str]] = {}
    for d in docs:
        sd = parse_district(d["state_district"])
        if not sd or not d["report_year"]:
            continue
        y = d["report_year"]
        last = ascii_name(d["member_last"] or "").split()
        cands = set()
        for mid, m in spine.items():
            lastn = ascii_name(m["last"]).split()
            if not lastn or not last or not (lastn == last or (len(lastn) == 1 and lastn[0] in last)):
                continue
            if any(same_district(t, sd) for t in served_house(m["terms"], f"{y}-01-01", f"{y + 1}-12-31")):
                cands.add(mid)
        if len(cands) == 1:
            out[d["doc_id"]] = (cands.pop(), "district_surname")
    return out


# ---------------------------------------------------------------- tickers
class TickerResolver:
    """Same rules as pipeline/companies.py: exact SEC ticker, unique CIK, veto when no filed description shares a
    significant word with the SEC name, reviewed overrides; a ticker already resolved for trades keeps that id."""

    def __init__(self, descriptions: dict[str, list[str]]) -> None:
        sec = read_json(CACHE / "sec" / "company_tickers_exchange.json")
        self.by_ticker: dict[str, set[int]] = defaultdict(set)
        self.names: dict[int, str] = {}
        for r in (dict(zip(sec["fields"], row)) for row in sec["data"]):
            if r["ticker"]:
                self.by_ticker[normalise_ticker(r["ticker"])].add(r["cik"])
            self.names.setdefault(r["cik"], clean_sec_name(r["name"]))
        self.trade_orgs = {normalise_ticker(k): v for k, v in read_json(BUILD / "ticker_orgs.json").items()}
        self.overrides = load_overrides("ticker")
        self.desc = descriptions
        self.stats: Counter[str] = Counter()
        self.vetoed: dict[str, str] = {}
        self.cache: dict[str, str] = {}

    def org(self, ticker: str) -> str:
        norm = normalise_ticker(ticker)
        if norm in self.cache:
            return self.cache[norm]
        if self.overrides.get(norm) or self.overrides.get(ticker):
            org, how = self.overrides.get(norm) or self.overrides[ticker], "override"
        elif norm in self.trade_orgs:
            org, how = self.trade_orgs[norm], "trades_ticker_orgs"
        else:
            ciks = self.by_ticker.get(norm, set())
            org, how = f"tk:{norm}", "unmatched" if not ciks else "ambiguous"
            if len(ciks) == 1:
                cik = next(iter(ciks))
                if same_issuer_possible(self.desc[norm], self.names[cik]):
                    org, how = f"co:{cik}", "sec_exact"
                else:
                    how = "vetoed"
                    self.vetoed[norm] = self.names[cik]
        self.stats[f"{how}:{'co' if org.startswith('co:') else 'tk'}"] += 1
        self.cache[norm] = org
        return org


def printed_ticker(asset: str, ticker: str | None) -> bool:
    """True when the ticker is printed in parentheses in the asset text (case-insensitive; the PDFs' small caps
    come out as 'aXP')."""
    if not ticker:
        return False
    want = normalise_ticker(ticker)
    return any(normalise_ticker(t) == want for t in re.findall(r"\(([A-Za-z0-9./\- ]{1,12})\)", asset or ""))


# ---------------------------------------------------------------- sums
def band_sum(items: list[tuple[int | None, int | None]]) -> dict[str, Any]:
    """Assets: lows add (unvalued count 0 toward low); high null if any item is unvalued or open-ended."""
    valued = [(lo, hi) for lo, hi in items if lo is not None]
    open_ended = sum(1 for lo, hi in valued if hi is None)
    unvalued = len(items) - len(valued)
    low = sum(lo for lo, _ in valued)
    high_valued = None if open_ended else sum(hi for _, hi in valued)
    return {"n": len(items), "unvalued": unvalued, "open_ended": open_ended, "low": low,
            "high": None if (open_ended or unvalued) else high_valued, "high_valued": high_valued}


def net_worth(a: dict[str, Any], l: dict[str, Any]) -> dict[str, Any]:
    low = None if l["high"] is None else a["low"] - l["high"]
    high = None if a["high"] is None else a["high"] - l["low"]
    high_valued = None if a["high_valued"] is None else a["high_valued"] - l["low"]
    if a["open_ended"]:
        label = "at least" if low is not None else "unbounded"
    elif a["unvalued"]:
        label = "valued items only"
    else:
        label = "range"
    return {"low": low, "high": high, "high_valued": high_valued, "label": label,
            "unvalued_assets": a["unvalued"], "open_ended_assets": a["open_ended"],
            "open_ended_liabilities": l["open_ended"]}


def fmt_band(lo: int | None, hi: int | None) -> str:
    if lo is None:
        return "value not stated"
    return f"over ${lo - 1:,}" if hi is None else f"${lo:,}-${hi:,}"


# ---------------------------------------------------------------- main
def load(con: duckdb.DuckDBPyConnection, root: Path) -> dict[str, Any]:
    d = root / "data"
    con.execute(f"create view h as select * exclude (inserted_at) from read_parquet('{d}/holdings/holdings-house.parquet')")
    con.execute(f"create view l as select * exclude (inserted_at) from read_parquet('{d}/liabilities/liabilities-house.parquet')")
    con.execute(f"""create view f as select doc_id, chamber, filing_type, raw_filing_type, member_first, member_last,
        state_district, bioguide_id, filing_date, source_url, pdf_class, extract_status,
        try_cast(nullif(regexp_extract(source_url, '/financial-pdfs/(\\d{{4}})/', 1), '') as int) as report_year
        from read_parquet('{d}/filings/filings.parquet')""")
    counts = {t: one(con, f"select count(*) from {t}") for t in ("h", "l", "f")}
    if one(con, "select count(*) - count(distinct doc_id) from f"):
        raise AssertionError("filings.doc_id is not unique")
    joins = {}
    for t in ("h", "l"):
        con.execute(f"create temp table {t}j as select {t}.*, f.filing_type, f.filing_date, f.report_year, "
                    f"f.member_last as f_last, f.state_district as f_sd from {t} left join f on f.doc_id = {t}.doc_id")
        after = one(con, f"select count(*) from {t}j")
        unmatched = one(con, f"select count(*) from {t}j where filing_type is null")
        joins[f"{t}_to_filings"] = {"before": counts[t], "after": after, "unmatched": unmatched}
        if after != counts[t] or unmatched:
            raise AssertionError(f"join {t} -> filings changed row count or left rows unmatched: {joins}")
    return {"counts": counts, "joins": joins}


def run() -> None:
    revision = pinned_revision()
    root, files, listed = download(revision)
    spine = read_json(BUILD / "spine.json")
    companies = read_json(BUILD / "companies.json")
    con = duckdb.connect()
    info = load(con, root)
    excl: dict[str, dict[str, Any]] = {}

    def exclude(key: str, rows: int, reason: str, **extra: Any) -> None:
        excl[key] = {"rows": rows, "reason": reason, **extra}

    # Senate check: what the revision offers for annual reports.
    senate_files = [p for p in listed if ("holding" in p or "liabilit" in p) and "senate" in p]
    senate_annual_filings = one(con, "select count(*) from f where chamber='senate' and filing_type not in ('ptr','amendment')")

    # ---- documents carrying holdings or liabilities, and their member
    docs = {r["doc_id"]: r for r in q(con, """
        select f.*, (select count(*) from hj where hj.doc_id=f.doc_id) as n_assets,
               (select count(*) from lj where lj.doc_id=f.doc_id) as n_liabs,
               coalesce((select any_value(bioguide_id) from hj where hj.doc_id=f.doc_id),
                        (select any_value(bioguide_id) from lj where lj.doc_id=f.doc_id)) as row_bioguide
        from f where doc_id in (select doc_id from hj union select doc_id from lj)""")}
    multi = one(con, """select count(*) from (select doc_id from (select doc_id, bioguide_id from hj union
                 select doc_id, bioguide_id from lj) group by 1 having count(distinct bioguide_id) > 1)""")
    if multi:
        raise AssertionError(f"{multi} documents carry more than one bioguide id")
    unlinked = [d for d in docs.values() if not d["row_bioguide"]]
    resolved = resolve_unlinked(spine, unlinked)
    for d in docs.values():
        if d["row_bioguide"]:
            d["member"], d["member_source"] = d["row_bioguide"], "dataset"
        elif d["doc_id"] in resolved:
            d["member"], d["member_source"] = resolved[d["doc_id"]]
        else:
            d["member"], d["member_source"] = None, None
    # Guard against the dataset's name-based resolver: the filing's district must be one the member held in the
    # report year or the year after (it assigns some candidates the id of a same-named former member).
    mismatch = []
    for d in docs.values():
        if d["member_source"] == "dataset" and d["member"] in spine:
            sd = parse_district(d["state_district"])
            y = d["report_year"] or 0
            ok = sd and y and any(same_district(t, sd)
                            for t in served_house(spine[d["member"]]["terms"], f"{y}-01-01", f"{y + 1}-12-31"))
            if not ok:
                mismatch.append(d)
                d["member"], d["member_source"] = None, None
    exclude("bioguide_district_mismatch", sum(d["n_assets"] for d in mismatch), "the dataset's bioguide id belongs "
            "to a member who did not hold the filing's district in the report year or the next (name collision)",
            liabilities=sum(d["n_liabs"] for d in mismatch),
            docs=[[d["doc_id"], f"{d['member_first']} {d['member_last']}", d["state_district"], d["row_bioguide"]] for d in mismatch])
    again = resolve_unlinked(spine, mismatch)
    for d in mismatch:
        if d["doc_id"] in again:
            d["member"], d["member_source"] = again[d["doc_id"]]
            resolved[d["doc_id"]] = again[d["doc_id"]]
    mismatch = [d for d in mismatch if d["doc_id"] not in again]
    excl["bioguide_district_mismatch"].update(rows=sum(d["n_assets"] for d in mismatch),
        liabilities=sum(d["n_liabs"] for d in mismatch), re_resolved_by_district_surname=len(again),
        docs=[[d["doc_id"], f"{d['member_first']} {d['member_last']}", d["state_district"], d["row_bioguide"]] for d in mismatch])
    still = [d for d in unlinked if d["doc_id"] not in resolved]
    exclude("unlinked_filer", sum(d["n_assets"] for d in still), "no bioguide id in the dataset and no unique "
            "same-district surname match (mostly congressional candidates' reports and their amendments)",
            liabilities=sum(d["n_liabs"] for d in still), docs=len(still),
            top_filers=Counter(f"{d['member_first']} {d['member_last']} ({d['state_district']})" for d in still).most_common(25))
    not_spine = [d for d in docs.values() if d["member"] and d["member"] not in spine]
    exclude("member_not_in_spine", sum(d["n_assets"] for d in not_spine), "bioguide id not among people with a "
            "term since 2000", liabilities=sum(d["n_liabs"] for d in not_spine), members=sorted({d["member"] for d in not_spine}))

    # ---- choose documents per member and report year
    groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for d in docs.values():
        if d["member"] in spine:
            groups[(d["member"], d["report_year"])].append(d)
    used: dict[tuple[str, int], dict[str, Any]] = {}
    superseded, orphan_amend, ratios = [], [], []
    for key, ds in groups.items():
        annual = [d for d in ds if d["filing_type"] == "annual"]
        if not annual:  # an amendment with no annual report in the dataset may amend a candidate report
            orphan_amend.extend(ds)
            continue
        ds = sorted(ds, key=lambda d: (d["filing_date"], d["doc_id"]))
        pick = ds[-1]
        used[key] = pick
        for d in ds[:-1]:
            superseded.append(d)
            if d["n_assets"]:
                ratios.append(pick["n_assets"] / d["n_assets"])
    exclude("amendment_without_annual", sum(d["n_assets"] for d in orphan_amend),
            "amendment (or other non-annual document) for a member and report year with no annual report in the "
            "dataset; it may amend a candidate report, which is out of scope", liabilities=sum(d["n_liabs"] for d in orphan_amend),
            docs=sorted(d["doc_id"] for d in orphan_amend))
    exclude("superseded_document", sum(d["n_assets"] for d in superseded), "an earlier report for the same member "
            "and report year; the latest filed (an amendment, when one exists) is used", liabilities=sum(d["n_liabs"] for d in superseded),
            docs=len(superseded))
    used_ids = {d["doc_id"] for d in used.values()}

    # ---- asset rows
    hrows = q(con, "select * from hj order by doc_id, id")
    descs: dict[str, list[str]] = defaultdict(list)
    for r in hrows:
        if r["ticker"]:
            descs[normalise_ticker(r["ticker"])].append(r["asset_name"] or "")
    tick = TickerResolver(descs)
    c = Counter()
    by_key: dict[tuple[str, int], dict[str, list]] = defaultdict(lambda: {"a": [], "l": []})
    red_examples: list[tuple[str, str]] = []
    residence_rows: list[str] = []
    for r in hrows:
        if r["doc_id"] not in used_ids:
            continue
        doc = docs[r["doc_id"]]
        c["assets_in_used_docs"] += 1
        asset = r["asset_name"] or ""
        if rules.is_personal_residence(asset, r["income_type"]):
            residence_rows.append(r["id"])
            continue
        text, hit = rules.redact(asset, True, bool(r["location"]))
        loc, loc_hit = rules.city_state(r["location"]) if r["location"] else (None, False)
        if hit:
            c["asset_text_redacted"] += 1
            if len(red_examples) < 15:
                red_examples.append((r["id"], text))
        c["location_trimmed"] += loc_hit
        ticker, source = None, None
        if r["ticker"]:
            if printed_ticker(asset, r["ticker"]):
                ticker, source = normalise_ticker(r["ticker"]), "printed"
            else:
                c[f"ticker_dropped_not_printed:{r['ticker_source']}"] += 1
        org = tick.org(ticker) if ticker else None
        lo, hi = r["value_min_usd"], r["value_max_usd"]
        if lo is not None and hi is not None and lo > hi:
            raise AssertionError(f"inverted band {r['id']}")
        by_key[(doc["member"], doc["report_year"])]["a"].append([
            r["id"].rsplit("_", 1)[-1], text, ticker, source, org, r["asset_category"], rules.OWNER[r["owner"]],
            lo, hi, r["income_type"], r["income_min_usd"], r["income_max_usd"], loc, r["doc_id"]])
        c["value_" + ("none" if lo is None else "open" if hi is None else "closed")] += 1
    exclude("personal_residence", len(residence_rows), "asset text names a personal residence or non-rental "
            "second home (not reportable; never published)", sample_ids=residence_rows[:30])

    # ---- liability rows
    lrows = q(con, "select * from lj order by doc_id, id")
    for r in lrows:
        if r["doc_id"] not in used_ids:
            continue
        doc = docs[r["doc_id"]]
        c["liabilities_in_used_docs"] += 1
        res = rules.is_residence_debt(r["creditor"] or "", r["liability_type"] or "")
        real = bool(rules.REAL_ESTATE.search(f"{r['liability_type'] or ''} {r['creditor'] or ''}"))
        kind, h1 = rules.redact(r["liability_type"], real)
        cred, h2 = rules.redact(r["creditor"], real)
        c["liability_text_redacted"] += h1 or h2
        c["liability_residence_secured"] += res
        if r["liability_type"] and re.fullmatch(r"\s*mortgage\s*", r["liability_type"], re.I):
            c["liability_generic_mortgage_counted"] += 1
        by_key[(doc["member"], doc["report_year"])]["l"].append([
            r["id"].rsplit("_", 1)[-1], cred, kind, rules.OWNER[r["owner"]], r["min_amount_usd"], r["max_amount_usd"],
            r["date_incurred"], res, r["doc_id"]])

    # ---- committed member files for overlaps (read-only)
    def member_edges(mid: str) -> dict[str, Any]:
        p = OUT / "members" / f"{mid}.json"
        if not p.exists():
            return {"traded": {}, "pac": defaultdict(list), "ledger_pac": set()}
        m = read_json(p)
        traded = {e["to"]["id"]: e for e in m["edges"] if e["type"] == "traded"}
        pac: dict[str, list] = defaultdict(list)
        for e in m["edges"]:
            if e["type"] == "pac_money" and e["from"]["kind"] == "org":
                pac[e["from"]["id"]].append(e)
        cols = m["ledger"]["cols"]
        ledger_pac = {dict(zip(cols, r))["other"] for r in m["ledger"]["rows"] if dict(zip(cols, r))["type"] == "pac_money"}
        return {"traded": traded, "pac": pac, "ledger_pac": ledger_pac}

    # ---- write member files
    if HOLD_DIR.exists():
        shutil.rmtree(HOLD_DIR)
    HOLD_DIR.mkdir(parents=True)
    members = sorted({k[0] for k in by_key})
    index_rows, edges, org_label, sample_rows = [], [], defaultdict(Counter), []
    ov_stats = Counter()
    coverage_rows = q(con, """select bioguide_id, report_year, extract_status, doc_id from f
                              where chamber='house' and filing_type='annual' and bioguide_id is not null""")
    cov_by_member: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    for r in coverage_rows:
        cov_by_member[r["bioguide_id"]][r["report_year"]].append(r["extract_status"])
    for mid in members:
        mem = spine[mid]
        me = member_edges(mid)
        years: dict[str, Any] = {}
        doc_meta: dict[str, Any] = {}
        held: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))
        overlaps = []
        for (m2, y), rows in sorted(by_key.items()):
            if m2 != mid:
                continue
            doc = used[(mid, y)]
            for d in groups[(mid, y)]:
                doc_meta[d["doc_id"]] = {"url": d["source_url"], "filed": d["filing_date"].isoformat(),
                                         "amendment": d["filing_type"] == "amendment", "report_year": y,
                                         "used": d["doc_id"] == doc["doc_id"]}
            assets = sorted(rows["a"], key=lambda r: (-(r[7] or -1), r[1]))
            liabs = sorted(rows["l"], key=lambda r: (-(r[4] or -1), r[1] or ""))
            a = band_sum([(r[7], r[8]) for r in assets])
            lc = band_sum([(r[4], r[5]) for r in liabs if not r[7]])
            lr = band_sum([(r[4], r[5]) for r in liabs if r[7]])
            if lc["unvalued"] or lr["unvalued"]:
                raise AssertionError(f"liability without amount {mid} {y}")
            by_owner = {}
            for o in ("unspecified", "spouse", "joint", "dependent"):
                s = band_sum([(r[7], r[8]) for r in assets if r[6] == o])
                if s["n"]:
                    by_owner[o] = s
            years[str(y)] = {
                "doc": doc["doc_id"],
                "assets": {"cols": ASSET_COLS, "rows": assets},
                "liabilities": {"cols": LIAB_COLS, "rows": liabs},
                "totals": {"assets": a, "liabilities": lc, "liabilities_residence_secured": lr, "assets_by_owner": by_owner},
                "net_worth": net_worth(a, lc),
            }
            for r in assets:
                if r[4]:
                    held[r[4]][y].append(r)
                    org_label[r[4]][r[1]] += 1
            # overlaps: same report year
            for org in sorted({r[4] for r in assets if r[4]}):
                kinds = []
                t = me["traded"].get(org)
                if t and any(b["y"] == y for b in t["by_year"]):
                    kinds.append({"type": "traded", "edge": t.get("id"),
                                  "trades": next(b["n"] for b in t["by_year"] if b["y"] == y)})
                for e in me["pac"].get(org, []):
                    for b in e["by_year"]:
                        if b["y"] == y:
                            ev = [x for x in e["evidence"] if (x.get("date") or "")[:4] == str(y)][:2]
                            kinds.append({"type": "pac_money", "edge": e.get("id"), "via": (e.get("via") or {}).get("id"),
                                          "exact": b["exact"], "records": b["n"], "evidence": ev})
                if org in me["ledger_pac"]:
                    ov_stats["pac_ledger_rows_not_year_checked"] += 1
                if kinds:
                    hr = [r for r in assets if r[4] == org]
                    s = band_sum([(r[7], r[8]) for r in hr])
                    overlaps.append({"year": y, "org": org, "holding": {"rows": [r[0] for r in hr], "low": s["low"],
                                     "high": s["high"], "owners": sorted({r[6] for r in hr}), "doc": doc["doc_id"],
                                     "url": doc["source_url"]}, "ties": kinds})
                    ov_stats["overlaps_" + "+".join(sorted({k["type"] for k in kinds}))] += 1
            for r in assets:
                sample_rows.append({"member": mid, "year": y, **dict(zip(ASSET_COLS, r)), "url": doc["source_url"],
                                    "dataset_id": f"house_{r[13]}_{r[0]}"})
        latest = max(int(k) for k in years)
        ly = years[str(latest)]
        # portfolio: latest year, grouped by org when resolved, else by the asset text as filed
        grp: dict[str, list] = defaultdict(list)
        for r in ly["assets"]["rows"]:
            grp[r[4] or f"asset:{r[1]}"].append(r)
        tot = ly["totals"]["assets"]
        prow = []
        for g, rs in grp.items():
            s = band_sum([(r[7], r[8]) for r in rs])
            org = rs[0][4]
            prow.append([g, org, companies.get(org, {}).get("name") if org else rs[0][1],
                         companies.get(org, {}).get("sector") if org else None, len(rs), s["low"], s["high"],
                         round(s["low"] / tot["low"], 6) if tot["low"] else None,
                         round(s["high"] / tot["high"], 6) if tot["high"] and s["high"] is not None else None,
                         sorted({r[6] for r in rs})])
        prow.sort(key=lambda r: (-(r[5] or 0), r[0]))
        cov = []
        terms = mem["terms"]
        for y in range(2013, 2026):
            if not served_house(terms, f"{y}-01-01", f"{y}-12-31"):
                continue
            st = "used" if str(y) in years else ("not_extracted:" + ",".join(sorted(set(cov_by_member[mid][y])))
                                                  if cov_by_member[mid].get(y) else "no_annual_report_in_dataset")
            cov.append({"year": y, "status": st})
        out = {
            "member": {"id": mid, "name": mem["name"], "chamber": "rep", "state": mem["state"], "party": mem["party"]},
            "source": SOURCE_ID, "net_worth_definition": NET_WORTH, "docs": doc_meta, "years": years,
            "portfolio": {"year": latest, "cols": ["group", "org", "name", "sector", "rows", "low", "high", "share_low",
                                                   "share_high", "owners"], "rows": prow,
                          "by_owner": ly["totals"]["assets_by_owner"]},
            "overlaps": overlaps, "coverage": cov,
            "member_source": sorted({used[(mid, int(y))]["member_source"] for y in years}),
        }
        write_json(HOLD_DIR / f"{mid}.json", out)
        nw = ly["net_worth"]
        index_rows.append([mid, sorted(int(y) for y in years), latest, nw["low"], nw["high"], nw["high_valued"], nw["label"],
                           ly["totals"]["assets"]["n"], ly["totals"]["liabilities"]["n"] + ly["totals"]["liabilities_residence_secured"]["n"],
                           ly["totals"]["liabilities"]["low"], ly["totals"]["liabilities"]["high"], len(overlaps)])
        # owns edges: one per member and org; amount and by_year = the latest report year that lists the org
        for org, by_y in held.items():
            ly2 = max(by_y)
            rs = by_y[ly2]
            s = band_sum([(r[7], r[8]) for r in rs])
            ydocs = sorted(by_y, reverse=True)
            evidence = []
            for y in ydocs[:5]:
                d = used[(mid, y)]
                r0 = by_y[y]
                ss = band_sum([(r[7], r[8]) for r in r0])
                owners = ", ".join(f"{o} {n}" for o, n in sorted(Counter(r[6] for r in r0).items()))
                evidence.append({"label": f"Report year {y}: {len(r0)} line(s), {fmt_band(ss['low'], ss['high'])}"
                                          f"{'' if ss['high'] is not None or not ss['unvalued'] else ' (some unvalued)'}; owners {owners}",
                                 "date": d["filing_date"].isoformat(), "url": d["source_url"], "source": SOURCE_ID,
                                 "record": " + ".join(f"house_{r[13]}_{r[0]}" for r in r0[:5])})
            edges.append({
                "type": "owns", "family": "holding", "basis": "filed", "from": {"kind": "member", "id": mid},
                "to": {"kind": "org", "id": org}, "directed": True, "via": None,
                "amount": {"low": s["low"] if s["n"] > s["unvalued"] else None, "high": s["high"], "exact": None},
                "count": len(rs),
                # Filing dates, not report years: an earlier year's report can be filed after a later one.
                "first": min(used[(mid, y)]["filing_date"] for y in by_y).isoformat(),
                "last": max(used[(mid, y)]["filing_date"] for y in by_y).isoformat(),
                "by_year": [{"y": ly2, "n": len(rs), "low": s["low"] if s["n"] > s["unvalued"] else None, "high": s["high"], "exact": None}],
                "evidence": evidence, "evidence_total": len(by_y), "stat": None,
                "weak": s["high"] is None, "note": f"position as of report year {ly2}; reported in "
                        f"{len(by_y)} year(s): {', '.join(map(str, sorted(by_y)))}; owners "
                        + ", ".join(f"{o} {n}" for o, n in sorted(Counter(r[6] for r in rs).items()))})
    write_json(INDEX, {"cols": ["id", "years", "latest", "nw_low", "nw_high", "nw_high_valued", "nw_label", "assets",
                                "liabilities", "liab_low", "liab_high", "overlaps"],
                       "rows": sorted(index_rows), "net_worth_definition": NET_WORTH, "source": SOURCE_ID})
    write_jsonl(EDGE_FILE, edges)
    orgs = []
    for org in sorted(org_label):
        cmp = companies.get(org)
        if cmp:
            orgs.append({"id": org, "name": cmp["name"], "kind": "company", "ticker": cmp["ticker"], "cik": cmp["cik"], "sector": cmp["sector"]})
        else:
            orgs.append({"id": org, "name": org_label[org].most_common(1)[0][0], "kind": "other", "ticker": org[3:], "cik": None, "sector": None})
    write_jsonl(ORGS_DIR / "holdings.jsonl", orgs)
    write_json(BUILD / "holdings_rows.json", sample_rows)

    # ---- report
    kept_assets = sum(len(v["a"]) for v in by_key.values())
    kept_liabs = sum(len(v["l"]) for v in by_key.values())
    if kept_assets + len(residence_rows) != c["assets_in_used_docs"]:
        raise AssertionError("asset rows lost between used documents and output")
    year_cov = Counter(y for (_, y) in used)
    unextracted = {f"{r[0]}:{r[1]}": r[2] for r in con.execute("""select report_year, extract_status, count(*) from f
        where chamber='house' and filing_type='annual' group by all order by 1, 2""").fetchall()}
    sizes = sorted(((p.stat().st_size, p.name) for p in HOLD_DIR.glob("*.json")), reverse=True)
    rep = {
        "table_rows": info["counts"], "joins": info["joins"],
        "chambers": {"house": "Schedules A (assets) and D (liabilities) of annual reports, report years "
                              f"{min(year_cov)}-{max(year_cov)}",
                     "senate": f"none: the revision has no Senate holdings/liabilities files ({senate_files}) and "
                               f"{senate_annual_filings} Senate annual-report filings"},
        "documents": {"with_rows": len(docs), "resolved_by_dataset": sum(d["member_source"] == "dataset" for d in docs.values()),
                      "resolved_by_district_surname": len(resolved), "used": len(used_ids)},
        "member_years_per_report_year": dict(sorted(year_cov.items())),
        "annual_filings_by_report_year_and_status": unextracted,
        "members_with_data": len(members), "asset_rows_published": kept_assets, "liability_rows_published": kept_liabs,
        "counters": dict(sorted(c.items())), "exclusions": excl,
        "amendment_row_ratio": {"n": len(ratios), "below_0.5": sum(x < 0.5 for x in ratios),
                                "median": sorted(ratios)[len(ratios) // 2] if ratios else None},
        "tickers": {"resolution": dict(sorted(tick.stats.items())), "vetoed": tick.vetoed,
                    "unmatched_top": Counter(r["ticker"] for r in sample_rows if r["org"] and r["org"].startswith("tk:")).most_common(50)},
        "redaction_examples": red_examples, "overlaps": dict(ov_stats), "owns_edges": len(edges), "orgs": len(orgs),
        "output": {"files": len(sizes) + 1, "bytes": sum(s for s, _ in sizes) + INDEX.stat().st_size,
                   "largest": [[n, s] for s, n in sizes[:10]], "index_bytes": INDEX.stat().st_size},
        "instructions_verified": {
            "house": {"url": HOUSE_GUIDE, "title": "Instruction Guide, Financial Disclosure Reports and Periodic "
                      "Transaction Reports, Calendar Year 2025 (Committee on Ethics, 2026)",
                      "sha256": "87225c207c735213e38408648eb0251517a890ef471e8593974f6f76e70ff4ad",
                      "sections": ["General: 'Assets, Income, Transactions, and Liabilities of over $1,000,000' (PDF p. 29)",
                                   "Schedule A 'Exclusions' (printed p. 50)", "Schedule D reportable debts and "
                                   "'MEMBERS ONLY: Mortgages ... on a personal residence' (PDF pp. 66-67)"]},
            "senate": {"url": SENATE_GUIDE, "title": "Senate Select Committee on Ethics, Financial Disclosure "
                       "Instructions for Calendar Year 2025 (issued March 2026)",
                       "sha256": "770ebd41d5f091f1c1eedf8062244903c342c4eef713c73705fb75092262568c",
                       "note": "consulted for context only; no Senate annual-report data is loaded"}},
    }
    print(f"members with data: {len(members)}; assets published: {kept_assets}; liabilities: {kept_liabs}; "
          f"owns edges: {len(edges)}; output {rep['output']['bytes'] / 1e6:.1f} MB in {rep['output']['files']} files")
    print_table("exclusions", [(k, v["rows"], v.get("liabilities", ""), v["reason"][:70]) for k, v in excl.items()],
                ("what", "assets", "liabs", "why"))
    print(dict(sorted(c.items())))
    print("tickers:", dict(sorted(tick.stats.items())), "overlaps:", dict(ov_stats), "ratios:", rep["amendment_row_ratio"])
    write_json(SOURCES_DIR / "holdings.json", {"sources": {SOURCE_ID: {
        "name": f"Hugging Face {DATASET} (House annual disclosures: holdings, liabilities, filings)",
        "url": f"https://huggingface.co/datasets/{DATASET}", "revision": revision,
        "retrieved": min(f["retrieved"] for f in files),
        "licence": "Dataset tagged CC0-1.0; House disclosures are U.S. government works; use of the reports is "
                   "restricted by 5 U.S.C. 13107(c) (no commercial use, credit rating or solicitation)",
        "files": files,
        "row_counts": {"holdings-house.parquet": info["counts"]["h"], "liabilities-house.parquet": info["counts"]["l"],
                       "filings.parquet": info["counts"]["f"]},
    }}, "report": rep}, pretty=True)


if __name__ == "__main__":
    run()
