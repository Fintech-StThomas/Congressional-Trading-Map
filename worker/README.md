<!-- How to deploy and operate the read-only Cloudflare Worker that serves the release archive and legacy data. -->
# Paper Trail release Worker

A small Cloudflare Worker (plain ES modules, no dependencies, no build step) in front of the R2 bucket. It exists
because the archive stores each distinct file once as `releases/blobs/<sha256>` and a release is only a descriptor,
so a URL like `<base>/<release id>/members/A000001.json` has to be translated to a blob. It can also replace the
rate-limited `r2.dev` address for the legacy `data/` tree.

## Routes (GET and HEAD only; anything else is 405)

| Request | Answer |
|---|---|
| `/releases/current.json`, `/releases/index.json` | The pointer and the history list, `Cache-Control: no-cache, max-age=0, must-revalidate`. 404 when missing. |
| `/releases/<64 hex>/<path>` | The file at `<path>` in that release. 404 when the id or path is invalid, the release has a tombstone (`releases/withdrawn/<id>.json`), has no descriptor, or the path is not in it. 502 `Release data is unavailable.` when the descriptor names a blob that is missing or has the wrong size. Immutable cache headers, ETag `"<sha256>"`, `304` for a matching `If-None-Match`. `Content-Type` comes from the requested path's extension (a blob can be shared by two paths of different types). |
| `/data/<path>` | Pass-through to the legacy `data/<path>` object, `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`; 404 when missing. |
| anything else | 404. The bucket is never listed. |

Path rules are a port of `validate_path` in `pipeline/release_manifest.py` (no empty, `.` or `..` segment, no
backslash, colon or control character, `release.json` and `_manifest.json` reserved at the root of a release).
`worker/test/path-cases.json` is checked by both the Node and the Python tests so the two cannot drift.

A withdrawal takes effect on the next request in each Worker instance that has not looked in the last 30 seconds.
Descriptors are cached by release id (in memory, and in the Workers Cache API); a tombstone is always checked first.

## Deploy (once)

1. Edit `wrangler.toml`: set `bucket_name` to your R2 bucket (the value of the `R2_BUCKET` secret).
2. From this directory, with Node 20 or later:
   ```bash
   npx wrangler login
   npx wrangler deploy
   ```
3. Wrangler prints the address, `https://paper-trail-releases.<account>.workers.dev` (the first part is the `name`
   in `wrangler.toml`). Check it:
   ```bash
   curl -i https://paper-trail-releases.<account>.workers.dev/releases/current.json
   curl -I https://paper-trail-releases.<account>.workers.dev/data/meta.json
   ```
4. Point the site at it (Vercel, then redeploy): `RELEASE_BASE_URL` = `https://<worker>/releases`, and optionally
   `DATA_BASE_URL` = `https://<worker>/data`. Details and the order of switching: `docs/RELEASE-OPERATIONS.md`.

The free `workers.dev` plan allows 100,000 requests per day. Workers serve the site's server-side reads; the browser
does not call the Worker directly (the site proxies it). A custom domain requires a domain on Cloudflare.

## Tests

```bash
node --test worker/test
```

They run against a fake bucket and a fake Cache API. Nothing here has run on Cloudflare itself.
