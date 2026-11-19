"""`traded_before_contract` (member -> org): stock buys that came shortly before the company won a federal contract.

Contract awards come from USAspending.gov (api.usaspending.gov, public, no key). For every company a member's
household bought, the stage fetches that company's new contract awards of at least MIN_AWARD dollars signed since
START, matching the recipient by exact normalised name (the same rule as everywhere else: similar names never match).

For each member and company it counts the member's buy days that fall 0..WINDOW_DAYS days before an award was
signed, and compares that count with a permutation baseline that keeps the member's own trading calendar. The rule,
thresholds and baseline are in docs/data-dictionary.md ("traded_before_contract rule").

Reads pipeline/build/trades_resolved.parquet, companies.json, spine.json.
Writes pipeline/build/edges/contracts.jsonl and pipeline/build/sources/contracts.json.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import random
import re
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import pyarrow.parquet as pq
import requests

from .edges import by_year, make_edge, node, top_evidence
from .edges_trades import eligible, trade_label
from .util import (BUILD, CACHE, EDGES_DIR, RateLimiter, clean_sec_name, normalise_name, print_table, read_json,
                   user_agent, utc_now, write_jsonl, write_source_meta)

SOURCE_ID = "usaspending"
API = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
RECIPIENT_API = "https://api.usaspending.gov/api/v2/recipient/{}/"
AWARD_URL = "https://www.usaspending.gov/award/{}"
AWARD_TYPES = ["A", "B", "C", "D"]      # definitive contracts and purchase/delivery orders (not IDV vehicles)
MIN_AWARD = 10_000_000                  # material awards only; DoD announces every award over $7.5M publicly
START = date(2012, 7, 1)                # periodic transaction reports begin July 2012
WINDOW_DAYS = 30                        # a buy 0..30 days before the award's signing date
SHUFFLES, SEED = 1000, 20260101
MIN_OBSERVED, MIN_LIFT, MAX_P = 2, 2.0, 0.01
STRONG_OBSERVED = 3                     # passing pairs with fewer pre-award buys are drawn weak
MIN_NAME_CHARS = 3                      # normalised names shorter than this are too ambiguous to search
PAGE_SIZE, MAX_PAGES = 100, 60
CACHE_DIR = CACHE / "usaspending"
HISTORY_MAX_AGE = 30 * 86400.0          # awards signed before this year change rarely
CURRENT_MAX_AGE = 86400.0
FIELDS = ["Award ID", "Recipient Name", "Award Amount", "Base Obligation Date", "Awarding Agency",
          "Awarding Sub Agency", "Description", "generated_internal_id", "recipient_id"]
MAX_PROFILES = 300                      # recipient profiles looked up per company (other-named recipients only)

_limiter = RateLimiter(8.0)
WORKERS = 8
_session = requests.Session()


# ---------------------------------------------------------------- fetching

def _post_cached(body: dict[str, Any] | None, max_age: float, retries: int = 5, url: str = API,
                 timeout: float = 120, cache_failure: bool = False) -> dict[str, Any]:
    """POST body to url (GET when body is None), cached under pipeline/.cache/usaspending for max_age seconds."""
    key = hashlib.sha1((url + json.dumps(body, sort_keys=True)).encode()).hexdigest()
    path = CACHE_DIR / f"{key}.json"
    if path.exists() and time.time() - path.stat().st_mtime < max_age:
        return json.loads(path.read_text())
    last: Exception | None = None
    for attempt in range(retries):
        _limiter.wait()
        try:
            headers = {"User-Agent": user_agent()}
            r = (_session.get(url, headers=headers, timeout=timeout) if body is None
                 else _session.post(url, json=body, headers=headers, timeout=timeout))
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code}", response=r)
            # Any other 4xx is final: remember it as an empty answer instead of retrying on every run.
            data = {"_status": r.status_code} if 400 <= r.status_code < 500 else r.json()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(data))
            tmp.replace(path)
            return data
        except (requests.RequestException, ValueError) as e:
            last = e
            time.sleep(3 * (attempt + 1))
    if cache_failure:  # a lookup that keeps failing is remembered as empty until the cache entry expires
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"_error": str(last)[:200]}))
        return {"_error": str(last)}
    raise RuntimeError(f"USAspending request failed after {retries} attempts: {last}")


def _windows(today: date) -> list[tuple[date, date, float]]:
    year_start = date(today.year, 1, 1)
    return [(START, year_start - timedelta(days=1), HISTORY_MAX_AGE), (year_start, today, CURRENT_MAX_AGE)]


def recipient_parents(recipient_id: str) -> set[str]:
    """Normalised names of the parent companies USAspending lists for a recipient (current and past)."""
    try:
        d = _post_cached(None, HISTORY_MAX_AGE, retries=2, url=RECIPIENT_API.format(recipient_id), timeout=30,
                         cache_failure=True)
    except (RuntimeError, requests.HTTPError):
        return set()
    names = [d.get("parent_name")] + [p.get("parent_name") for p in d.get("parents") or []]
    return {normalise_name(n) for n in names if n}


def match_via(recipient: str, recipient_id: str | None, name: str, profiles: dict[str, set[str]]) -> str | None:
    """"name" when the recipient is the company itself, "parent" when USAspending lists the company as its parent."""
    if normalise_name(recipient) == name:
        return "name"
    if not recipient_id:
        return None
    if recipient_id not in profiles:
        if len(profiles) >= MAX_PROFILES:
            return None
        profiles[recipient_id] = recipient_parents(recipient_id)
    return "parent" if name in profiles[recipient_id] else None


def fetch_awards(name: str, today: date) -> tuple[list[dict[str, Any]], bool, set[str]]:
    """New contract awards of at least MIN_AWARD to the company `name` (normalised SEC name): awards whose
    recipient's normalised name equals it, or whose recipient USAspending lists under a parent with that name.

    Returns (awards, truncated, recipient names the text search returned but neither rule accepted)."""
    awards: dict[str, dict[str, Any]] = {}
    rejected: set[str] = set()
    profiles: dict[str, set[str]] = {}
    truncated = False
    for start, end, max_age in _windows(today):
        if start > end:
            continue
        for page in range(1, MAX_PAGES + 1):
            body = {"filters": {"award_type_codes": AWARD_TYPES, "recipient_search_text": [name],
                                "time_period": [{"start_date": start.isoformat(), "end_date": end.isoformat(),
                                                 "date_type": "date_signed"}],
                                "award_amounts": [{"lower_bound": MIN_AWARD}]},
                    "fields": FIELDS, "limit": PAGE_SIZE, "page": page, "sort": "Award ID", "order": "asc"}
            data = _post_cached(body, max_age)
            for a in data.get("results", []):
                recipient = a.get("Recipient Name") or ""
                via = match_via(recipient, a.get("recipient_id"), name, profiles)
                if via is None:
                    rejected.add(recipient)
                    continue
                signed = a.get("Base Obligation Date")
                if not signed or not a.get("generated_internal_id"):
                    continue
                d = date.fromisoformat(signed[:10])
                if not start <= d <= end:
                    continue
                awards[a["generated_internal_id"]] = {
                    "id": a["generated_internal_id"], "piid": a.get("Award ID"), "date": d,
                    "amount": a.get("Award Amount"), "agency": a.get("Awarding Agency"),
                    "subagency": a.get("Awarding Sub Agency"), "description": (a.get("Description") or "").strip(),
                    "recipient": recipient, "via": via}
            if not data.get("page_metadata", {}).get("hasNext"):
                break
        else:
            truncated = True
    return sorted(awards.values(), key=lambda a: (a["date"], a["id"])), truncated, rejected


# ---------------------------------------------------------------- statistics (pure, unit-tested)

def next_award(day: date, award_days: list[date], window: int = WINDOW_DAYS) -> date | None:
    """The first award signed on `day` or within `window` days after it; award_days must be sorted."""
    i = bisect.bisect_left(award_days, day)
    if i < len(award_days) and (award_days[i] - day).days <= window:
        return award_days[i]
    return None


def count_preceding(days: list[date], award_days: list[date], window: int = WINDOW_DAYS) -> int:
    """Distinct award days that had at least one buy 0..window days before them. A burst of buys before one award
    counts once, so clustered buying cannot inflate the count."""
    return len({next_award(d, award_days, window) for d in days} - {None})


def permutation_test(buy_days: list[date], pool_by_year: dict[int, list[date]], award_days: list[date],
                     shuffles: int = SHUFFLES, seed: int = SEED) -> tuple[int, float, float]:
    """(observed, expected, p). Each shuffle replaces the pair's buy days in each calendar year with as many days
    drawn without replacement from the member's own eligible trading days that year, so the baseline keeps how
    often and when in the year the member trades, and asks only whether the days chosen for this company line up
    with its awards more than the member's other trading days do."""
    observed = count_preceding(buy_days, award_days)
    per_year = Counter(d.year for d in buy_days)
    rng = random.Random(f"{seed}:{','.join(d.isoformat() for d in sorted(buy_days))}")
    total, at_least = 0, 0
    for _ in range(shuffles):
        sample: list[date] = []
        for y, k in sorted(per_year.items()):
            sample += rng.sample(pool_by_year[y], k)
        n = count_preceding(sample, award_days)
        total += n
        at_least += n >= observed
    return observed, total / shuffles, (at_least + 1) / (shuffles + 1)


