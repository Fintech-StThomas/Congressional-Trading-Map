"""Withdraw archived releases after discovered privacy/legal exposure: tombstone, delete unshared blobs, descriptor, index.

    python -m pipeline.withdraw_release --release <id> --reason privacy|legal|other --confirm <same id>
        [--exposed-path <path in the release> ...] [--also-withdraw <id> ...]

Blobs are shared between releases. A blob is deleted only when NO live (non-withdrawn) release outside the withdrawn
set references it. Bytes that hold the exposed data and are shared with other live releases expose those releases too:
the command lists them and refuses unless --also-withdraw names every one. Without --exposed-path every blob of the
release is treated as exposed (the safe default; usually names almost every release). Never for ordinary corrections
(publish a new release instead). Re-running completes an interrupted withdrawal.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from typing import Any, Callable

from .publish_r2 import MissingConfig, PublishError, _code, client_from_env, retry
from .release_blobs import blob_key
from .release_history import remove_releases
from .release_manifest import ReleaseManifestError, canonical_json, decode_json, validate_pointer, validate_release_id
from .release_refs import blobs_of, descriptor_key, live_references, load_descriptor
from .release_store import (
    CURRENT, POINTER_CACHE, get_object, now_utc, precondition_failed, tombstone_key, utc_timestamp, valid_timestamp,
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


def _current_id(client: Any, bucket: str, sleep: Callable) -> str | None:
    got = get_object(client, bucket, CURRENT, sleep)
    return validate_pointer(decode_json(got[0]))["release_id"] if got else None


def _plan(client: Any, bucket: str, targets: list[str], descriptors: dict[str, dict | None], exposed: set[str] | None,
          sleep: Callable, cache: dict) -> tuple[set[str], set[str], dict[str, set[str]]]:
    """(blobs to delete, blobs kept because a live release uses them, live releases holding exposed bytes)."""
    live = {rid: shas for rid, shas in live_references(client, bucket, sleep, cache).items() if rid not in targets}
    mine: set[str] = set()
    for manifest in descriptors.values():
        if manifest is not None:
            mine |= blobs_of(manifest)
    used = set().union(*live.values()) if live else set()
    exposed_shas = mine if exposed is None else exposed
    conflicts = {rid: shas & exposed_shas for rid, shas in live.items() if shas & exposed_shas}
    return mine - used, mine & used, conflicts


def _exposed_shas(manifest: dict | None, paths: list[str]) -> set[str] | None:
    if not paths:
        return None
    if manifest is None:
        return set()
    missing = [path for path in paths if path not in manifest["files"]]
    if missing:
        raise PublishError("--exposed-path is not a file of the release: " + ", ".join(missing))
    return {manifest["files"][path]["sha256"] for path in paths}


def _refuse_shared(conflicts: dict[str, set[str]], also: set[str], current: str | None) -> None:
    unnamed = sorted(set(conflicts) - also)
    if current in conflicts:
        raise PublishError("the current release shares the exposed bytes and cannot be withdrawn; publish or "
                           "activate a release that does not contain them first")
    if unnamed:
        raise PublishError(f"{len(unnamed)} other live release(s) share the exposed bytes and are exposed too; "
                           "nothing was changed. Re-run with --also-withdraw naming all of: " + " ".join(unnamed)
                           + " (or narrow the exposure with --exposed-path)")


def withdraw(client: Any, bucket: str, release_id: str, reason: str, *, also: tuple[str, ...] = (),
             exposed_paths: tuple[str, ...] = (), sleep: Callable = time.sleep, now: Callable = now_utc) -> dict:
    validate_release_id(release_id)
    if reason not in REASONS:
        raise PublishError("reason must be one of " + ", ".join(REASONS))
    named = {validate_release_id(item) for item in also} - {release_id}
    targets = [release_id] + sorted(named)
    for target in targets:
        if _current_id(client, bucket, sleep) == target:
            raise PublishError("this is the current release; activate another release first")
    descriptors: dict[str, dict | None] = {}
    for target in targets:
        loaded = load_descriptor(client, bucket, target, sleep)
        descriptors[target] = loaded[0] if loaded else None
    cache: dict = {}
    exposed = _exposed_shas(descriptors[release_id], list(exposed_paths))
    _, _, conflicts = _plan(client, bucket, targets, descriptors, exposed, sleep, cache)
    _refuse_shared(conflicts, named, _current_id(client, bucket, sleep))
    reasons = {target: _write_tombstone(client, bucket, target, reason, now(), sleep) for target in targets}
    # The pointer may have moved to a target between the check and the tombstones; never delete the live release.
    for target in targets:
        if _current_id(client, bucket, sleep) == target:
            raise PublishError("this is the current release; activate another release first")
    # Plan again right before deleting: a release created in the meantime may now reference one of these blobs.
    to_delete, kept, conflicts = _plan(client, bucket, targets, descriptors, exposed, sleep, cache)
    _refuse_shared(conflicts, named, _current_id(client, bucket, sleep))
    for sha in sorted(to_delete):
        key = blob_key(sha)
        retry(lambda key=key: client.delete_object(Bucket=bucket, Key=key), "delete release blob", sleep)
    for target in targets:
        if descriptors[target] is not None:
            key = descriptor_key(target)
            retry(lambda key=key: client.delete_object(Bucket=bucket, Key=key), "delete release descriptor", sleep)
    try:
        index_changed = remove_releases(client, bucket, targets, sleep=sleep)
    except PublishError as exc:
        raise PublishError(f"release objects are withdrawn, but the history index was not updated ({exc}); "
                           "re-run the same command to finish") from None
    return {"release_id": release_id, "reason": reasons[release_id], "withdrawn": targets,
            "deleted_blobs": len(to_delete), "kept_shared_blobs": len(kept), "index_updated": index_changed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--release", required=True, help="release ID to withdraw")
    parser.add_argument("--reason", required=True, choices=REASONS)
    parser.add_argument("--confirm", required=True, help="the same release ID, repeated")
    parser.add_argument("--also-withdraw", nargs="+", default=[], metavar="ID",
                        help="other releases that share the exposed bytes (the command lists them when needed)")
    parser.add_argument("--exposed-path", action="append", default=[], metavar="PATH",
                        help="a file of the release that holds the exposed data (repeatable); default: every file")
    args = parser.parse_args(argv)
    try:
        validate_release_id(args.release)
        if args.confirm != args.release:
            raise PublishError("--confirm must equal --release")
        client, bucket = client_from_env(require=True)
        result = withdraw(client, bucket, args.release, args.reason, also=tuple(args.also_withdraw),
                          exposed_paths=tuple(args.exposed_path))
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
