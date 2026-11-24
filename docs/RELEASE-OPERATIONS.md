<!-- Owner runbook for the immutable release archive: layout, Worker, activation order, rollback, withdrawal, storage. -->
# Release operations

Status (2026-11-24): **live.** The archive has run in the daily job on the real R2 bucket since 2026-11-16 (first
release `f86168d2...`, 10 or more releases since), the Worker has served it from
`https://paper-trail-releases.lota-inc0.workers.dev` since then, and the public site reads only archived releases
(`RELEASE_BASE_URL` is set in Production). What has **not** been run for real is the withdrawal command: it is
tested only against a fake S3 (moto) and a fake R2 binding, never against the real bucket, Vercel or Cloudflare.
The activation checklist below is kept as the record of the order that was followed and as the procedure for a
second environment.

The legacy publisher (`pipeline/publish_r2.py`, prefix `data/`) stays the production path throughout. The archive
lives under `releases/` and is never touched by the legacy cleanup. A checksum identifies bytes; it does not
show who made them or that a record is accurate.

## What exists in the bucket

| Key | Meaning |
|---|---|
| `releases/blobs/<sha256>` | The exact bytes of one distinct file, stored once however many releases contain it. Immutable cache headers; `Content-Type` from the first path that uploaded it. |
| `releases/<release_id>/release.json` | The release: its descriptor (`path -> {sha256, bytes}`), written only after every blob it names is verified. |
| `releases/current.json` | The pointer. The only authority for "current". No-cache headers. |
| `releases/index.json` | History list (newest first, 10,000 at most). Not the authority for "current" (the pointer is), but the site's allow-list: `/r/<id>/...` is served only for a listed release (or the current one), and `/changes` reads it. A release missing from it is unreachable by permalink. |
| `releases/withdrawn/<release_id>.json` | Tombstone for a withdrawn release. |
| `release-provider-check/<run id>/...` | Disposable keys of the provider check; deleted by the check itself. |

The release ID is unchanged: the hash of the descriptor's identity. Shapes are in `docs/data-dictionary.md`.
This layout replaced an earlier per-release copy before anything was archived in production, so there was no migration.

Readers never see blobs. The Cloudflare Worker (`worker/`) answers `<base>/current.json`, `<base>/index.json` and
`<base>/<id>/<path>` exactly as before and looks the path up in the descriptor. Two paths whose files have identical
bytes share one blob; the Worker sets the `Content-Type` from the requested path, so the type stored on the blob
does not matter to readers.

## Publishing rules

- **Daily releases store only changed files.** Each distinct file is HEADed (`If-None-Match: *` creates only
  what is absent). A new blob is read back in full and hashed. A reused blob is checked by HEAD: it exists, its size
  equals the descriptor's, its `Cache-Control` and `Content-Encoding` are right. Its bytes are not re-read.
- **A day with no data change creates no release.** If the files other than `meta.json` are byte-identical to the
  current release's, publishing logs `no data change; release <id> stays current`, exits 0 and moves nothing (it
  still repairs a missing index entry for the current release). `meta.json` changes every day, so without this rule
  every day would be a new release. Consequence: the pinned site's "data as of" time is the last day the data
  changed; the legacy `data/meta.json` (and the freshness alert) track the daily build.
- **The descriptor is the completion marker**, written after every blob is verified. A failed run leaves some
  unreferenced blobs; they are harmless and reused by the next run.

### Verification trade-off

Reading back and hashing 3,800 blobs on every activation would cost 3,800 reads a day. Chosen instead:

| When | Check | Cost |
|---|---|---|
| Blob newly uploaded | full read-back: headers, length, SHA-256 | one GET per new blob (about 125 a day) |
| Blob reused (publish) | HEAD: exists, size, headers | one HEAD per distinct blob |
| Rollback / `--release ... --activate` | descriptor validated; HEAD of every blob; `meta.json` read and hashed | one HEAD per blob plus one GET |
| Rollback with `--full-verify` (or the `full_verify` input) | every blob read back and hashed | one GET per blob; slow |

What this does not catch: a reused or rollback-target blob that was corrupted **without changing its size** (storage
corruption is not expected on R2, but the check cannot rule it out). Run `--full-verify` after any suspected
storage incident and before relying on an old release for a citation. The Worker also refuses (502) a blob whose
size differs from the descriptor. A checksum identifies bytes; it does not show who made them or that a record is
accurate.

### Measure storage

