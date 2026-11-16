"""Withdraw one archived release after discovered privacy/legal exposure: tombstone, delete its prefix, drop from index.

    python -m pipeline.withdraw_release --release <id> --reason privacy|legal|other --confirm <same id>

Never for ordinary corrections (publish a new release instead). Re-running completes an interrupted withdrawal.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from typing import Any, Callable

from .publish_r2 import MissingConfig, PublishError, _code, client_from_env, retry
from .release_history import remove_release
from .release_manifest import ReleaseManifestError, canonical_json, decode_json, validate_pointer, validate_release_id
from .release_store import (
    CURRENT, POINTER_CACHE, PREFIX, get_object, now_utc, precondition_failed, tombstone_key, utc_timestamp,
    valid_timestamp,
)

REASONS = ("privacy", "legal", "other")


def validate_tombstone(value: Any, release_id: str | None = None) -> dict[str, Any]:
    if (not isinstance(value, dict) or set(value) != {"schema_version", "release_id", "withdrawn_at", "reason"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["reason"] not in REASONS or not valid_timestamp(value["withdrawn_at"])):
        raise ReleaseManifestError("invalid withdrawal tombstone")
    validate_release_id(value["release_id"])
    if release_id is not None and value["release_id"] != release_id:
        raise ReleaseManifestError("withdrawal tombstone is for another release")
    return value


def _assert_not_current(client: Any, bucket: str, release_id: str, sleep: Callable) -> None:
    got = get_object(client, bucket, CURRENT, sleep)
    if got is None:
        return
    if validate_pointer(decode_json(got[0]))["release_id"] == release_id:
        raise PublishError("this is the current release; activate another release first")


def _write_tombstone(client: Any, bucket: str, release_id: str, reason: str, now: datetime, sleep: Callable) -> str:
    """Create the tombstone once (never overwritten). Returns the reason on record."""
    key = tombstone_key(release_id)
    existing = get_object(client, bucket, key, sleep)
    if existing is None:
        body = canonical_json({"schema_version": 1, "release_id": release_id,
                               "withdrawn_at": utc_timestamp(now), "reason": reason})

        def attempt():
            try:
                client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json",
                                  CacheControl=POINTER_CACHE, IfNoneMatch="*")
            except Exception as exc:
                if precondition_failed(exc):
                    return
                raise
        retry(attempt, "write withdrawal tombstone", sleep)
        existing = get_object(client, bucket, key, sleep)
        if existing is None:
            raise PublishError("withdrawal tombstone is missing after writing")
    return validate_tombstone(decode_json(existing[0]), release_id)["reason"]


def _delete_prefix(client: Any, bucket: str, release_id: str, sleep: Callable) -> int:
    """Delete exactly the objects under releases/<id>/ (trailing slash), nothing else."""
    prefix = PREFIX + validate_release_id(release_id) + "/"
    deleted, token = 0, None
    while True:
        args = {"Bucket": bucket, "Prefix": prefix}
        if token:
            args["ContinuationToken"] = token
        page = retry(lambda: client.list_objects_v2(**args), "list release objects", sleep)
        for item in page.get("Contents", []):
            key = item["Key"]
            if not key.startswith(prefix):
                raise PublishError("listing returned a key outside the release prefix; aborting")
            retry(lambda key=key: client.delete_object(Bucket=bucket, Key=key), "delete release object", sleep)
            deleted += 1
        if not page.get("IsTruncated"):
            return deleted
        token = page.get("NextContinuationToken")
        if not token:
            raise PublishError("truncated listing without a continuation token; aborting")


def withdraw(client: Any, bucket: str, release_id: str, reason: str, *, sleep: Callable = time.sleep,
             now: Callable = now_utc) -> dict:
    validate_release_id(release_id)
    if reason not in REASONS:
        raise PublishError("reason must be one of " + ", ".join(REASONS))
    _assert_not_current(client, bucket, release_id, sleep)
    recorded = _write_tombstone(client, bucket, release_id, reason, now(), sleep)
    # The pointer may have moved to this release between the check and the tombstone; never delete the live release.
    _assert_not_current(client, bucket, release_id, sleep)
    deleted = _delete_prefix(client, bucket, release_id, sleep)
    try:
        index_changed = remove_release(client, bucket, release_id, sleep=sleep)
    except PublishError as exc:
        raise PublishError(f"release objects are withdrawn, but the history index was not updated ({exc}); "
                           "re-run the same command to finish") from None
    return {"release_id": release_id, "reason": recorded, "deleted_objects": deleted, "index_updated": index_changed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--release", required=True, help="release ID to withdraw")
    parser.add_argument("--reason", required=True, choices=REASONS)
    parser.add_argument("--confirm", required=True, help="the same release ID, repeated")
    args = parser.parse_args(argv)
    try:
        validate_release_id(args.release)
        if args.confirm != args.release:
            raise PublishError("--confirm must equal --release")
        client, bucket = client_from_env(require=True)
        result = withdraw(client, bucket, args.release, args.reason)
    except MissingConfig as exc:
        print(f"release withdrawal FAILED: {exc}", file=sys.stderr)
        return 2
    except (PublishError, ReleaseManifestError) as exc:
        print(f"release withdrawal FAILED: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"release withdrawal FAILED: {_code(exc)}", file=sys.stderr)
        return 1
    print(f"release withdrawn: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
