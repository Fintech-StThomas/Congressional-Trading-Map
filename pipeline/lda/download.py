"""Resumable, rate-limited downloader for the Lobbying Disclosure Act REST API (https://lda.gov/api/v1/).

API facts this module relies on (from the OpenAPI document at https://lda.gov/api/openapi/v1/):
  * page_size is capped at 25; Filings and Contribution Reports need at least one filter to page past page 1;
  * 120 requests/minute with an API key (15/minute anonymous); 429 + Retry-After when throttled;
  * contributions: filters filing_year, contribution_type (feca|he|me|ple|pic), filing_dt_posted_after/before;
  * filings: filters filing_year, lobbyist_covered_position_indicator, filing_dt_posted_after/before;
  * ordering=dt_posted is accepted (and is the default).

The download is cut into *slices*: (endpoint, filter, filing year, posting window). A posting window is the
interval between two cutoff dates recorded in windows.json; the first window is "everything posted before the
first run's date", each later window (--new-window, used by the daily job) starts one day before the previous
cutoff, so windows overlap by a day and nothing falls in a gap (duplicates are removed by filing_uuid when
parsing). Bounding every slice by a fixed cutoff keeps the result set, and so the pagination, stable while it
is being read. Each page is cached gzipped as <slice>/p00001.json.gz; a slice's state.json records the count
and whether it is complete, so an interrupted run continues where it stopped.

Authentication: when LDA_API_KEY is set (GitHub Actions) requests carry `Authorization: Token <key>`; otherwise
no header is sent (a network proxy may add one). The key is never printed or stored.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "pipeline" / ".cache" / "lda"
API = "https://lda.gov/api/v1"
PAGE_SIZE = 25
PER_MINUTE = 100          # documented limit is 120/min; stay under it
USER_AGENT = "congressional-trading-map-class-project (lobbying research)"
CONTRIBUTION_TYPES = ["feca", "he", "me", "ple", "pic"]
FIRST_CONTRIB_YEAR = 2008  # LD-203 reports start mid-2008
FIRST_FILING_YEAR = 1999
DEADLINE: float | None = None  # monotonic time after which no new page is requested (--max-minutes)

# Slices: name -> (endpoint, fixed filters). "contrib-all" pages through every LD-203 report of a year (the
# API's recommended path, ~0.9 s a page). The per-type slices skip the ~70% of reports with no items, but any
# filter on contribution items makes the API take ~18-40 s a page, so they are only an option (--contrib-by-type).
KINDS: dict[str, tuple[str, dict[str, str]]] = {
    "contrib-all": ("contributions", {}),
    **{f"contrib-{t}": ("contributions", {"contribution_type": t}) for t in CONTRIBUTION_TYPES},
    "filings-covered": ("filings", {"lobbyist_covered_position_indicator": "true"}),
}


class Limiter:
    """At most PER_MINUTE requests in any rolling minute, across threads; a 429 pauses everyone."""

    def __init__(self, per_minute: int) -> None:
        self.interval = 60.0 / per_minute
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next_at)
            self.next_at = at + self.interval
        if at > now:
            time.sleep(at - now)

    def pause(self, seconds: float) -> None:
        with self.lock:
            self.next_at = max(self.next_at, time.monotonic() + seconds)


class Client:
    def __init__(self, per_minute: int = PER_MINUTE) -> None:
        self.limiter = Limiter(per_minute)
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.session.headers["Accept"] = "application/json"
        key = os.environ.get("LDA_API_KEY", "").strip()
        if key:
            self.session.headers["Authorization"] = f"Token {key}"
        self.requests = 0
        self.lock = threading.Lock()

    def get(self, url: str, params: dict, retries: int = 6) -> dict:
        delay = 5.0
        last = ""
        for attempt in range(retries):
            self.limiter.wait()
            with self.lock:
                self.requests += 1
            try:
                r = self.session.get(url, params=params, timeout=90)
            except requests.RequestException as e:
                last = type(e).__name__
            else:
                if r.status_code == 200:
                    try:
                        return r.json()
                    except ValueError:
                        last = "invalid JSON"
                elif r.status_code == 429:
                    wait = float(r.headers.get("Retry-After") or 60)
                    log(f"429 throttled; pausing {wait:.0f}s")
                    self.limiter.pause(wait + 1)
                    continue
                elif r.status_code in (401, 403):
                    raise PermissionError(f"HTTP {r.status_code} from {url} (API key missing or invalid)")
                elif r.status_code == 404:
                    raise LookupError(f"HTTP 404 {url} {params}")
                else:
                    last = f"HTTP {r.status_code}"
            time.sleep(delay)
            delay = min(delay * 2, 120)
        raise RuntimeError(f"giving up on {url} {params}: {last}")


def log(msg: str) -> None:
    print(f"[lda {dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- cache layout

def windows() -> list[str]:
    p = CACHE / "windows.json"
    return json.loads(p.read_text())["cutoffs"] if p.exists() else []


def add_window(today: str | None = None) -> list[str]:
    cuts = windows()
    today = today or dt.date.today().isoformat()
    if not cuts or cuts[-1] < today:
        cuts.append(today)
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / "windows.json").write_text(json.dumps({"cutoffs": cuts}, indent=1))
    return cuts


def window_bounds(cuts: list[str], i: int) -> tuple[str | None, str]:
    after = None
    if i > 0:
        after = (dt.date.fromisoformat(cuts[i - 1]) - dt.timedelta(days=1)).isoformat()
    return after, cuts[i]


def slice_dir(kind: str, year: int, cutoff: str) -> Path:
    return CACHE / "pages" / kind / str(year) / f"upto-{cutoff}"


def read_state(d: Path) -> dict:
    p = d / "state.json"
    return json.loads(p.read_text()) if p.exists() else {}


def write_state(d: Path, state: dict) -> None:
    tmp = d / "state.json.tmp"
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(d / "state.json")


def page_path(d: Path, n: int) -> Path:
    return d / f"p{n:05d}.json.gz"


def save_page(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(data["results"], f, separators=(",", ":"))
    tmp.replace(path)


def load_page(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def iter_slices(kinds: list[str], years: list[int]):
    """(kind, year, after, cutoff, dir) for every slice the cache knows about, in window order."""
    cuts = windows()
    for year in sorted(years, reverse=True):      # most recent years first
        for kind in kinds:
            for i in range(len(cuts)):
                after, before = window_bounds(cuts, i)
                yield kind, year, after, before, slice_dir(kind, year, before)


# ---------------------------------------------------------------- download

def download_slice(client: Client, kind: str, year: int, after: str | None, before: str, d: Path,
                   pool: ThreadPoolExecutor) -> dict:
    endpoint, fixed = KINDS[kind]
    params = {**fixed, "filing_year": str(year), "filing_dt_posted_before": before,
              "ordering": "dt_posted", "page_size": str(PAGE_SIZE)}
    if after:
        params["filing_dt_posted_after"] = after
    url = f"{API}/{endpoint}/"
    d.mkdir(parents=True, exist_ok=True)
    state = read_state(d)
    if state.get("complete"):
        return state
    if not page_path(d, 1).exists() or "count" not in state:
        first = client.get(url, {**params, "page": "1"})
        save_page(page_path(d, 1), first)
        state = {"kind": kind, "year": year, "after": after, "before": before, "params": params,
                 "count": first["count"], "pages": max(1, -(-first["count"] // PAGE_SIZE)),
                 "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
        write_state(d, state)
    missing = [n for n in range(1, state["pages"] + 1) if not page_path(d, n).exists()]

    def one(n: int) -> None:
        if DEADLINE and time.monotonic() > DEADLINE:
            raise TimeoutError("time budget reached")
        save_page(page_path(d, n), client.get(url, {**params, "page": str(n)}))

    errors = []
    for fut in [pool.submit(one, n) for n in missing]:
        try:
            fut.result()
        except Exception as e:  # noqa: BLE001 - record and leave the slice incomplete
            errors.append(str(e)[:200])
    if errors:
        state["errors"] = errors[:5]
        write_state(d, state)
        log(f"{kind} {year} upto {before}: {len(errors)} pages failed, slice left incomplete")
        return state
    uuids = set()
    rows = 0
    for n in range(1, state["pages"] + 1):
        for r in load_page(page_path(d, n)):
            rows += 1
            uuids.add(r["filing_uuid"])
    state.update(complete=True, rows=rows, unique=len(uuids),
                 finished=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    state.pop("errors", None)
    write_state(d, state)
    return state


def plan(kinds: list[str], years: list[int]) -> list[tuple]:
    return [s for s in iter_slices(kinds, years) if not read_state(s[4]).get("complete")]


def run(years: list[int], kinds: list[str], new_window: bool = False, workers: int = 3,
        per_minute: int = PER_MINUTE, max_minutes: float | None = None) -> dict:
    """Fetch every incomplete slice; returns a status dict. Never raises on network errors."""
    if new_window or not windows():
        add_window()
    global DEADLINE
    DEADLINE = time.monotonic() + max_minutes * 60 if max_minutes else None
    client = Client(per_minute)
    todo = plan(kinds, years)
    log(f"{len(todo)} slices to fetch ({', '.join(kinds)}; years {years[0]}-{years[-1]})")
    t0 = time.monotonic()
    done = failed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for kind, year, after, before, d in todo:
            if max_minutes and (time.monotonic() - t0) / 60 > max_minutes:
                log("time budget reached; stopping (rerun to resume)")
                break
            try:
                st = download_slice(client, kind, year, after, before, d, pool)
            except PermissionError as e:
                log(str(e))
                return {"ok": False, "reason": "auth", "requests": client.requests}
            except Exception as e:  # noqa: BLE001
                log(f"{kind} {year}: {str(e)[:200]}")
                failed += 1
                continue
            done += bool(st.get("complete"))
            failed += not st.get("complete")
            rate = client.requests / max(1e-9, (time.monotonic() - t0) / 60)
            log(f"{kind} {year} upto {before}: count={st.get('count')} pages={st.get('pages')} "
                f"unique={st.get('unique')} complete={st.get('complete', False)} "
                f"[{client.requests} requests, {rate:.0f}/min]")
    return {"ok": failed == 0, "slices_done": done, "slices_failed": failed, "requests": client.requests}


def estimate(kinds: list[str], years: list[int]) -> None:
    """Print the request count each slice needs (one request per slice to read its count)."""
    client = Client()
    total = 0
    for kind in kinds:
        endpoint, fixed = KINDS[kind]
        for y in years:
            n = client.get(f"{API}/{endpoint}/", {**fixed, "filing_year": str(y), "page_size": "1"})["count"]
            pages = -(-n // PAGE_SIZE)
            total += pages
            print(f"{kind:16} {y}  {n:7d} rows  {pages:5d} pages", flush=True)
    print(f"total pages {total}; at {PER_MINUTE}/min = {total / PER_MINUTE:.0f} min")


def parse_years(s: str) -> list[int]:
    a, _, b = s.partition("-")
    return list(range(int(a), int(b or a) + 1))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Download LDA API pages into pipeline/.cache/lda")
    ap.add_argument("--contrib-years", default="2019-2026")
    ap.add_argument("--filing-years", default="2019-2026")
    ap.add_argument("--only", choices=["contrib", "filings"], help="fetch only one family of slices")
    ap.add_argument("--new-window", action="store_true", help="add a posting window ending today (incremental)")
    ap.add_argument("--estimate", action="store_true")
    ap.add_argument("--contrib-by-type", action="store_true", help="use the slow per-type contribution filters")
    ap.add_argument("--max-minutes", type=float)
    ap.add_argument("--workers", type=int, default=3, help="concurrent requests (contribution queries take ~18 s)")
    ap.add_argument("--per-minute", type=int, default=PER_MINUTE,
                    help="request budget of this process; keep the sum over concurrent processes <= 100")
    a = ap.parse_args(argv)
    ckinds = [f"contrib-{t}" for t in CONTRIBUTION_TYPES] if a.contrib_by_type else ["contrib-all"]
    jobs = []
    if a.only != "filings":
        jobs.append((ckinds, parse_years(a.contrib_years)))
    if a.only != "contrib":
        jobs.append((["filings-covered"], parse_years(a.filing_years)))
    if a.estimate:
        for kinds, years in jobs:
            estimate(kinds, years)
        return 0
    ok = True
    for i, (kinds, years) in enumerate(jobs):
        res = run(years, kinds, new_window=a.new_window and i == 0, workers=a.workers,
                  per_minute=a.per_minute, max_minutes=a.max_minutes)
        log(f"result: {res}")
        ok &= res["ok"]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