`python -m pipeline.publish_release --dir web/public/data --activate --measure` (the daily workflow passes it) prints
files in the release, distinct blobs, blobs new and reused, new bytes this run and the total archive blobs and
bytes. The total comes from one listing of `releases/blobs/` (1 listing request per 1,000 blobs; a few dozen a day
at most), which was chosen over adding a field to `index.json` so the index keeps its strict shape and the figure
is always the real object sizes. Read the "archive bytes total" line in the step log to see actual growth.

## Cloudflare Worker and site settings

1. **Deploy the Worker** (once): follow `worker/README.md` (`npx wrangler login`, `npx wrangler deploy`). You get
   `https://paper-trail-releases.<account>.workers.dev`. Check `/releases/current.json` and `/data/meta.json` on it.
2. **Vercel settings**: `RELEASE_BASE_URL` = `https://<worker>/releases`; optionally `DATA_BASE_URL` =
   `https://<worker>/data` to stop depending on the rate-limited `r2.dev` address. Redeploy after changing either.
3. **Custom domain**: `red-paper-trail.vercel.app` cannot be used for the Worker. To use a custom domain with the
   Worker you must buy or transfer a domain to Cloudflare and attach it in the Worker's settings.
4. **Limits**: the free `workers.dev` plan allows 100,000 requests per day. The site proxies the Worker, so the
   count is server-side reads, not visitors. Check the Worker's request graph in the Cloudflare dashboard after the
   switch; move to a paid plan or a custom route if it nears the limit.
5. **Repository variables** used by the workflows: `PT_PUBLISH_RELEASES` (archive switch), `SITE_URL` (cache
   warming after the daily publish, `https://host`; unset = skipped), `DATA_PUBLIC_URL` (freshness alert; falls back
   to the `R2_PUBLIC_URL` secret used only as a URL).

## Activation checklist (in this order)

1. **Run the provider check.** Actions -> "Release staging and rollback" -> Run workflow -> `provider-check`
   (or `python -m pipeline.release_provider_check` with the four `R2_*` variables set). Every line must say PASS:
   create-once, second create rejected, headers round-trip, body read-back, HEAD metadata, listing sizes, delete
   idempotent, `If-Match` current succeeds, `If-Match` stale rejected, cleanup. If any line fails, stop. The archive
   relies on those semantics for its no-overwrite and single-pointer guarantees, and a provider that ignores them
   must not hold the archive.
2. **Deploy the Worker** and check it against the bucket (above).
3. **Set the repository variable `PT_PUBLISH_RELEASES` to `1`** (Settings -> Secrets and variables -> Actions ->
   Variables). It is the one switch. Unset or any other value leaves the daily job exactly as it was. The step
   runs only on the default branch of the main repository.
4. **Observe one daily run.** The step "Archive immutable release" should be green after "Publish to R2 and verify
   the public URL". Check that `releases/<id>/release.json`, `releases/current.json` and `releases/index.json`
   exist and that the pointer's `release_id` equals the index's first entry. Read the `--measure` lines. If the
   step fails, read its log: it says whether the pointer moved. Re-running is safe.
5. **Vercel Preview**: set `RELEASE_BASE_URL` on a Preview deployment only, and run the pinned-release checks
   (`web/README.md`) against it.
6. **Vercel Production**: set `RELEASE_BASE_URL` in Production and redeploy.
7. **Keep legacy `DATA_BASE_URL` publishing** until the pinned readers are verified in production. Removing the
   legacy publisher is a separate, explicit change.

## Rollback

- **Data**: Actions -> "Release staging and rollback" -> `rollback` with the 64-character release ID of a previously
  verified release. It verifies the release as in the table above (add `full_verify` for a full hash read-back), then
  moves the pointer with a conditional write and records it in the index. A withdrawn release cannot be activated.
  The next daily run moves the pointer forward again when the data changed; to hold a rollback, unset
  `PT_PUBLISH_RELEASES` first. (A daily run whose data equals the rolled-back release's files other than
  `meta.json` is a no-change day and leaves the rollback in place.)
- **Site**: unset `RELEASE_BASE_URL` and redeploy. The site then reads the legacy `data/` tree again.
- **Stop archiving**: unset `PT_PUBLISH_RELEASES`. Existing releases stay.

## Withdrawal policy

Withdrawal is for **discovered privacy or legal exposure only**: for example a minor's name or a personal
identifier that got past the validators. The owner decides; nobody else should run it.