def passes(observed: int, expected: float, p: float) -> bool:
    return observed >= MIN_OBSERVED and observed >= MIN_LIFT * max(expected, 1 / SHUFFLES) and p <= MAX_P


# ---------------------------------------------------------------- edges

def _award_text(a: dict[str, Any]) -> str:
    amt = f"${a['amount'] / 1e6:,.1f}M" if a.get("amount") is not None else "a"
    who = a.get("subagency") or a.get("agency") or "a federal agency"
    desc = re.sub(r"IGF::\w+::IGF", "", a.get("description") or "").strip(" :;,-")
    what = f": {desc[:90].rstrip()}" if desc else ""
    to = f" with {a['recipient'].title()} (a subsidiary, per USAspending)" if a.get("via") == "parent" else ""
    return f"{who} signed {amt} contract {a['piid']}{to}{what}"


def build_edges(trades: list[dict[str, Any]], companies: dict[str, dict[str, Any]],
                awards_by_org: dict[str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    # One row per member, org and buy day; the member's trading calendar is every eligible buy or sell day.
    buys: dict[tuple[str, str], dict[date, dict[str, Any]]] = defaultdict(dict)
    pool: dict[str, dict[int, set[date]]] = defaultdict(lambda: defaultdict(set))
    for t in sorted((t for t in trades if eligible(t, companies)), key=lambda t: t["id"]):
        pool[t["member"]][t["date"].year].add(t["date"])
        if t["action"] == "buy" and t["org"] in awards_by_org and t["date"] >= START:
            buys[(t["member"], t["org"])].setdefault(t["date"], t)

    edges, tested, table = [], 0, []
    for (member, org), by_day in sorted(buys.items()):
        award_list = awards_by_org[org]
        award_days = [a["date"] for a in award_list]
        days = sorted(by_day)
        if count_preceding(days, award_days) < MIN_OBSERVED:
            continue
        tested += 1
        pools = {y: sorted(s) for y, s in pool[member].items()}
        obs, expected, p = permutation_test(days, pools, award_days)
        lift = obs / max(expected, 1 / SHUFFLES)
        ok = passes(obs, expected, p)
        table.append((member, org, len(days), obs, round(expected, 3), round(lift, 2), round(p, 4), ok))
        if not ok:
            continue
        largest: dict[date, dict[str, Any]] = {}  # the largest award signed on each day
        for a in award_list:
            if a["date"] not in largest or (a["amount"] or 0) > (largest[a["date"]]["amount"] or 0):
                largest[a["date"]] = a
        before: dict[date, list[date]] = defaultdict(list)  # award day -> buy days in the window before it
        for d in days:
            ad = next_award(d, award_days)
            if ad is not None:
                before[ad].append(d)
        evid, years, hit_days = [], [], []
        for ad, bds in sorted(before.items()):
            d = max(bds)  # the buy closest to the award
            t, a = by_day[d], largest[ad]
            gap = (ad - d).days
            when = "the same day" if gap == 0 else f"{gap} day{'s' if gap != 1 else ''} later"
            more = f" (and {len(bds) - 1} earlier buy day{'s' if len(bds) > 2 else ''} in the {WINDOW_DAYS} days before)" if len(bds) > 1 else ""
            evid.append({"label": f"{trade_label(t)} of {t['ticker'] or t['asset']} on {d.isoformat()}{more}; {when}, "
                                  f"{_award_text(a)}",
                         "date": d.isoformat(), "url": AWARD_URL.format(a["id"]), "source": SOURCE_ID,
                         "record": f"{t['id']} + {a['piid']}", "_size": WINDOW_DAYS + 1 - gap})
            for bd in bds:
                bt = by_day[bd]
                years.append((bd.year, 1, {"low": bt["low"], "high": bt["high"], "exact": None}))
                hit_days.append(bd)
        stat = {"observed": obs, "expected": round(max(expected, 1 / SHUFFLES), 4), "lift": round(lift, 2),
                "p": round(p, 4),
                "method": (f"permutation: {SHUFFLES} shuffles (seed {SEED}) of the member's buy days in this company "
                           f"among the member's own trading days in the same year; counts distinct federal contract awards "
                           f"of ${MIN_AWARD / 1e6:,.0f}M or more to the company (USAspending) signed 0-{WINDOW_DAYS} "
                           f"days after at least one buy"
                           + ("; no shuffle produced a match, expected floored at 1/shuffles" if expected == 0 else ""))}
        edges.append(make_edge(
            "traded_before_contract", node("member", member), node("org", org), directed=True, basis="derived",
            years=by_year(years), first=min(hit_days).isoformat(), last=max(hit_days).isoformat(),
            evidence=top_evidence(evid), evidence_total=len(evid), stat=stat, weak=obs < STRONG_OBSERVED,
            note=(f"{obs} federal contract awards to this company came 0-{WINDOW_DAYS} days after one of the member's "
                  f"{len(days)} buy days ({len(hit_days)} buy days in those windows), vs {expected:.2f} awards expected "
                  f"from the member's own trading calendar; "
                  f"{len(award_list)} awards of ${MIN_AWARD / 1e6:,.0f}M+ on file since {START.year}")))
    report = {
        "pairs_with_buys_in_contractors": len(buys), "pairs_tested": tested, "pairs_passed": len(edges),
        "pairs_weak": sum(e["weak"] for e in edges),
        "expected_false_positives_at_max_p": round(tested * MAX_P, 1),
        "window_days": WINDOW_DAYS, "min_award": MIN_AWARD, "shuffles": SHUFFLES, "seed": SEED, "max_p": MAX_P,
        "top": [{"member": m, "org": o, "buy_days": n, "observed": ob, "expected": ex, "lift": li, "p": pv}
                for m, o, n, ob, ex, li, pv, ok in sorted(table, key=lambda r: (r[6], -r[5])) if ok][:20],
        "closest_not_passed": [{"member": m, "org": o, "buy_days": n, "observed": ob, "expected": ex, "lift": li, "p": pv}
                               for m, o, n, ob, ex, li, pv, ok in sorted(table, key=lambda r: (r[6], -r[5])) if not ok][:10],
    }
    return edges, report


# ---------------------------------------------------------------- stage

def contract_targets(trades: list[dict[str, Any]], companies: dict[str, dict[str, Any]]) -> dict[str, str]:
    """org id -> normalised SEC name, for every company some member bought (eligible buys only)."""
    out = {}
    for t in trades:
        if t["action"] == "buy" and eligible(t, companies) and t["org"] in companies:
            name = normalise_name(clean_sec_name(companies[t["org"]]["name"]))
            if len(name) >= MIN_NAME_CHARS:
                out[t["org"]] = name
    return dict(sorted(out.items()))


def run() -> None:
    trades = pq.read_table(BUILD / "trades_resolved.parquet").to_pylist()
    companies = read_json(BUILD / "companies.json")
    spine = read_json(BUILD / "spine.json")
    today = date.today()
    targets = contract_targets(trades, companies)
    # Several companies can share a normalised name; such names are ambiguous and skipped.
    name_count = Counter(targets.values())
    ambiguous = sorted(o for o, n in targets.items() if name_count[n] > 1)
    queries = {o: n for o, n in targets.items() if name_count[n] == 1}
    print(f"contracts: {len(queries)} companies to look up on USAspending ({len(ambiguous)} skipped as ambiguous names)",
          flush=True)

    awards_by_org: dict[str, list[dict[str, Any]]] = {}
    truncated: list[str] = []
    rejected = 0
    done = 0

    def one(item: tuple[str, str]) -> tuple[str, list[dict[str, Any]], bool, set[str]]:
        org, name = item
        return (org, *fetch_awards(name, today))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for org, awards, trunc, rej in pool.map(one, queries.items()):
            done += 1
            rejected += len(rej)
            if trunc:
                truncated.append(org)
            if awards:
                awards_by_org[org] = awards
            if done % 200 == 0:
                print(f"  {done}/{len(queries)} companies, {len(awards_by_org)} with awards", flush=True)

    edges, report = build_edges(trades, companies, awards_by_org)
    write_jsonl(EDGES_DIR / "contracts.jsonl", edges)
    n_awards = sum(len(a) for a in awards_by_org.values())
    report.update({
        "companies_looked_up": len(queries), "companies_ambiguous_name": len(ambiguous),
        "companies_with_awards": len(awards_by_org), "awards": n_awards,
        "companies_truncated": truncated, "recipient_names_rejected_by_exact_rule": rejected,
    })
    print(f"contracts: {n_awards} awards over {len(awards_by_org)} companies; pairs tested {report['pairs_tested']}, "
          f"passed {report['pairs_passed']} ({report['pairs_weak']} weak); "
          f"~{report['expected_false_positives_at_max_p']} expected by chance at p <= {MAX_P}")
    print_table("top traded_before_contract pairs", [
        (spine.get(r["member"], {}).get("name", r["member"]), companies[r["org"]]["name"], r["buy_days"],
         r["observed"], r["expected"], r["lift"], r["p"]) for r in report["top"]],
        ("member", "company", "buy days", "obs", "expected", "lift", "p"))
    print_table("closest pairs that did not pass", [
        (spine.get(r["member"], {}).get("name", r["member"]), companies[r["org"]]["name"], r["buy_days"],
         r["observed"], r["expected"], r["lift"], r["p"]) for r in report["closest_not_passed"]],
        ("member", "company", "buy days", "awards hit", "expected", "lift", "p"))
    write_source_meta("contracts", {SOURCE_ID: {
        "name": "USAspending.gov contract awards", "url": "https://www.usaspending.gov/",
        "revision": today.isoformat(), "retrieved": utc_now(), "licence": "Public domain (U.S. government work)"}},
        report)
