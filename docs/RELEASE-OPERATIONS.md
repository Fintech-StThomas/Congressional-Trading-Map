<!-- Owner runbook for the immutable release archive: activation order, rollback, withdrawal policy, storage. -->
# Release operations

Status: **nothing in this document has been run against the real storage provider.** The archive publisher, the
history index, the withdrawal command and the provider check are tested only against a fake S3 (moto) and fakes
that do or do not enforce conditions. No R2 credentials were available when they were written. The first real
run is the provider check below, and its result decides whether anything else may be switched on.

The legacy publisher (`pipeline/publish_r2.py`, prefix `data/`) stays the production path throughout. The archive
lives under `releases/` and is never touched by the legacy cleanup. A checksum identifies bytes; it does not
show who made them or that a record is accurate.

## What exists in the bucket

| Key | Meaning |
|---|---|
| `releases/<release_id>/...` | Exact bytes of one release, plus `release.json` written last. Immutable cache headers. |
| `releases/current.json` | The pointer. The only authority for "current". No-cache headers. |
| `releases/index.json` | History list (newest first, 400 at most) for a future compare view. Never authoritative. |
| `releases/withdrawn/<release_id>.json` | Tombstone for a withdrawn release. |
| `release-provider-check/<run id>/...` | Disposable keys of the provider check; deleted by the check itself. |

Shapes are in `docs/data-dictionary.md`.

## Activation checklist (in this order)

1. **Run the provider check.** Actions -> "Release staging and rollback" -> Run workflow -> `provider-check`
   (or `python -m pipeline.release_provider_check` with the four `R2_*` variables set). Every line must say PASS:
   create-once, second create rejected, headers round-trip, body read-back, `If-Match` current succeeds, `If-Match`
   stale rejected, cleanup. If any line fails, stop. The archive relies on those semantics for its no-overwrite
   and single-pointer guarantees, and a provider that ignores them must not hold the archive.
2. **Set the repository variable `PT_PUBLISH_RELEASES` to `1`** (Settings -> Secrets and variables -> Actions ->
   Variables). It is the one switch. Unset or any other value leaves the daily job exactly as it was. The step
   runs only on the default branch of the main repository.
3. **Observe one daily run.** The step "Archive immutable release" should be green after "Publish to R2 and verify
   the public URL". Check that `releases/<id>/release.json`, `releases/current.json` and `releases/index.json`
   exist and that the pointer's `release_id` equals the index's first entry. If the step fails, read its log: it says
   whether the pointer moved. Re-running is safe.
4. **Vercel Preview**: set `RELEASE_BASE_URL` (the public base for `releases/`) on a Preview deployment only, and
   run the web pinned-release checks (the web workers' task; see `web/README.md`) against it.
5. **Vercel Production**: set `RELEASE_BASE_URL` in Production and redeploy.
6. **Keep legacy `DATA_BASE_URL` publishing** until the pinned readers are verified in production. Removing the
   legacy publisher is a separate, explicit change.

Before step 2, the owner should also decide the retention question below, because every day adds a full copy.

## Rollback

- **Data**: Actions -> "Release staging and rollback" -> `rollback` with the 64-character release ID of a previously
  verified release. The command re-verifies every object of that release (bytes, sizes, headers) and only then moves
  the pointer with a conditional write, and records it in the index. A withdrawn release cannot be activated. The
  next daily run will move the pointer forward again; to hold a rollback, unset `PT_PUBLISH_RELEASES` first.
- **Site**: unset `RELEASE_BASE_URL` and redeploy. The site then reads the legacy `data/` tree again.
- **Stop archiving**: unset `PT_PUBLISH_RELEASES`. Existing releases stay.

## Withdrawal policy

Withdrawal is for **discovered privacy or legal exposure only**: for example a minor's name or a personal
identifier that got past the validators. The owner decides; nobody else should run it.

- A normal correction, an amended filing or a bug fix is a **new release**. Old bytes are never rewritten.
- The current release cannot be withdrawn. Activate another verified release first.
- Run: `python -m pipeline.withdraw_release --release <id> --reason privacy|legal|other --confirm <id>` from a
  trusted machine with the `R2_*` variables. It writes the tombstone first, then deletes every object under
  `releases/<id>/` (that exact prefix only), then removes the index entry. If it stops part-way, run it again.
- The reason is one of three words; no free text is stored. Keep the real explanation in your own records.
- After withdrawal publishing or activating the same bytes is refused, because the release ID is the hash of
  the bytes.

What readers see: a citation or permalink to a withdrawn release must show an explicit "not available" message.
It must never fall back to the latest data. (Reader behaviour belongs to the web work; it is not verified here.)

What withdrawal does **not** do: cached pages, browser caches, CDN copies (the archive objects are served with a
one-year immutable cache header) and earlier site deployments may keep serving the bytes until they expire or are
redeployed or purged. Purging the CDN and redeploying the site are separate manual steps. Anyone who already
downloaded the data keeps it. Withdrawal limits future exposure; it cannot recall past copies.

## Retention and storage

Each daily release stores a **full copy** of the tree. There is no cross-release de-duplication yet, even when most
files are byte-identical to the previous day.

Measured in this session from the public `data/meta.json` (build time 2026-11-15T15:02:21Z), field `files`:
**235,945,292 bytes (about 225 MiB, 236 MB) in 2,301 files**. The legacy `data/_manifest.json` from the same
bucket lists 3,056 entries, so it describes more files than `meta.json` counts. Whether the extra entries belong
in a release was not investigated; the release would contain every file in the validated tree. I did not
download or sum individual object sizes, so treat 236 MB as the order of magnitude, not an exact release size.

Arithmetic from that figure (storage only, no pricing quoted; look up current R2 rates):

| Period | Full copies | Approximate stored bytes |
|---|---|---|
| 1 day | 1 | 0.24 GB |
| 30 days | 30 | 7.1 GB |
| 1 year | 365 | 86 GB |

Requests per daily archive, from the code: for each of about 2,300 files one existence read, one conditional
write and one verifying read (about 6,900 requests), plus the descriptor and pointer. A rollback re-reads every
file of the target release. These counts are not measured against the provider.

**Open owner decision: a retention or thinning policy** (for example keep daily releases for N days, then one per
month). None exists, and no command deletes old releases except the withdrawal command. Decide before the archive
has run long enough to matter. Any thinning must keep every release that a published citation refers to, or the
citation will say "not available".

## Not verified

- Nothing here has run against the real provider (no credentials in the authoring session). Conditional writes
  (`If-None-Match: *`, `If-Match`) on R2 through boto3 are assumed to work until the provider check says so.
- The workflows have been parsed as YAML but not executed on GitHub. The `PT_PUBLISH_RELEASES` variable gating,
  the default-branch guard and secrets in the new step need one observed run.
- Reader behaviour for pinned, missing and withdrawn releases (the web side) is not covered here.
- Branch protection and the `production` environment are owner settings (`docs/SECURITY-REVIEW.md`, S6); once the
  environment exists, enable `environment: production` in both workflows together.
