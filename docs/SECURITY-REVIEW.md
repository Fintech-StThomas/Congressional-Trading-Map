# Paper Trail: security review and load test

Date: 14 November 2026. Target: the owner's own deployment at https://red-paper-trail.vercel.app/ and its R2 bucket
(`pub-b6acb08f97e345d68ebc4629e915f8ab.r2.dev/data`), reviewed at the code in this checkout. Authorised by the owner.
The code review was read-only. Live probes were harmless GETs. The load test sent about 30,500 requests in total.
The load-test scripts are in `scripts/loadtest/` (see its README).

**Summary.** Nothing high-severity was found. The data proxy cannot be used to escape the bucket or as an open
proxy. No secrets were found in the repository or its history. Data from the bucket reaches the page only through
React's escaping. Two gaps matter most. The site sends almost no browser security headers. Its main exposure is
cost: each request for a junk id, or for a cold page under load, makes Vercel run a function and write a new cache
entry, and once the Pro plan ends that can use up the Hobby limits and get the project paused. The site handled
100 concurrent users (277 req/s) with no errors. The limit to plan for is Vercel Hobby's monthly quotas, not
throughput.

## Implementation follow-up (15 November 2026)

The original measurements below describe the deployment before these changes; they are retained as a baseline.
Code changes are verified locally before the pull request. Deployment-only changes remain open until checked on
Vercel/GitHub after merge.

| Finding | State on this branch | Evidence / remaining work |
|---|---|---|
| S1 browser headers | Implemented; browser verification recorded below | `lib/security-headers.ts`, `next.config.ts`, security unit tests and the smoke suite's CSP event/console checks. CSP permits Next's inline RSC scripts and same-origin analytics; preview toolbar allowances apply only to previews. |
| S2 / S3 junk ids, cold fetches | Partly fixed | Shape validation in rewrites and readers; remote member ids must exist in the index before per-member bucket fetches. Single-flight shares concurrent reads within one process. This does not collapse renders across separate serverless instances or stop query-string cache amplification; dashboard rate limits remain open. |
| S5 record source URL | Fixed in code | `RecordsView` checks source links with `safeHttpUrl`; security unit tests exercise unsafe schemes. |
| S6 upload credentials | Partly fixed; owner configuration remains | Publish step explicitly runs only on the default branch in the main repository, so ordinary branch dispatches cannot upload. A collaborator could still edit the workflow; restrict secrets through the environment below. |
| S9 reproducible install | Fixed in code | `web/vercel.json` specifies `npm ci`; PR checks use the lockfile. Existing dev-dependency advisories remain as originally reported. |
| L2 revalidation | Fixed in code | Data fetch cache and on-demand pages revalidate hourly (`REVALIDATE_SECONDS=3600`). |
| L3 portraits / geo | Fixed in code | Week-long browser caching; shared off-screen portraits use `loading="lazy"`. Case-file hero remains eager. Smoke checks inspect actual asset response headers. |
| L4 bucket / data caching | Fixed in code; publish confirmation pending | `s-maxage=3600` on objects and `/data/*`. Manifest records the cache policy, forcing one full re-upload when the policy changes. Moto tests verify unchanged content is re-uploaded on policy changes and old manifests. Confirm public headers after the next successful publish. |
| PR checks / daily test isolation | Implemented; hosted execution pending | `checks.yml` runs on PRs and `claude/**` branch pushes: project status, pipeline tests, sample build with lint, type check and unit tests. Daily publish requirement is step-local, with an explicit default-branch upload gate. Actions use verified pinned Node 24 releases. |

### Verification evidence

- Node 24 `npm ci` and the production sample build (including ESLint) pass. Sample `npm test`: 55 passed,
  16 real-data-only skips. A targeted rerun also visits the sample organisation shell: zero CSP violations.
- `python -m unittest scripts.ci.test_check_status`: 3 passed; R2 uploader tests: 9 passed, including changed
  header policy, legacy manifests, upload ordering and test isolation from `PT_R2_REQUIRED`.
- Runtime probes confirm `/portraits/K000389.webp` sends `max-age=604800`, and `/m/Z999999` is 404.
  `isKnownMember` rejects malformed ids before I/O, then checks the remote member index before reading any
  per-member file; route twins also reject malformed ids. The existing bucket and proxied shard currently still
  send `max-age=300` without `s-maxage`: the uploader change takes effect after the next successful publish,
  with its manifest policy check forcing unchanged objects to receive the new header.
- The status-check CLI also rejects a real code-only commit and accepts code plus STATUS.md over a merge-base
  range in a temporary git repository. Actionlint 1.7.12 passes both workflows. Both YAML documents parse. The pinned checkout, setup-python, cache and setup-node commits match
  their upstream release tags and each action declares the `node24` runtime.
- Latest real-bucket `npm test`: 73 passed, 0 failed, 2 skips (optional local PDF/holdings override and the new
  positions flow, because the published bucket predates it). The CSP test reports zero violations across home,
  a board state and evidence, member, records/CSV, print, wall/year, cases, organisations, method and about.
  The against-zone test now waits for independently loaded board cards before inspecting their tags.
