"""Shared constants and object-store helpers for the release archive tools (publish, history index, withdrawal).

Layout: releases/blobs/<sha256> (content-addressed bytes), releases/<id>/release.json (descriptor), releases/current.json,
releases/index.json, releases/withdrawn/<id>.json.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

from .publish_r2 import PublishError, _transient, retry
from .release_manifest import validate_release_id

PREFIX = "releases/"
CURRENT = PREFIX + "current.json"
INDEX = PREFIX + "index.json"
WITHDRAWN_PREFIX = PREFIX + "withdrawn/"
BLOB_PREFIX = PREFIX + "blobs/"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
POINTER_CACHE = "no-cache, max-age=0, must-revalidate"
CAS_ATTEMPTS = 5
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def status(exc: Exception, statuses: tuple[int, ...], codes: tuple[str, ...]) -> bool:
    response = getattr(exc, "response", None) or {}
    return (response.get("ResponseMetadata", {}).get("HTTPStatusCode") in statuses
            or response.get("Error", {}).get("Code") in codes)


def precondition_failed(exc: Exception) -> bool:
    return status(exc, (412,), ("PreconditionFailed",))


def get_object(client: Any, bucket: str, key: str, sleep: Callable) -> tuple[bytes, dict] | None:
    """Return (body, response) or None when the key does not exist."""
    def read():
        try:
            response = client.get_object(Bucket=bucket, Key=key)
        except Exception as exc:
            if status(exc, (404,), ("NoSuchKey", "NotFound")):
                return None
            raise
        stream = response["Body"]
        try:
            return stream.read(), response
        finally:
            stream.close()
    return retry(read, "read archive object", sleep)


def head_object(client: Any, bucket: str, key: str, sleep: Callable) -> dict | None:
    """Return the HEAD response (size and headers, no body) or None when the key does not exist."""
    def read():
        try:
            return client.head_object(Bucket=bucket, Key=key)
        except Exception as exc:
            if status(exc, (404,), ("404", "NoSuchKey", "NotFound")):
                return None
            raise
    return retry(read, "check archive object", sleep)


def list_keys(client: Any, bucket: str, prefix: str, sleep: Callable) -> list[dict]:
    """Every object ({Key, Size}) under an exact prefix, following continuation tokens."""
    items: list[dict] = []
    token = None
    while True:
        args = {"Bucket": bucket, "Prefix": prefix}
        if token:
            args["ContinuationToken"] = token
        page = retry(lambda: client.list_objects_v2(**args), "list archive objects", sleep)
        for item in page.get("Contents", []):
            if not item["Key"].startswith(prefix):
                raise PublishError("listing returned a key outside the requested prefix; aborting")
            items.append(item)
        if not page.get("IsTruncated"):
            return items
        token = page.get("NextContinuationToken")
        if not token:
            raise PublishError("truncated listing without a continuation token; aborting")


def utc_timestamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or TIMESTAMP.fullmatch(value) is None:
        return False
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return True


def tombstone_key(release_id: str) -> str:
    return WITHDRAWN_PREFIX + validate_release_id(release_id) + ".json"


def is_withdrawn(client: Any, bucket: str, release_id: str, sleep: Callable = time.sleep) -> bool:
    """Existence alone counts: a malformed tombstone still blocks (fail closed)."""
    return get_object(client, bucket, tombstone_key(release_id), sleep) is not None


def cas_write(client: Any, bucket: str, key: str, compute: Callable[[bytes | None], bytes | None],
              what: str, sleep: Callable = time.sleep) -> bool:
    """Conditionally rewrite a mutable JSON object; True when written, False when no change was needed.

    `compute(existing_body_or_None)` returns the desired body, or None for "leave it". The write uses If-Match on
    the ETag that was read (If-None-Match: * when absent). A concurrent change triggers a bounded re-read; an
    ambiguous (timeout) result is accepted only when read-back equals the desired bytes.
    """
    for _ in range(CAS_ATTEMPTS):
        got = get_object(client, bucket, key, sleep)
        existing, etag = (got[0], got[1].get("ETag")) if got else (None, None)
        if got and (not isinstance(etag, str) or not etag):
            raise PublishError(f"{what} has no ETag")
        desired = compute(existing)
        if desired is None or desired == existing:
            return False
        condition = {"IfMatch": etag} if got else {"IfNoneMatch": "*"}
        last_error: Exception | None = None

        def attempt():
            nonlocal last_error
            try:
                client.put_object(Bucket=bucket, Key=key, Body=desired, ContentType="application/json",
                                  CacheControl=POINTER_CACHE, **condition)
                return True
            except Exception as exc:
                last_error = exc
                if precondition_failed(exc):
                    return False
                raise
        try:
            written = retry(attempt, f"write {what}", sleep)
        except PublishError:
            if last_error is None or not _transient(last_error):
                raise
            readback = get_object(client, bucket, key, sleep)
            if readback is not None and readback[0] == desired:
                return True
            raise
        if written:
            return True
    raise PublishError(f"{what} changed concurrently; gave up after {CAS_ATTEMPTS} attempts")
