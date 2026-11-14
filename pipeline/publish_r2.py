"""Upload web/public/data to Cloudflare R2 under `data/` (S3-compatible API). See pipeline/README.md ("Publishing to R2").

    python -m pipeline.publish_r2 [--dir web/public/data] [--verify]

Environment: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (all four, or the upload is skipped
with a message and exit 0, so local runs and forks work); R2_PUBLIC_URL for --verify.

Order of operations, so a reader never sees a manifest that claims content the bucket does not hold:
1. local manifest: every file's path -> sha256;
2. remote manifest `data/_manifest.json` (missing or unreadable: upload everything);
3. upload changed files (retrying transient failures), meta.json last of the data files;
4. only if every upload succeeded: upload the new manifest, then delete objects under `data/` that are no longer
   in the build. Any failure exits 1 and leaves the previous manifest in place (files that did upload are
   re-uploaded next time, because the old manifest still lists their old hashes).
Readers can treat meta.json's build time as the switch: it is written after every other data file.
Secrets are never printed (nor the endpoint, which contains the account id).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from .util import OUT

PREFIX = "data/"
MANIFEST = "_manifest.json"
LAST = "meta.json"                       # uploaded after every other data file
CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"   # same URLs are overwritten daily
REQUIRED_ENV = ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
ATTEMPTS = 4
WORKERS = 16
# Refuse to delete more than this share of the remote objects in one run (a broken, near-empty build must not
# wipe the bucket); --allow-mass-delete overrides.
MAX_DELETE_SHARE = 0.5


class PublishError(Exception):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def local_manifest(root: Path) -> dict[str, str]:
    """Relative POSIX path -> sha256 for every file under root (sorted)."""
    return {p.relative_to(root).as_posix(): sha256(p) for p in sorted(root.rglob("*")) if p.is_file()}


def content_type(rel: str) -> str:
    if rel.endswith(".json"):
        return "application/json"
    return mimetypes.guess_type(rel)[0] or "application/octet-stream"


def _code(exc: Exception) -> str:
    """A short, secret-free description of a client error (never the message, which can carry the endpoint)."""
    resp = getattr(exc, "response", None) or {}
    code = resp.get("Error", {}).get("Code")
    status = resp.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return f"{type(exc).__name__}" + (f" {code}" if code else "") + (f" HTTP {status}" if status else "")


def _transient(exc: Exception) -> bool:
    resp = getattr(exc, "response", None)
    if not resp:
        return True                    # connection reset, timeout, endpoint unreachable
    status = resp.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0
    code = resp.get("Error", {}).get("Code", "")
    return status >= 500 or status == 429 or code in ("SlowDown", "RequestTimeout", "InternalError", "ServiceUnavailable")


def retry(fn: Callable[[], Any], what: str, sleep: Callable[[float], None] = time.sleep, attempts: int = ATTEMPTS) -> Any:
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - classified below; re-raised when not transient
            if i == attempts - 1 or not _transient(exc):
                raise PublishError(f"{what}: {_code(exc)}") from None
            sleep(2 ** i)


def read_remote_manifest(client: Any, bucket: str, prefix: str) -> dict[str, str] | None:
    """The `files` map of the remote manifest, or None when it is missing or unreadable."""
    try:
        body = retry(lambda: client.get_object(Bucket=bucket, Key=prefix + MANIFEST)["Body"].read(), "read manifest")
    except PublishError as exc:
        print(f"remote manifest not readable ({exc}); uploading every file")
        return None
    try:
        files = json.loads(body)["files"]
        assert isinstance(files, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in files.items())
        return files
    except Exception:  # noqa: BLE001
        print("remote manifest malformed; uploading every file")
        return None


def put(client: Any, bucket: str, key: str, body: bytes, ctype: str, sleep: Callable[[float], None]) -> None:
    retry(lambda: client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype, CacheControl=CACHE_CONTROL),
          f"upload {key}", sleep)


def remote_keys(client: Any, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    token: str | None = None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix, **({"ContinuationToken": token} if token else {})}
        page = retry(lambda: client.list_objects_v2(**kw), "list objects")
        keys += [o["Key"] for o in page.get("Contents", [])]
        if not page.get("IsTruncated"):
            return keys
        token = page["NextContinuationToken"]


def publish(client: Any, bucket: str, root: Path, prefix: str = PREFIX, sleep: Callable[[float], None] = time.sleep,
            workers: int = WORKERS, allow_mass_delete: bool = False) -> dict[str, Any]:
    """Upload root to bucket/prefix as described in the module docstring. Returns counts; raises PublishError."""
    if not (root / LAST).is_file():
        raise PublishError(f"{root} has no {LAST}; refusing to publish an incomplete build")
    files = local_manifest(root)
    if MANIFEST in files:
        raise PublishError(f"{MANIFEST} is reserved for the uploader")
    build_time = json.loads((root / LAST).read_text())["build"]["time"]
    remote = read_remote_manifest(client, bucket, prefix)
    changed = [p for p, h in files.items() if remote is None or remote.get(p) != h]
    first = [p for p in changed if p != LAST]
    print(f"{len(files)} files; {len(changed)} to upload ({'no remote manifest' if remote is None else 'changed'})")

    failed: list[str] = []

    def one(rel: str) -> str | None:
        try:
            put(client, bucket, prefix + rel, (root / rel).read_bytes(), content_type(rel), sleep)
            return None
        except PublishError as exc:
            print(f"  failed: {exc}")
            return rel

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        failed = [r for r in pool.map(one, first) if r]
    if failed:
        raise PublishError(f"{len(failed)} of {len(first)} uploads failed; meta.json, manifest and deletions skipped")
    if LAST in changed:
        put(client, bucket, prefix + LAST, (root / LAST).read_bytes(), content_type(LAST), sleep)
    manifest = {"build_time": build_time, "prefix": prefix, "files": files}
    put(client, bucket, prefix + MANIFEST, json.dumps(manifest, indent=0, sort_keys=True).encode(), "application/json", sleep)

    keep = {prefix + p for p in files} | {prefix + MANIFEST}
    existing = remote_keys(client, bucket, prefix)
    stale = sorted(k for k in existing if k not in keep)
    if stale and not allow_mass_delete and len(stale) > max(100, MAX_DELETE_SHARE * len(existing)):
        raise PublishError(f"{len(stale)} of {len(existing)} remote objects would be deleted; refusing "
                           "(pass --allow-mass-delete if intended)")
    for i in range(0, len(stale), 1000):
        batch = stale[i:i + 1000]
        res = retry(lambda: client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True}),
                    "delete objects", sleep)
        if res.get("Errors"):
            raise PublishError(f"{len(res['Errors'])} deletions failed")
    out = {"files": len(files), "uploaded": len(changed), "deleted": len(stale), "build_time": build_time}
    print(f"published: {out}")
    return out


def verify(public_url: str, build_time: str, attempts: int = 6, sleep: Callable[[float], None] = time.sleep) -> None:
    """Fetch <public_url>/data/meta.json (cache-busting query) and compare the build time."""
    import requests

    url = f"{public_url.rstrip('/')}/{PREFIX}{LAST}"
    got = None
    for i in range(attempts):
        try:
            r = requests.get(url, params={"v": build_time}, timeout=30, headers={"Cache-Control": "no-cache"})
            if r.ok:
                got = r.json().get("build", {}).get("time")
                if got == build_time:
                    print(f"verified: public meta.json build time {got}")
                    return
        except Exception:  # noqa: BLE001
            pass
        sleep(5 * (i + 1))
    raise PublishError(f"public meta.json build time {got!r} != {build_time!r}")


def client_from_env() -> tuple[Any, str] | None:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(f"R2 upload skipped: {', '.join(missing)} not set (expected for local runs and forks).")
        return None
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com", region_name="auto",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(retries={"max_attempts": 5, "mode": "standard"}, max_pool_connections=WORKERS + 4,
                      connect_timeout=20, read_timeout=120))
    return client, os.environ["R2_BUCKET"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=Path, default=OUT, help="directory to publish (default web/public/data)")
    ap.add_argument("--verify", action="store_true", help="fetch R2_PUBLIC_URL/data/meta.json afterwards")
    ap.add_argument("--allow-mass-delete", action="store_true")
    args = ap.parse_args(argv)
    got = client_from_env()
    if got is None:
        return 0
    client, bucket = got
    try:
        out = publish(client, bucket, args.dir, allow_mass_delete=args.allow_mass_delete)
        if args.verify:
            if os.environ.get("R2_PUBLIC_URL"):
                verify(os.environ["R2_PUBLIC_URL"], out["build_time"])
            else:
                print("verify skipped: R2_PUBLIC_URL not set")
    except PublishError as exc:
        print(f"R2 publish FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