- A normal correction, an amended filing or a bug fix is a **new release**. Old bytes are never rewritten.
- The current release cannot be withdrawn. Activate another verified release first.
- **Blobs are shared, so exposure is shared.** The command never deletes a blob that any live (non-withdrawn)
  release outside the withdrawn set still references. Bytes that hold the exposed data and are also referenced by
  other live releases mean those releases expose it too: the command lists them and refuses, changing nothing,
  unless `--also-withdraw` names every one of them. A release that is current and shares the exposed bytes blocks
  the withdrawal until you publish or activate one that does not.
- Say which file holds the exposed data with `--exposed-path <path in the release>` (repeatable). Without it every
  file of the release is treated as exposed, which in practice lists almost every release (they all share most
  blobs); that is the safe default, not a bug.
- Run from a trusted machine with the `R2_*` variables, when no daily run is in progress:
  `python -m pipeline.withdraw_release --release <id> --reason privacy|legal|other --confirm <id> [--exposed-path <path> ...] [--also-withdraw <id> ...]`.
  Order: tombstones first, then the blobs no live release uses (exact `releases/blobs/<sha256>` keys), then the
  descriptors (so an interrupted run can be repeated), then one index update. The live-release list is recomputed
  right before deleting; a release that appeared in between and shares exposed bytes stops the run after the
  tombstones (re-run with `--also-withdraw`). If it stops part-way, run it again.
- The reason is one of three words; no free text is stored. Keep the real explanation in your own records.
- After withdrawal publishing or activating the same bytes is refused, because the release ID is the hash of
  the bytes. The Worker answers 404 for a tombstoned release (checked at most 30 seconds late per instance).
- Blobs left unreferenced by failed publishes (not by withdrawals) are not found or removed by any command yet.

What readers see: a citation or permalink to a withdrawn release shows an explicit "not available" page and never
falls back to the latest data. The site accepts `/r/<id>/...` only for an id that `releases/index.json` lists (or
the current release) and re-reads that list at most every 5 minutes (`LISTING_REVALIDATE_SECONDS`), and the permalink
pages re-run that check at most every 5 minutes (`revalidate = 300`). The withdrawal command removes the entry from
the index, so **HTML permalink pages stop rendering within about 10 minutes** (5 for the list, 5 for the page) even if
Vercel's Data Cache still holds the files. **JSON routes (`/r/<id>/board-data`, `board-member`, `search-index`) and
`/releases/<id>/...` files are cached as immutable (up to a year at the CDN), so they keep answering until the CDN
and Data Cache are purged: the purge below is required, not optional.**

**After the command finishes, purge the caches** (owner, same day; each step is manual):

1. **Vercel Data Cache and CDN.** Pinned reads use `fetch(..., { cache: "force-cache" })`, and Vercel's Data Cache
   persists across deployments, so a redeploy alone does not clear it. From `web/` with the Vercel CLI linked to the
   project: `vercel cache purge --type data` then `vercel cache purge --type cdn` (or `vercel cache purge` for all
   types; checked against the Vercel CLI docs on 2026-11-24). The dashboard has the same under Project -> Settings ->
   Caches. Purging the Data Cache makes the next visit re-read from the Worker, which answers 404 for the withdrawn
   release.
2. **Cloudflare.** The Worker already answers 404 for a tombstoned release within 30 seconds per instance, and a
   cached descriptor is never used without the tombstone check. Browsers and any CDN in front of the Worker may
   still hold a 200 for up to one day (browser) or one year (edge, `s-maxage`). If the Worker is reached through a
   Cloudflare cache rule or custom domain, purge that zone's cache for `/releases/<id>/*` (Caching -> Configuration
   -> Purge by URL, or the API); for the plain `workers.dev` address there is no zone to purge, and the tombstone
   check is the control.
3. **Redeploy the site** (Vercel -> Deployments -> Redeploy, or push to `main`) so older deployments' build output
   no longer renders the release, then open `/r/<id>/m/<member id>` and `/releases/<id>/meta.json` on the site and the
   Worker and confirm both answer 404 (with `Cache-Control: no-store`).
4. Tell anyone who holds a citation to the withdrawn release; the permalink will say it is not available.

What withdrawal does **not** do: browser caches, caches outside your control and earlier site deployments may keep
serving the bytes until they expire or are purged. Anyone who already downloaded the data keeps it. Withdrawal
limits future exposure; it cannot recall past copies.

