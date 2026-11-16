"""Archive validated bytes under releases/; optionally activate with a conditional pointer write."""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path
from typing import Any, Callable

from .publish_r2 import MissingConfig, PublishError, _code, _transient, client_from_env, content_type, retry
from .release_manifest import (
    ReleaseManifestError, build_manifest, canonical_json, decode_json, validate_manifest,
    validate_meta, validate_pointer, validate_release_id,
)

PREFIX = "releases/"
CURRENT = PREFIX + "current.json"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
POINTER_CACHE = "no-cache, max-age=0, must-revalidate"


def _status(exc: Exception, statuses: tuple[int, ...], codes: tuple[str, ...]) -> bool:
    response = getattr(exc, "response", None) or {}
    return (response.get("ResponseMetadata", {}).get("HTTPStatusCode") in statuses
            or response.get("Error", {}).get("Code") in codes)


def _get(client: Any, bucket: str, key: str, sleep: Callable) -> tuple[bytes, dict] | None:
    def read():
        try:
            response = client.get_object(Bucket=bucket, Key=key)
        except Exception as exc:
            if _status(exc, (404,), ("NoSuchKey", "NotFound")):
                return None
            raise
        stream = response["Body"]
        try:
            return stream.read(), response
        finally:
            stream.close()
    return retry(read, "read archive object", sleep)


def _headers(response: dict, ctype: str, cache: str) -> None:
    if (response.get("ContentType") != ctype or response.get("CacheControl") != cache
            or response.get("ContentEncoding") not in (None, "")):
        raise PublishError("archive object has conflicting content/cache headers")


def _verify(got: tuple[bytes, dict] | None, expected: dict, ctype: str, cache: str) -> bytes:
    if got is None:
        raise PublishError("required archive object is missing")
    body, response = got
    _headers(response, ctype, cache)
    if (len(body) != expected["bytes"] or response.get("ContentLength") != expected["bytes"]
            or hashlib.sha256(body).hexdigest() != expected["sha256"]):
        raise PublishError("archive object has conflicting bytes")
    return body


def _identity(body: bytes) -> dict:
    return {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}


def _create(client: Any, bucket: str, key: str, body: bytes, ctype: str, sleep: Callable) -> bool:
    """Never replace an immutable key, even after a timeout or a concurrent creation."""
    expected = _identity(body)
    existing = _get(client, bucket, key, sleep)
    if existing is not None:
        _verify(existing, expected, ctype, IMMUTABLE_CACHE)
        return False
    last_error = None

    def attempt():
        nonlocal last_error
        try:
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype,
                              CacheControl=IMMUTABLE_CACHE, IfNoneMatch="*")
            return True
        except Exception as exc:
            last_error = exc
            if _status(exc, (412,), ("PreconditionFailed",)):
                return False
            raise
    try:
        created = retry(attempt, "create archive object", sleep)
    except PublishError:
        if last_error is None or not _transient(last_error):
            raise
        # A timeout can mean that the provider stored the bytes but lost the response.
        created = False
    _verify(_get(client, bucket, key, sleep), expected, ctype, IMMUTABLE_CACHE)
    return created


def _capture(client: Any, bucket: str, sleep: Callable) -> tuple[bytes, str] | None:
    got = _get(client, bucket, CURRENT, sleep)
    if got is None:
        return None
    body, response = got
    validate_pointer(decode_json(body))
    etag = response.get("ETag")
    if not isinstance(etag, str) or not etag:
        raise PublishError("current release pointer has no ETag")
    return body, etag


