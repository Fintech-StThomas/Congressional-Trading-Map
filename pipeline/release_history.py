"""Mutable releases/index.json: strict validator and conditional add/remove of history entries (never authoritative)."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

from .publish_r2 import PublishError
from .release_manifest import ReleaseManifestError, canonical_json, decode_json, validate_release_id
from .release_store import INDEX, cas_write, now_utc, utc_timestamp, valid_timestamp

MAX_ENTRIES = 400
MAX_BUILD_TIME = 100


def build_time_of(meta_body: bytes) -> str:
    """meta.json build.time, bounded; the caller has already verified meta.json against the descriptor."""
    meta = decode_json(meta_body)
    value = meta.get("build", {}).get("time") if isinstance(meta, dict) and isinstance(meta.get("build"), dict) else None
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_BUILD_TIME:
        raise ReleaseManifestError("meta.json build.time is missing or unusable for the release index")
    return value


def validate_index(value: Any) -> dict[str, Any]:
    """Strictly validate an untrusted index; reject unknown keys, duplicates and oversize lists."""
    if (not isinstance(value, dict) or set(value) != {"schema_version", "releases"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or not isinstance(value["releases"], list) or len(value["releases"]) > MAX_ENTRIES):
        raise ReleaseManifestError("invalid release index schema")
    seen = set()
    for entry in value["releases"]:
        if not isinstance(entry, dict) or set(entry) != {"release_id", "build_time", "activated_at"}:
            raise ReleaseManifestError("invalid release index entry")
        validate_release_id(entry["release_id"])
        if (not isinstance(entry["build_time"], str) or not entry["build_time"].strip()
                or len(entry["build_time"]) > MAX_BUILD_TIME or not valid_timestamp(entry["activated_at"])):
            raise ReleaseManifestError("invalid release index entry")
        if entry["release_id"] in seen:
            raise ReleaseManifestError("duplicate release in release index")
        seen.add(entry["release_id"])
    return value


def _load(existing: bytes | None) -> dict[str, Any]:
    return validate_index(decode_json(existing)) if existing is not None else {"schema_version": 1, "releases": []}


def record_activation(client: Any, bucket: str, release_id: str, build_time: str, *,
                      now: Callable[[], datetime] = now_utc, sleep: Callable = time.sleep) -> bool:
    """Put `release_id` at the front of the index (one entry per release). Re-recording the release that is
    already at the front changes nothing, so repair re-runs are idempotent. Returns True when written."""
    validate_release_id(release_id)

    def compute(existing: bytes | None) -> bytes | None:
        index = _load(existing)
        releases = index["releases"]
        if releases and releases[0]["release_id"] == release_id and releases[0]["build_time"] == build_time:
            return None
        entry = {"release_id": release_id, "build_time": build_time, "activated_at": utc_timestamp(now())}
        rest = [item for item in releases if item["release_id"] != release_id]
        return canonical_json({"schema_version": 1, "releases": ([entry] + rest)[:MAX_ENTRIES]})
    try:
        return cas_write(client, bucket, INDEX, compute, "release index", sleep)
    except ReleaseManifestError as exc:
        raise PublishError(f"release index is malformed ({exc}); not modified") from None


def remove_releases(client: Any, bucket: str, release_ids: list[str], *, sleep: Callable = time.sleep) -> bool:
    """Drop releases from the index in one conditional write. A missing index is left missing. True when written."""
    gone = {validate_release_id(release_id) for release_id in release_ids}

    def compute(existing: bytes | None) -> bytes | None:
        if existing is None:
            return None
        index = _load(existing)
        kept = [item for item in index["releases"] if item["release_id"] not in gone]
        if len(kept) == len(index["releases"]):
            return None
        return canonical_json({"schema_version": 1, "releases": kept})
    try:
        return cas_write(client, bucket, INDEX, compute, "release index", sleep)
    except ReleaseManifestError as exc:
        raise PublishError(f"release index is malformed ({exc}); not modified") from None


def remove_release(client: Any, bucket: str, release_id: str, *, sleep: Callable = time.sleep) -> bool:
    """Drop one release from the index."""
    return remove_releases(client, bucket, [release_id], sleep=sleep)
