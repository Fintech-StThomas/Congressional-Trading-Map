"""Content-addressed blob storage for the release archive: releases/blobs/<sha256> holds each distinct file once.

Blobs are immutable (conditional create with If-None-Match: *, never replaced). A new blob is read back in full and
hashed. A reused blob is checked by HEAD only (it exists, its size equals the descriptor's, its Cache-Control and
Content-Encoding are right); its bytes are not re-read, which keeps a daily publish and a rollback at one cheap request
per distinct blob. Content-Type is set from the first path that uploaded the bytes; the Worker sets the type from the
requested path, so a blob shared by two paths of different types is still served correctly.
"""
from __future__ import annotations

import hashlib
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .publish_r2 import PublishError, _transient, retry
from .release_manifest import validate_release_id
from .release_store import BLOB_PREFIX, IMMUTABLE_CACHE, get_object, head_object, list_keys, precondition_failed

HEAD_WORKERS = 8


def blob_key(sha256: str) -> str:
    return BLOB_PREFIX + validate_release_id(sha256)


def identity(body: bytes) -> dict:
    return {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}


def check_headers(response: dict, ctype: str | None, cache: str) -> None:
    if ((ctype is not None and response.get("ContentType") != ctype) or response.get("CacheControl") != cache
            or response.get("ContentEncoding") not in (None, "")):
        raise PublishError("archive object has conflicting content/cache headers")


def verify_body(got: tuple[bytes, dict] | None, expected: dict, ctype: str | None, cache: str) -> bytes:
    """Full verification: headers, length and SHA-256 of the bytes just read."""
    if got is None:
        raise PublishError("required archive object is missing")
    body, response = got
    check_headers(response, ctype, cache)
    if (len(body) != expected["bytes"] or response.get("ContentLength") != expected["bytes"]
            or hashlib.sha256(body).hexdigest() != expected["sha256"]):
        raise PublishError("archive object has conflicting bytes")
    return body


def check_reused(head: dict | None, expected: dict) -> None:
    """Cheap verification of an existing blob from its HEAD response: existence, size and headers (not bytes)."""
    if head is None:
        raise PublishError("required archive blob is missing")
    check_headers(head, None, IMMUTABLE_CACHE)
    if head.get("ContentLength") != expected["bytes"]:
        raise PublishError("archive blob has conflicting size")


def head_blobs(client: Any, bucket: str, shas: list[str], sleep: Callable) -> dict[str, dict | None]:
    """HEAD every blob (a few at a time); None marks a missing blob."""
    with ThreadPoolExecutor(max_workers=HEAD_WORKERS) as pool:
        heads = list(pool.map(lambda sha: head_object(client, bucket, blob_key(sha), sleep), shas))
    return dict(zip(shas, heads))


def create_once(client: Any, bucket: str, key: str, body: bytes, ctype: str, sleep: Callable = time.sleep, *,
                known_missing: bool = False, type_shared: bool = False) -> bool:
    """Never replace an immutable key, even after a timeout or a concurrent creation. True when this call created it.

    type_shared: an existing object may carry another Content-Type (a blob first stored under a different path).
    """
    expected = identity(body)
    if not known_missing:
        existing = get_object(client, bucket, key, sleep)
        if existing is not None:
            verify_body(existing, expected, None if type_shared else ctype, IMMUTABLE_CACHE)
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
            if precondition_failed(exc):
                return False
            raise
    try:
        created = retry(attempt, "create archive object", sleep)
    except PublishError:
        if last_error is None or not _transient(last_error):
            raise
        # A timeout can mean that the provider stored the bytes but lost the response.
        created = False
    verify_body(get_object(client, bucket, key, sleep), expected, None if (type_shared and not created) else ctype,
                IMMUTABLE_CACHE)
    return created


def store_blob(client: Any, bucket: str, sha256: str, body: bytes, ctype: str, sleep: Callable = time.sleep) -> bool:
    """Create a blob known to be absent (a HEAD said so); True when this call created it, False when a concurrent
    writer did first (the existing bytes are then verified in full)."""
    if hashlib.sha256(body).hexdigest() != sha256:
        raise PublishError("source file changed during archive publication")
    return create_once(client, bucket, blob_key(sha256), body, ctype, sleep, known_missing=True, type_shared=True)


def archive_stats(client: Any, bucket: str, sleep: Callable = time.sleep) -> tuple[int, int]:
    """(distinct blobs, total bytes) from one listing of releases/blobs/; the owner's real storage figure."""
    items = list_keys(client, bucket, BLOB_PREFIX, sleep)
    return len(items), sum(int(item.get("Size", 0)) for item in items)