def _activate(client: Any, bucket: str, manifest: dict, descriptor: bytes,
              previous: tuple[bytes, str] | None, sleep: Callable) -> None:
    desired = canonical_json({"schema_version": 1, "release_id": manifest["release_id"],
                              "manifest_sha256": hashlib.sha256(descriptor).hexdigest()})
    condition = {"IfMatch": previous[1]} if previous else {"IfNoneMatch": "*"}
    ambiguous = False
    last_error = None

    def attempt():
        nonlocal ambiguous, last_error
        try:
            client.put_object(Bucket=bucket, Key=CURRENT, Body=desired, ContentType="application/json",
                              CacheControl=POINTER_CACHE, **condition)
            return True
        except Exception as exc:
            last_error = exc
            if _status(exc, (412,), ("PreconditionFailed",)):
                return False
            ambiguous = ambiguous or _transient(exc)
            raise
    try:
        success = retry(attempt, "activate release", sleep)
    except PublishError:
        if last_error is None or not _transient(last_error):
            raise
        success = False
    if not success and not ambiguous:
        raise PublishError("current release changed concurrently; activation refused")
    # Exact readback resolves an ambiguous response without unconditionally rewriting current.
    _verify(_get(client, bucket, CURRENT, sleep), _identity(desired), "application/json", POINTER_CACHE)


def _check_tree(root: Path, manifest: dict) -> None:
    if build_manifest(root) != manifest:
        raise PublishError("source tree changed during archive publication")


def publish(client: Any, bucket: str, root: Path, *, activate: bool = False,
            sleep: Callable = time.sleep) -> dict:
    """Publish a complete immutable archive; archive-only is the safe default."""
    previous = _capture(client, bucket, sleep) if activate else None
    manifest = build_manifest(root)
    validate_manifest(manifest)
    prefix = PREFIX + manifest["release_id"] + "/"
    uploaded = 0
    for rel, expected in manifest["files"].items():
        body = (root / rel).read_bytes()
        if _identity(body) != expected:
            raise PublishError("source file changed during archive publication")
        uploaded += _create(client, bucket, prefix + rel, body, content_type(rel), sleep)
    _check_tree(root, manifest)
    descriptor = canonical_json(manifest)
    _create(client, bucket, prefix + "release.json", descriptor, "application/json", sleep)
    _check_tree(root, manifest)
    if activate:
        _activate(client, bucket, manifest, descriptor, previous, sleep)
    return {"release_id": manifest["release_id"], "files": len(manifest["files"]),
            "uploaded": uploaded, "activated": activate}


def activate_release(client: Any, bucket: str, release_id: str, *, sleep: Callable = time.sleep) -> dict:
    """Promote or roll back only after fully verifying an existing completed archive."""
    validate_release_id(release_id)
    previous = _capture(client, bucket, sleep)
    prefix = PREFIX + release_id + "/"
    got = _get(client, bucket, prefix + "release.json", sleep)
    if got is None:
        raise PublishError("release descriptor is missing")
    descriptor, response = got
    _headers(response, "application/json", IMMUTABLE_CACHE)
    manifest = validate_manifest(decode_json(descriptor), release_id)
    if canonical_json(manifest) != descriptor:
        raise PublishError("release descriptor is not canonically encoded")
    _verify(got, _identity(descriptor), "application/json", IMMUTABLE_CACHE)
    for rel, expected in manifest["files"].items():
        body = _verify(_get(client, bucket, prefix + rel, sleep), expected, content_type(rel), IMMUTABLE_CACHE)
        if rel == "meta.json":
            validate_meta(body)
    _activate(client, bucket, manifest, descriptor, previous, sleep)
    return {"release_id": release_id, "files": len(manifest["files"]), "uploaded": 0, "activated": True}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--dir", type=Path, help="validated data tree to archive")
    source.add_argument("--release", help="existing release ID to verify and activate")
    parser.add_argument("--activate", action="store_true", help="conditionally update the current pointer")
    args = parser.parse_args(argv)
    if args.release and not args.activate:
        parser.error("--release requires --activate")
    try:
        if args.release:
            validate_release_id(args.release)
        client, bucket = client_from_env(require=True)
        result = (activate_release(client, bucket, args.release) if args.release else
                  publish(client, bucket, args.dir, activate=args.activate))
    except MissingConfig as exc:
        print(f"release publish FAILED: {exc}", file=sys.stderr)
        return 2
    except (PublishError, ReleaseManifestError, OSError) as exc:
        # Only our own errors are printable; arbitrary SDK/transport messages may expose endpoints.
        message = str(exc) if isinstance(exc, (PublishError, ReleaseManifestError)) else type(exc).__name__
        print(f"release publish FAILED: {message}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"release publish FAILED: {_code(exc)}", file=sys.stderr)
        return 1
    print(f"release published: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
