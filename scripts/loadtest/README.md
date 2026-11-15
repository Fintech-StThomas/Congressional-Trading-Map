# Load tests

`loadtest.mjs` is a small, dependency-free load generator for Paper Trail (Node 20 or later, global `fetch`).
The November 2026 results are in `docs/SECURITY-REVIEW.md`.

**Test only a deployment you own.** Load testing someone else's site is an attack, whatever the intent. Run
these against your own preview deployment where you can, and against production only at quiet times. On
Vercel Hobby, every request counts against the monthly limits, so a long run costs part of the free allowance.

## Modes

| Mode | What it does | Defaults |
|---|---|---|
| `ramp` | Virtual users (VUs) loop over a realistic mix: 70% page views (`/` 30%, `/wall` 15%, `/cases` 15%, a random `/m/<id>` 40%) and 30% the data a board session fetches (`/board-data/<state>`, `/data/members/<id>.json`, `/data/orgs/<shard>.json`, `/search-index`). Each VU waits `--think` ms (randomised ±50%) between requests. | `--stages 5,10 --duration 30 --think 1000` |
| `cold` | Requests `--count` distinct member pages, `--concurrency` at a time: the worst case for on-demand pages, since each cold page is rendered by a function that fetches several files from the bucket. | `--count 50 --concurrency 10` |
| `herd` | Fires `--concurrency` simultaneous requests at one `--path` (a cold or stale page) to see whether the CDN collapses them into one render. | `--concurrency 50` |

The 7.5 MB `trades/K000389.json` is never requested, and member K000389 (about 1 MB of HTML) is left out of the
random picks.

A stage stops early, and later stages are skipped, when more than `--max-error` (default 0.05) of the recent
responses, or 20 or more of them, are 403, 429, 5xx, timeouts or network errors. The output names the stage where
that happened.

## Run

```bash
cd scripts/loadtest
node loadtest.mjs ramp --base https://<your-deployment>.vercel.app
node loadtest.mjs ramp --base https://<your-deployment>.vercel.app --stages 10,25,50,100 --duration 60 --think 300
node loadtest.mjs cold --base https://<your-deployment>.vercel.app --count 200 --concurrency 20 --seed 42
node loadtest.mjs herd --base https://<your-deployment>.vercel.app --path /m/<an id nobody has opened> --concurrency 50
```

Behind an HTTPS proxy (for example a cloud sandbox), Node's `fetch` ignores `HTTPS_PROXY` unless told otherwise:

```bash
export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.crt NODE_NO_WARNINGS=1
```

`--base` can also come from `LOADTEST_BASE`. Other options are `--seed` (repeatable picks), `--timeout` (ms per
request, default 30000) and `--max-error`.

## Output

One JSON line per stage: `requests`, `rps`, latency `p50`/`p95`/`p99`/`max` in ms, `errorRate`, the status `codes`,
the `x-vercel-cache` values seen (`HIT`, `MISS`, `STALE`, `PRERENDER`), and `decodedMB` (decompressed bytes, so
this is larger than what went over the wire).

The run measures from one machine in one region, so it reaches a single Vercel edge region and is bounded by
that machine's network. A run with no errors shows that the site handled that load; it does not show the
site's maximum.