**Release ids that were never published.** The site rejects a `/r/<id>/...` whose id is not in `releases/index.json`
before any Worker call, and the Worker remembers a missing descriptor for 5 minutes (memory and Cache API), so a
made-up id costs one bucket read per window. A just-published release that was requested within those 5 minutes
before it existed may answer 404 until the window ends.

**Error responses are never cached as immutable.** The Worker sends `no-store` on every 404, 405 and 502 and the
one-year immutable policy only on 200 and 304; the site passes the Worker's headers through under `/releases/<id>/`
and sets the immutable policy on `/r/<id>/board-data`, `board-member` and `search-index` only for a 200.

**A failed index write.** The index is written after the pointer moves. If that write fails, the run says so and
re-running repairs it; a no-change run re-adds the current release, and the next activation also adds the release that
was current before it, so a failed write cannot leave a release unlisted. Until repaired, that release's `/r/<id>/...`
permalinks answer "not available" (the current release is still served, because the site also accepts the pointer's id).

## Storage growth and retention

The owner chose daily refreshes with permanent releases that store only changed files, to stay inside Cloudflare R2's
free tier: 10 GB-month of storage, 1 million Class A (write/list) and 10 million Class B (read) requests a month,
free DeleteObject, and $0.015 per GB-month beyond.

Measured when the archive was first designed: a full tree is about **306 MB in 3,811 files**; one measured
day-over-day publish changed **125 of 3,056 files**. **Estimate only:** if every day changed about that share of files (4%) and those files
averaged the tree's average size, a day would add about 12 MB, a year about 4.5 GB, on top of the first 306 MB and the
legacy `data/` copy (about the same size again); the free 10 GB would last roughly two years at that rate. File
size, how often large files change and no-change days (which add nothing) all move the real figure, so **the real
number comes from the `--measure` output** ("new bytes this run", "archive bytes total"), not from this paragraph.

Requests per daily run, from the code (not measured against the provider): one HEAD per distinct blob (about 3,000
Class B), one PUT and one read-back GET per new blob (about 125 each), the descriptor, the pointer and index, and a
handful of listing calls for `--measure`: well inside the monthly allowances. A rollback is one HEAD per blob.
Blobs are de-duplicated across releases, so a release costs only its changed files plus a descriptor; the first
archive was 300.8 MiB in total (STATUS.md, run 43956409693), not that much per day. Read the real growth from the
"archive bytes total" line of the daily run.

**Open owner decision: retention.** No command deletes old releases, and deleting a release's descriptor does not
free its blobs until they are unreferenced. Thinning (for example one release a month after N days) would need a
garbage-collection command that deletes only blobs referenced by no remaining descriptor, and must keep every
release a published citation refers to. That command does not exist yet; decide whether storage growth ever makes
it necessary after reading a few months of `--measure` output.

## Alerts and cache warming

- **Freshness alert** (`.github/workflows/freshness.yml`): every 6 hours it reads `<DATA_PUBLIC_URL>/data/meta.json`
  and fails (GitHub emails the owner) when `build.time` is older than 48 hours or the file cannot be fetched. It
  reads only; it never prints the URL.
- **Cache warming** (data.yml, after the legacy publish): requests the home page, `/wall`, `/cases`, `/delays`,
  `/orgs`, `/feed/trades.xml` and the 10 members with the most trades on `SITE_URL`. It logs status codes and never
  fails the job.

## Not verified

- The withdrawal command (`pipeline.withdraw_release`) has never run against the real bucket, and the purge steps in
  "Withdrawal policy" have not been exercised on Vercel or Cloudflare. Rehearse it on a release created for the
  purpose (never a cited one) before relying on it.
- Worker behaviour that depends on Cloudflare itself (the Cache API negative entry for a missing descriptor, which
  needs a `wrangler deploy` of the current `worker/` code to take effect) is tested here only against fakes.
- Branch dispatches of the daily job run without `LDA_API_KEY`, `FEC_API_KEY` and `SEC_USER_AGENT`: they build and
  validate, but the FEC leadership-PAC sponsors and purpose groups are published as null with a warning, and SEC
  requests use the default User-Agent. Only the default branch of the main repository receives those three secrets.
- Branch protection and the `production` environment are owner settings (`docs/SECURITY-REVIEW.md`, S6). `data.yml`
  already enters `production` for default-branch runs; the R2 secrets and the three API settings are still repository
  secrets until the owner moves them into that environment.
- The release list is capped at 10,000 entries (about 27 years of daily releases); beyond that the oldest permalink is refused by the site
  until retention is decided. Nothing near the cap has been exercised.
