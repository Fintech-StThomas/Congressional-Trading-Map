"""Read release descriptors and work out which blobs live (non-withdrawn) releases reference.

Used by publish (skip a no-change day, verify a rollback target) and by withdrawal (never delete a blob that a live
release still references). Descriptors are immutable, so callers may cache them by release id.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from .publish_r2 import PublishError, retry
from .release_blobs import check_headers, verify_body, identity
from .release_manifest import (
    ReleaseManifestError, canonical_json, decode_json, validate_manifest, validate_release_id,
)
from .release_store import IMMUTABLE_CACHE, PREFIX, WITHDRAWN_PREFIX, get_object, list_keys

_ID = re.compile(r"[0-9a-f]{64}")


def descriptor_key(release_id: str) -> str:
    return PREFIX + validate_release_id(release_id) + "/release.json"


def load_descriptor(client: Any, bucket: str, release_id: str, sleep: Callable) -> tuple[dict, bytes] | None:
    """(validated manifest, exact descriptor bytes) or None when no descriptor exists. Raises on a corrupt one."""
    got = get_object(client, bucket, descriptor_key(release_id), sleep)
    if got is None:
        return None
    body, response = got
    check_headers(response, "application/json", IMMUTABLE_CACHE)
    manifest = validate_manifest(decode_json(body), release_id)
    if canonical_json(manifest) != body:
        raise PublishError("release descriptor is not canonically encoded")
    verify_body(got, identity(body), "application/json", IMMUTABLE_CACHE)
    return manifest, body


def blobs_of(manifest: dict) -> set[str]:
    return {entry["sha256"] for entry in manifest["files"].values()}


def list_release_ids(client: Any, bucket: str, sleep: Callable) -> list[str]:
    """Release IDs that have a key under releases/<id>/ (one delimiter listing; blobs/ and withdrawn/ are skipped)."""
    ids: list[str] = []
    token = None
    while True:
        args = {"Bucket": bucket, "Prefix": PREFIX, "Delimiter": "/"}
        if token:
            args["ContinuationToken"] = token
        page = retry(lambda: client.list_objects_v2(**args), "list releases", sleep)
        for item in page.get("CommonPrefixes", []):
            name = item["Prefix"][len(PREFIX):-1]
            if _ID.fullmatch(name):
                ids.append(name)
        if not page.get("IsTruncated"):
            return sorted(ids)
        token = page.get("NextContinuationToken")
        if not token:
            raise PublishError("truncated listing without a continuation token; aborting")


def withdrawn_ids(client: Any, bucket: str, sleep: Callable) -> set[str]:
    found = set()
    for item in list_keys(client, bucket, WITHDRAWN_PREFIX, sleep):
        name = item["Key"][len(WITHDRAWN_PREFIX):]
        if name.endswith(".json") and _ID.fullmatch(name[:-5]):
            found.add(name[:-5])
    return found


def live_references(client: Any, bucket: str, sleep: Callable,
                    cache: dict[str, dict | None]) -> dict[str, set[str]]:
    """release id -> blob hashes for every release that has a descriptor and no tombstone.

    `cache` holds descriptors already read (immutable), so a second pass only fetches releases that appeared since.
    A corrupt descriptor aborts: its references are unknown, so deleting anything would be unsafe.
    """
    gone = withdrawn_ids(client, bucket, sleep)
    live: dict[str, set[str]] = {}
    for release_id in list_release_ids(client, bucket, sleep):
        if release_id in gone:
            continue
        if release_id not in cache:
            loaded = load_descriptor(client, bucket, release_id, sleep)
            cache[release_id] = loaded[0] if loaded else None
        if cache[release_id] is not None:
            live[release_id] = blobs_of(cache[release_id])
    return live


__all__ = ["ReleaseManifestError", "blobs_of", "descriptor_key", "list_release_ids", "live_references",
           "load_descriptor", "withdrawn_ids"]