- Remote-mode production build and lint pass against the real R2 bucket from an isolated `web/` copy with no
  `public/data`. This environment requires its outbound HTTP proxy: Node fetch uses `NODE_USE_ENV_PROXY=1`,
  and the verification server's custom HTTP agents receive `proxyEnv` via a scratch preload. This only adapts
  the verification environment's networking; application code, bucket URL and data are unchanged.

Final local real-data verification: the 4,653-page production build and lint passed; all 75 site tests
passed with no skips, including the on-demand positions failure/retry, mobile year headers and exact CSV contents.
Desktop/mobile screenshots were reviewed with no browser errors or failed stylesheets. The `claude/**` checks
workflow passed on GitHub, and data workflow run [43784027285](https://github.com/Fintech-StThomas/Congressional-Trading-Map/actions/runs/43784027285)
completed a full `PT_CACHE_ONLY=1` pipeline and holdings validation with zero failures, correctly skipping publish.
The local holdings validator also checked 25 PDF text samples: all asset words and value bands matched.

### Owner setup: branch protection and R2 environment

1. After the checks workflow has run on GitHub, open repository **Settings → Rules → Rulesets** (or Branches →
   branch protection). Target `main`, require a pull request, and require the checks **Project status**,
   **Pipeline tests**, and **Site checks**. Require the branch to be up to date, disallow force pushes and deletion,
   and apply the rule to administrators where appropriate. Do not enable checks that have never run: GitHub must
   first know their names. Confirm a failing check prevents merging a test pull request.
2. In **Settings → Environments**, create `production`. Set deployment branches to **Selected branches and tags**
   and allow only the branch `main` (no tag pattern). Optionally require an owner review.
3. Add `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` as environment
   secrets, then remove their repository-secret copies. Keep `LDA_API_KEY` and `SEC_USER_AGENT` where the data build
   can use them. Confirm the Cloudflare token is Object Read & Write for this one bucket; rotate if broader.
4. Uncomment `environment: production` under `jobs.refresh` in `data.yml` in a reviewed pull request. Coordinate
   steps 3–4 so no scheduled refresh runs between moving the secrets and merging that line. The environment is
   intentionally not enabled before the owner creates it; silently auto-creating an unrestricted environment
   would provide no isolation.
5. Dispatch **Daily data refresh** on `main`; verify all steps pass, the bucket's `data/meta.json` build time advances,
   and `/data/orgs/00.json` receives an hour of edge caching. Confirm a dispatch on another branch cannot access
   the environment. Branch protection and environment settings cannot be proved by local tests.

## Fix list in priority order

| # | Fix | Why | Effort |
|---|---|---|---|
| 1 | Check member ids against `members.json` before any bucket fetch (S2) | Junk ids cost a function run, a bucket fetch and a cache write each | 10 min |
| 2 | Raise `REVALIDATE_SECONDS` from 900 to 3600 or more (data changes once a day) (L2) | Cuts ISR writes, function runs and CPU by 4x or more | 5 min |
| 3 | Add the security header set below to `next.config.ts` (S1) | No CSP, nosniff, frame protection or Referrer/Permissions policy today | 30 min, plus one preview check |
| 4 | Cache `/portraits/*` and `/geo/*` for a week (L3) | Today `max-age=0, must-revalidate`, so every repeat view re-requests up to 52 images | 5 min |
| 5 | Give the proxied data a longer CDN lifetime (`s-maxage=3600`) at upload (L4) | Edge entries expire after 5 min today, so each region goes back to r2.dev | 5 min |
| 6 | Move the R2 secrets into a GitHub Environment limited to `main` (S6) | Today any collaborator with write access can read them from a branch workflow | 15 min |
| 7 | Add a Vercel Firewall rate-limit rule on `/m/*`, `/board-data/*`, `/board-member/*`, `/cases/*` (S2) | Caps cost amplification and bot crawls | 15 min (dashboard) |
| 8 | Add an uptime and freshness check (L8) | Nobody is told when the site or the data goes stale | 20 min |
| 9 | Put the bucket on a custom domain behind Cloudflare (L5) | Removes the r2.dev limits and gives caching and compression; the step needed to move data traffic off Vercel | 1 h + about $10/year for a domain |
| 10 | Split `trades/K000389.json` by year and trim server-rendered rows on the largest member pages (L6) | 7.5 MB file; that member's page is 973 KB of HTML | half a day |
| 11 | `safeHttpUrl` on the meta source link in `RecordsView` (S5); `installCommand: "npm ci"` (S9) | Defence in depth | 5 min each |

---

## 1. Security findings

Severity is rated for this site: public data, no accounts, nothing stored from users.

| ID | Severity | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|---|
| S1 | Medium | **Missing browser security headers.** Only HSTS (Vercel's default) is sent. No CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`/`frame-ancestors`, COOP or CORP. HTML also carries Vercel's default `access-control-allow-origin: *` (harmless for public pages). | `curl -D - /` returns `strict-transport-security: max-age=63072000; includeSubDomains; preload` and nothing else security-related. `next.config.ts` `headers()` sets only Cache-Control on data paths. | Header set in section 1.1. | 30 min |
| S2 | Medium | **Cost amplification (denial of wallet) through unbounded ids and uncollapsed cold renders.** `/m/<any [A-Za-z0-9_-]>` passes the regex in `getMemberFile` (`web/src/lib/data/server.ts:127`) and goes to the bucket (`members/<junk>.json`, plus `meta.json`) before returning 404. Every distinct junk id is a function run plus a cached 404 (an ISR write). Every distinct query string on `/data/*` is a separate edge cache key and another origin fetch. 50 simultaneous requests for one cold page produced **50 MISS renders**: Vercel did not collapse them. On Hobby, exceeding a quota can pause the project, so this works as a cheap way to take the site down. | `/m/zzjunk25276`: 404 MISS, then HIT on repeat (cached per id). `/data/meta.json?a=1` and `?a=2`: both MISS. Herd test: `/m/K000397` x50 gave 50 MISS, p95 3.8 s; `/board-data/TX` x50 gave 50 MISS. `/board-member/<junk>` and `/board-data/<junk>` are checked against the in-memory index first (cheap). `/cases/...` is validated by `parseCasesPath` (cheap 404). `/o/<junk>` is one static page. | (a) In `getMemberFile`/`getTradeFile`/`getHoldings`: `if (!/^[A-Z]\d{6}$/.test(id)) return null; if (IS_REMOTE && !(await getMemberIndex()).has(id)) return null;`, and in `MemberPage` check `memberIndex.has(id)` before `getMemberFile`. (b) Vercel Firewall rule: rate limit per IP (e.g. 120 req/min) on `/m/`, `/board-data/`, `/board-member/`, `/cases/`, `/data/` (Hobby gets limited custom rules; check Firewall in the project dashboard). (c) Fix L2 (longer revalidate) and L4. | 10 min + 15 min |
| S3 | Low | **Very long ids return an uncached 500.** About 2,000 characters triggers it (1,000 gives 404). The body has only a digest: no stack, path or environment details. | `/m/aaaa…(2000)` gives 500, 22.8 KB generic error page with a `digest` field. | Same id check as S2 (a), which rejects these before rendering. | in S2 |
| S4 | Info | **Data proxy `/data/:path*`: no escape found, not an open proxy.** Destination host is fixed (`remoteRewrite`, `web/src/lib/data/remote.ts:33`). Vercel normalises `..` (stays under `/data/` or falls to a Next 404) and rejects `%2e%2e` (403) and `%00` (400). `..%2f` and double-encoding end in 404s. `//example.com/x` and `https://example.com/` collapse to same-origin 308 redirects (`/data/example.com/x`). `%2f` inside a name decodes to `/` but stays in the bucket. Everything reachable is already public on r2.dev. Query strings are forwarded (see S2). | Probe table in section 1.2. | None needed. Optionally, a Cloudflare cache rule ignoring the query string once the bucket has a custom domain (L5). | — |
| S5 | Low | **One data URL rendered as an href without the http(s) check.** `web/src/components/records/RecordsView.tsx:153` uses `href={x.url}` for `meta.sources[].url`. Every other data-derived link uses `safeHttpUrl` or `recordUrlFor` (`TradesTable`, `DataTable`, `EvidenceDrawer`, `method/page.tsx`, `OrgView`, `OrgReach`, `LedgerTable`). React 19 blocks `javascript:` URLs, so the risk is low and needs a bad build. | Code read. | `const u = safeHttpUrl(x.url); {u && <> · <a href={u} …>}`. | 5 min |
| S6 | Medium | **R2 write keys are repository secrets, readable from any branch.** `data.yml` is well hardened: actions pinned to SHAs, `permissions: contents: read`, `persist-credentials: false`, no `pull_request`/`pull_request_target` trigger (fork PRs cannot reach secrets), and `concurrency` with no cancellation. But anyone with write access can push a branch that edits the workflow and dispatch it, and repository secrets go to every branch. `workflow_dispatch` is limited to users with write access. Its only input is a boolean (no injection). `pip install` is version-pinned but not hash-pinned. | `.github/workflows/data.yml`. | Settings → Environments → `production`: deployment branches = `main` only (optionally a required reviewer). Move `R2_*` secrets there, add `environment: production` under `jobs.refresh`, and protect `main` (PR required). Optionally `pip install --require-hashes` with a `pip-compile --generate-hashes` lock. | 15 min |
| S7 | Info | **R2 token scope implied by the code:** PutObject, GetObject (`_manifest.json`), list and DeleteObjects under `data/` in one bucket (`pipeline/publish_r2.py`). So "Object Read & Write" scoped to that single bucket is the least privilege. Admin or account-wide scope cannot be checked from here. Guards are good: `meta.json` and the manifest are written last, and the mass-delete cap is in place (`MAX_DELETE_SHARE`). Upload is not atomic across files, so a page rendered mid-upload can mix two builds for a few minutes. | Code read. | In Cloudflare, confirm the token is "Object Read & Write" limited to this bucket, with a TTL, and rotate it yearly. | 10 min |
| S8 | Info | **Bucket:** no public listing (`/`, `/data/`, `?list-type=2`, `?prefix=` all give r2.dev's 404 page). **No CORS headers** are returned for a foreign `Origin` (closed, correct). r2.dev does not compress (7.5 MB served as 7.5 MB). | Direct probes. | None. Keep CORS closed unless L5 moves browser fetches to the bucket; then allow GET from the site origin only. | — |
| S9 | Info | **Dependencies.** `npm audit --omit=dev`: 0. With dev: 8 moderate, all `minimatch` ReDoS (GHSA-g3hv-75wg-m249) via `eslint-config-next`, dev-only, not in production. `pip-audit` on `pipeline/requirements.txt` (duckdb 2.0.0, pyarrow 26.0.1, requests 2.34.2, boto3 1.44.3, pytest 9.2.0, moto 5.2.5): no known vulnerabilities. `package-lock.json` is present. Vercel's default install for a lockfile is `npm install`, not `npm ci`. Next 16.4.6, React ^19.2. | Commands run. | Add `"installCommand": "npm ci"` to `web/vercel.json`. Update `eslint-config-next` when a fixed release exists. | 5 min |
| S10 | Info | **XSS and injection: clean.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in `web/src`. Names, descriptions and labels render as React text. `document.title` is set from the org name as text (`OrgView.tsx:50`). Metadata strings go through Next's escaping. The CSV export neutralises formula injection (`csvCell`, `lib/domain/records.ts:171`) and quotes per RFC 4180. JSON export is a Blob download. The correction URL is built with `URLSearchParams` (encoded); its body is short (page, build time, member, record ids), well under GitHub's URL limits, with no explicit cap. Script-tag ids are rejected by the id regex. | Code read; `/m/%3Cscript%3E…` gives a 404 with nothing reflected. | Optional: cap `details` at about 1,500 characters in `correctionIssueUrl`. | — |
| S11 | Info | **Hostile or malformed JSON from a bad build.** `readRemote` throws on non-JSON, so the route shows the generic `error.tsx` (no stack), and Vercel keeps serving the previous ISR copy when a revalidation throws. Hostile strings are escaped (S10); hostile URLs are filtered (except S5). An unexpected shape (missing field) would throw at render, with the same outcome. | Code read. | Optional: a schema check of `members.json`/`meta.json` in the publish step's `--verify`. | — |
| S12 | Info | **Privacy: clean, with cookie-free analytics.** No `Set-Cookie` and no third-party requests. Fonts are self-hosted by `next/font`; the only external origins in the HTML are link targets (github.com and official record sites). **Vercel Web Analytics** (`@vercel/analytics` ^2.0.1, `<Analytics />` in `web/src/app/layout.tsx:94`) was added after the live checks. It was not yet live when re-checked: `/_vercel/insights/script.js` returned 404 and the home HTML did not reference it, so its live traffic is untested. From the package code, production loads `/_vercel/insights/script.js` **same-origin** and posts page views to same-origin `/_vercel/insights/*`. It sets no cookies or local storage; Vercel identifies a visit by a hash of the request with a daily-rotating salt. Each event sends the page URL (query string included, i.e. board state such as `?s=`), the referrer and the browser/OS/country Vercel derives. The debug build in dev loads `https://va.vercel-scripts.com`. Outbound links use `rel="noopener noreferrer"` (or `noreferrer`). The correction link opens a public GitHub issue prefilled with the page URL (query included), build time and record ids; the reader sees it before submitting and needs a GitHub account. | Home HTML scan; headers; `node_modules/@vercel/analytics/dist/next/index.mjs`. | Fine as is. The CSP in 1.1 allows it (`'self'`); in dev only, add `https://va.vercel-scripts.com` to `script-src`. Optionally strip query strings in `beforeSend`. State on `/about` or `/method` that cookie-free page-view counts are collected. Set `Referrer-Policy: same-origin` (S1). After deploy, confirm in DevTools: two same-origin requests per view, no cookies. | 5 min |
| S13 | Info | **Repository hygiene: clean.** Regex sweep of the tree and all 87 commits (AWS/GitHub/Slack/Google key shapes, private keys, `KEY=…` assignments) and `git log -S` on `R2_SECRET_ACCESS_KEY`, `FEC_API_KEY`, `CONGRESS_API_KEY`, `LDA_API_KEY` found only names (docs, workflow, code), never values. 40-character hex strings in history are dataset commit ids in `meta.json`. `.env*` is git-ignored and no env file was ever committed. Source maps are not served (`.js.map` gives 403). `web/public` holds only `geo/` and `portraits/` in git (generated data has since been removed from git; production is remote mode only). `meta.json` has no emails or file paths. `/.env`, `/.git/config` and `/next.config.ts` all give 404. Known and out of scope: old data with minors' names remains in git history (STATUS.md "Next" #1). | Commands run. | Keep the planned history rewrite. Turn on GitHub secret scanning and push protection (free for public repos). | — |
| S14 | Info | Legal notices: the 5 U.S.C. 13107(c) notice and the "not investment advice" wording are present in site copy (not re-audited). | — | — | — |

### 1.1 Implemented security headers (`web/next.config.ts`)

The source of truth is `web/src/lib/security-headers.ts`, imported by `next.config.ts`. Production uses
`default-src 'self'`, allows inline scripts for Next's streamed RSC payload, and allows inline styles for
React style attributes and self-hosted fonts. A nonce would force dynamic rendering and remove the static/ISR
caching this site depends on. The policy blocks third-party scripts, plugins, framing, base-URL hijacking and
connections to other hosts. React escapes all record text; no reader content is reflected as HTML.

Development alone allows eval, WebSockets and the analytics debug host. Preview deployments alone allow the
Vercel toolbar host. HTTPS upgrade is enabled only on Vercel so local HTTP verification works. The response
also sends nosniff, frame denial, a strict-origin-when-cross-origin referrer policy, disabled sensitive browser
features, COOP same-origin and CORP same-origin. The share image overrides CORP to cross-origin.

What this would break, and what to check on a preview deployment:

- **Vercel Toolbar / comments on preview deployments** load from `https://vercel.live`. Either accept losing them or
  add `https://vercel.live` to `script-src`, `connect-src`, `img-src` and `frame-src` on previews only
  (`process.env.VERCEL_ENV === "preview"`).
- **Embedding the site in an iframe** (e.g. a newsroom embedding a board) stops working (`frame-ancestors 'none'`).
  If embedding is wanted, use `frame-ancestors 'self' https://*.example-news.org` or drop it for an `/embed` route.
- **Hotlinking portraits or the og image from another site** in a browser is blocked by `CORP: same-origin`. Social
  crawlers fetch server-side and are not affected. Use `cross-origin` on `/portraits/*` if hotlinking is welcome.
- **CSV/JSON downloads** use `blob:` object URLs with `<a download>`. These are navigations, so CSP does not block
  them. Check once anyway.
- **L5 (bucket on a custom domain, browser fetching it directly)** would need that host in `connect-src`.
- Check after deploying: open home, a board state, a member page, `/m/<id>/records` (CSV/JSON download), `/wall`,
  `/cases`, the print view; DevTools console must show no CSP violations.

### 1.2 Live probe log (data proxy and id routes)

| Request | Result |
|---|---|
| `/data/%2e%2e/meta.json` | 403 (Vercel) |
| `/data/%2e%2e/%2e%2e/`, `/data/x%00.json`, `/m/a%00b` | 400 (Vercel) |
| `/data/..%2fmeta.json`, `/data/%252e%252e%252fmeta.json`, `/data/members/..%2f..%2fx`, `/data/..%2fdata%2fmeta.json` | 404 |
| `/data/../STATUS` (`--path-as-is`) | Next 404 (normalised out of `/data/`) |
| `/data/members/../meta.json`, `/data/./meta.json` | 200 = `data/meta.json` (stays inside `data/`) |
| `/data/https://example.com/`, `/data//example.com/x` | 308 to same-origin `/data/https:/example.com/`, `/data/example.com/x` |
| `/data/meta.json?x=1` | 200, query forwarded, own cache key (MISS) |
| `/m/<junk>`, `/m/%3Cscript%3E…`, `/m/%E2%9C%93`, `/m/..%2fmeta` | 404, cached per id |
| `/m/` + 2,000 characters | 500, generic page with digest only |
| `/board-data/ZZ`, `/board-member/<junk>` | 404 `Not found` (9 bytes) |
| `/cases/page/99999`, `/cases/page/02`, `/cases/page/2/x/y/z` | 404 |
| `/m/K000389/records?page=999999` | 200 cached copy (query ignored by the page cache) |
| bucket `/`, `/data/`, `/?list-type=2`, `/data/?prefix=members` | 404 (no listing) |
| bucket with `Origin: https://evil.example` | no `Access-Control-*` headers |
| `/_next/static/…js.map` | 403 |

---

## 2. Load test results and capacity plan

Setup: `scripts/loadtest/loadtest.mjs` (Node 22 `fetch`, `Accept-Encoding: br, gzip`), run from one cloud machine
through its egress proxy. Cloudflare rays show CMH/ORD, so one US Vercel edge region was exercised. The production
deployment was on the Pro plan during the test.

### 2.1 Baseline (single requests)

Wire size with br vs identity, time to last byte, and cache state. `x-vercel-cache` HIT/STALE means the Vercel edge
served it without the function or bucket.

| Journey | identity | br | Time (br) | Cache |
|---|---|---|---|---|
| `/` | 272 KB | 43 KB | 0.46 s | HIT (ISR) |
| `/wall` | 433 KB | 48 KB | 0.12 s | STALE (served, revalidating) |
| `/cases` | 169 KB | 14.5 KB | 0.09 s | STALE |
| `/o/co:1668501` | 19.8 KB | 5.2 KB | 0.16 s | HIT (one static page) |
| `/m/K000389` (warm, largest member) | **973 KB** | 112 KB | 0.13 s | HIT |
| `/m/M001147` **cold** | 275 KB | 29.5 KB | **1.06 s** first, 0.10 s after | MISS then HIT |
| `/m/K000389/records` | 34.8 KB | 9.9 KB | 0.09 s | HIT |
| `/search-index` | 553 KB | 155 KB | 0.17 s | HIT |
| `/board-data/MN` | 239 KB | 31 KB | 0.55 s cold, 0.20 s warm | MISS then HIT |
| `/data/members/K000389.json` | 1.90 MB | 177 KB | 0.14 s | HIT |
| `/data/orgs.json` | 3.69 MB | 582 KB | 0.17 s | HIT |
| `/data/orgs/00.json` | 207 KB | 38 KB | 0.70 s cold, 0.10 s warm | MISS then HIT |
| `/data/trades/K000389.json` | 7.54 MB | **522 KB** | 0.23 s | STALE (age 1231 s) |
| r2.dev direct `trades/K000389.json` | 7.54 MB | **7.54 MB (no compression)** | 0.42 s | no CDN cache header |
| First-load JS + CSS (14 files) | — | 241 KB | — | immutable |

Findings:

- **Vercel compresses proxied data** (br) and **caches it at the edge**: HIT/STALE with `age`, honouring the
  bucket objects' own `Cache-Control: public, max-age=300, stale-while-revalidate=86400` set by `publish_r2.py`.
  A MISS response shows Next's `max-age=600` header, while HITs show the bucket's `max-age=300`, so the edge lifetime
  in effect is the bucket's 5 minutes.
- r2.dev compresses nothing and sends no CDN cache status. Server-side fetches pull the full raw size (7.5 MB for
  the trades file).
- HTML pages are `max-age=0, must-revalidate` (browser revalidates; edge serves ISR copies). The largest member
  page is 973 KB of HTML (112 KB br), mostly the RSC payload repeating the server-rendered tables.
- `/portraits/*` and `/geo/*` are `max-age=0, must-revalidate`, so they are re-requested on every view. Up to 52
  portrait URLs appear in the home HTML.

### 2.2 Ramp (realistic mix, 300 ms think time, 60 s per stage)

| VUs | Requests | Throughput | p50 | p95 | p99 | max | Errors | Cache mix |
|---|---|---|---|---|---|---|---|---|
| 10 | 1,320 | 21.7 req/s | 87 ms | 468 ms | 656 ms | 1.6 s | 0 | 794 HIT, 525 MISS |
| 25 | 3,564 | 58.8 req/s | 55 ms | 419 ms | 627 ms | 1.2 s | 0 | 2,616 HIT, 945 MISS |
| 50 | 7,963 | 131.8 req/s | 44 ms | 304 ms | 525 ms | 1.1 s | 0 | 6,995 HIT, 967 MISS |
| 100 | 16,753 | **277.2 req/s** | **42 ms** | **132 ms** | **356 ms** | 0.9 s | **0** | 16,160 HIT, 592 MISS |

All 29,600 responses were 200. There were no 403, 429 or 5xx responses and no timeouts. Throughput grew linearly
with VUs, so the server side never saturated: the ceiling seen is the client's think time. Latency fell as the
cache warmed. Every slow request was a MISS, a cold on-demand render or the first edge fetch of a data file. About
4.9 GB was decoded at 100 VUs (about 0.6 GB on the wire at a typical 8:1 br ratio, roughly 80 Mbit/s).

### 2.3 Worst cases

| Test | Result |
|---|---|
| **200 distinct cold member pages, 20 concurrent** | 26.2 pages/s; p50 604 ms, p95 1.97 s, p99 2.35 s, max 2.6 s; 0 errors; 199 MISS. Each renders in a function that fetches `meta.json`, the member file, the trades and holdings files and indexes from r2.dev. No 429 from r2.dev at about 100 bucket fetches/s. |
| **Herd: 50 at once on one cold member page** | 50 MISS (**no request collapsing**): 50 renders, p50 0.95 s, p95 3.8 s, 0 errors. |
| **Herd: 50 at once on cold `/board-data/TX`** | 50 MISS, p50 1.8 s, p95 2.1 s, 0 errors (each run reads every Texas member file). |
| **Herd: 50 at once on a cached page during revalidation (`/cases`)** | 50 HIT, p50 405 ms, p95 609 ms. ISR serves the stale copy and regenerates once in the background, so the herd on a revalidating page is harmless. |
| **r2.dev direct, 100 then 200 simultaneous GETs of one file** | 100: 75.6 req/s, p95 1.1 s; 200: 51.8 req/s, p95 3.5 s, 0 errors, no 429. Latency grows with concurrency, consistent with r2.dev's undocumented throttling (or this machine's proxy). It held up, but it is slower than the Vercel edge. |

**Limiting layer.** Nothing failed up to 100 VUs or 277 req/s. What limits real capacity:

1. **Cold on-demand rendering.** It is 10 to 40 times slower than a hit and is not collapsed, so a burst on a new
   page (a member in the news) costs one function run per request until the first render is cached.
2. **The Vercel plan's monthly quotas** (2.4) bind long before throughput does.
3. **r2.dev** only matters on edge misses and server renders. Its throughput falls under concurrency.

Not tested: multi-region load, sustained runs longer than 60 s, and the herd case at the exact moment a 15-minute
revalidation expires on a hot member page. The `/cases` herd covers the mechanism.

### 2.4 Capacity against Vercel Hobby (from 26 November 2026)

**Assumptions** (check against vercel.com/docs/limits and the project's Usage tab, which now includes today's
test traffic):

- Hobby monthly allowances: Edge Requests 1M, Fast Data Transfer 100 GB, Fast Origin Transfer 10 GB, Function
  Invocations 1M, Active CPU 4 h, ISR Writes 200k and ISR Reads 1M (ISR is metered in 8 KB units).
- Exceeding them on Hobby can pause the project until the cycle resets. Hobby is for non-commercial use, which
  fits a free student project.
- A **first-visit session** = home, open one state on the board, two member pages, one org page:
  - wire bytes: HTML 43 + JS/CSS 241 + portraits about 300 + geo about 35 + search-index 155 + board-data 31
    + member pages 2 x 60 + member data about 50 + org page and shard 43, so **about 1.0 MB**;
  - **about 90 to 100 edge requests** (HTML, 14 static files, about 50 portraits, data, RSC prefetches);
  - a returning visit is about 0.4 MB and about 60 requests while the portraits stay uncached.
- Function runs happen only on cache misses and revalidations. With 15-minute revalidation a touched page renders
  at most 96 times a day. Cold renders measured 0.6 s wall time (mostly I/O); assume about 0.2 s of CPU.

| Quota | Use per first-visit session | Visitors/day at the limit | Notes |
|---|---|---|---|
| **Edge Requests 1M** | about 95 | **about 350/day** | Binding. With L3 (cache portraits and geo) and lazy-loading off-screen portraits, about 50 per session gives about 650/day. Repeat visits gain most. |
| **ISR Writes 200k (8 KB units)** | renders x page size / 8 KB (a 275 KB member page plus its RSC is about 70 units; K000389 about 250) | **about 300 to 1,000/day** with 15-min revalidation | Highly sensitive to `REVALIDATE_SECONDS` and to junk ids (S2). Today's 200-page cold test alone was about 15k units. Check the Usage tab. |
| Active CPU 4 h | about 0.2 s per render | about 2,000/day (around 2.4k renders/day) | Grows with distinct pages touched, not visitors. |
| Fast Origin Transfer 10 GB | about 0.3 MB per render + data edge misses | about 1,500 to 3,000/day | Edge misses re-fetch from r2.dev every 5 min per region (L4). |
| Fast Data Transfer 100 GB | about 1.0 MB | about 3,300/day | Proxied `/data` counts here. |
| Web Analytics events (Hobby: about 50k/month, check the docs) | about 3 page views | about 550/day | Collection stops at the quota; the site keeps working. Each view also adds about 2 same-origin edge requests (script + event). |
| Function Invocations 1M | renders only | about 10,000/day or more | Not binding unless junk ids are sprayed (S2). |

**Bottom line:** after the downgrade, Hobby supports roughly **300 to 400 first-time visitors a day** as the site is
configured now. Edge requests and ISR writes run out first. Web Analytics stops counting at about 550/day, but
the site keeps working. With fixes 1, 2, 4 and 5 that rises to about
**1,000 to 2,000/day**, where CPU and data transfer start to bind. A news spike of tens of thousands of visitors in
a day needs Pro (10M edge requests and 1 TB of transfer included) or L5, which takes the data and portraits off
Vercel entirely. One viral day on Hobby would likely pause the site. The owner should decide before
26 November 2026 whether to keep Pro during news cycles.

### 2.5 Recommendations (ranked by impact for effort)

- **L1 = S2(a): bound the id space.** In `web/src/lib/data/server.ts`:

  ```ts
  const MEMBER_ID = /^[A-Z]\d{6}$/;                       // bioguide ids
  async function knownMember(id: string) {
    return MEMBER_ID.test(id) && (!IS_REMOTE || (await getMemberIndex()).has(id));
  }
  // first line of getMemberFile / getTradeFile / getHoldings:
  if (!(await knownMember(id))) return null;
  ```

  Junk ids then 404 with no bucket fetch: one function run, a small cached 404, and no 500 on long ids. A
  `web/src/proxy.ts` (Next 16 middleware) regex check could 404 earlier without a render, but it runs on every
  `/m/*` request and is metered too, so the data-layer check plus a Firewall rule is the better trade.

- **L2: `REVALIDATE_SECONDS = 3600` (or 21600)** in `web/src/lib/data/remote.ts`. The data is published once a day
  (07:41 UTC), so 15 minutes buys nothing but 4 to 24 times more renders and ISR writes. Better still, call
  on-demand revalidation (`revalidateTag` from a route protected by a secret that the workflow calls after
  `--verify`) and set the timer to 24 h. That costs a new secret and a route.

- **L3: cache static images.** In `next.config.ts` `headers()`:
  `{ source: "/(portraits|geo)/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }] }`.
  Portraits change rarely (rename the file if one changes). Also render off-screen portraits with `loading="lazy"`
  (only 1 of 52 references on the home page is lazy).

- **L4: longer edge lifetime for proxied data.** Set it on the objects, because the edge honours the upstream header
  (`pipeline/publish_r2.py:38`):
  `CACHE_CONTROL = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400"`.
  After the next publish, `curl -sI /data/orgs/00.json` should show `age` climbing past 300 with HIT. Data can then
  be up to an hour old after a publish (it is daily anyway). Optionally add a `CDN-Cache-Control` header in
  `next.config.ts` for `/data/:path*` and check which header Vercel uses.

- **L5: custom domain on the bucket.** Buy any domain (about $10/year; Cloudflare Registrar sells at cost), add it
  to Cloudflare (free plan), then R2 → bucket → Settings → Custom Domains → `data.<domain>`. Disable the r2.dev
  URL afterwards. Add a Cache Rule: hostname `data.<domain>`, eligible for cache, edge TTL 1 h, cache key ignores
  the query string. Cloudflare then compresses JSON (br/gzip) and caches it in front of R2, and the r2.dev limits go
  away. Set `DATA_BASE_URL=https://data.<domain>/data` in Vercel and the `R2_PUBLIC_URL` secret.
  - Server renders get faster and cheaper (compressed, cached), but the browser's `/data` traffic still counts as
    Vercel bandwidth while the rewrite stays.
  - The bigger saving: point `NEXT_PUBLIC_DATA_BASE` at `https://data.<domain>/data` so browsers fetch data
    directly. That needs a bucket CORS rule (GET from the site origin only) and that host in `connect-src`. It
    removes about 30% of requests and most data bytes from Vercel.
  - The same domain can also serve the portraits.

- **L6: shrink the heaviest payloads.**
  - Split `trades/<id>.json` by year (`trades/K000389/2024.json`, plus an index) so pages and the browser fetch only
    what they show.
  - Split `orgs.json` (3.7 MB) into the existing `org-index.json` plus shards. Nothing in the browser fetches it
    today, but the server reads it whole.
  - On member pages, render the first N rows server-side and load the rest from the data file, to cut the
    973 KB HTML and its ISR write units.

- **L7: prebuild the most-visited pages.** The current members (539) and the 56 board-data states via
  `generateStaticParams` in the live twins, so launches and spikes start warm. It adds build time and about 600
  renders per deploy, but removes cold-render herds on the pages people open first.

- **L8: monitoring.**
  - A GitHub Actions `schedule` every 30 min (or a free UptimeRobot / Better Stack check) on `/`, `/data/meta.json`
    and one member page. Fail if the status is not 200 or if `meta.json`'s build time is older than 36 h.
  - Watch Vercel Usage weekly: Edge Requests, ISR Writes, Active CPU, Fast Origin Transfer. Set a spend or usage
    alert on Pro.
  - Watch the Cloudflare R2 dashboard for Class B operations.
  - Watch the share of `x-vercel-cache: MISS` and any 429s from r2.dev in function logs (`[data] 429`).

- **L9: bot rule.** Vercel Firewall: turn on the bot protection managed ruleset if available on the plan. Add a
  per-IP rate-limit custom rule (about 120 req/min) on the dynamic paths, and keep Attack Challenge Mode in mind
  for spikes.

Pre-compressing JSON at upload (`Content-Encoding: br` on the objects) is low priority while the rewrite is in
place: Vercel already compresses what it proxies. It would only cut the server-side fetch bytes and direct r2.dev
bytes, and the L5 custom domain does that more simply.

### 2.6 Re-running

See `scripts/loadtest/README.md`. Defaults are conservative (5 and 10 VUs, 30 s, 1 s think). The commands used
here were `cold --count 200 --concurrency 20 --seed 42`, `herd --concurrency 50` on `/m/K000397`,
`/board-data/TX` and `/cases`, and `ramp --stages 10,25,50,100 --duration 60 --think 300 --seed 7`.
