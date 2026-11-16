"""Archive validated bytes as content-addressed blobs plus a release descriptor; optionally activate, then record history.

    python -m pipeline.publish_release --dir web/public/data [--activate] [--measure]
    python -m pipeline.publish_release --release <id> --activate [--full-verify]

Each distinct file is stored once as releases/blobs/<sha256>; a release is its descriptor releases/<id>/release.json,
written after every referenced blob is verified. With --activate, a tree whose files other than meta.json equal the
current release's creates no release and leaves the pointer alone.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import time
from pathlib import Path
from typing import Any, Callable

from .publish_r2 import MissingConfig, PublishError, _code, _transient, client_from_env, content_type, retry
from .release_blobs import (
    archive_stats, blob_key, check_reused, create_once, head_blobs, identity, store_blob, verify_body,
)
from .release_history import build_time_of, record_activation, validate_index
from .release_manifest import (
    ReleaseManifestError, build_manifest, canonical_json, decode_json, validate_manifest,
    validate_meta, validate_pointer, validate_release_id,
)
from .release_refs import load_descriptor
from .release_store import (  # noqa: F401 - re-exported for callers and tests
    BLOB_PREFIX, CURRENT, IMMUTABLE_CACHE, INDEX, POINTER_CACHE, PREFIX, get_object, is_withdrawn, now_utc, status,
)

_status = status
_get = get_object
_identity = identity


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


def _refuse_withdrawn(client: Any, bucket: str, release_id: str, sleep: Callable) -> None:
    if is_withdrawn(client, bucket, release_id, sleep):
        raise PublishError("release was withdrawn; it cannot be created or activated")


def _activate(client: Any, bucket: str, manifest: dict, descriptor: bytes,
              previous: tuple[bytes, str] | None, sleep: Callable, build_time: str,
              now: Callable = now_utc) -> None:
    # Checked again immediately before the pointer moves, to shrink the window with a concurrent withdrawal.
    _refuse_withdrawn(client, bucket, manifest["release_id"], sleep)
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
    verify_body(_get(client, bucket, CURRENT, sleep), identity(desired), "application/json", POINTER_CACHE)
    _record_history(client, bucket, manifest["release_id"], build_time, sleep, now)


def _record_history(client: Any, bucket: str, release_id: str, build_time: str, sleep: Callable, now: Callable) -> None:
    """The pointer has already moved; an index failure must say so and stay repairable by re-running."""
    try:
        record_activation(client, bucket, release_id, build_time, now=now, sleep=sleep)
    except Exception as exc:
        reason = str(exc) if isinstance(exc, (PublishError, ReleaseManifestError)) else _code(exc)
        raise PublishError(f"the current pointer WAS activated to {release_id}, but the release history index "
                           f"was not updated ({reason}); re-run the same command to repair the index") from None


def _check_tree(root: Path, manifest: dict) -> None:
    if build_manifest(root) != manifest:
        raise PublishError("source tree changed during archive publication")


def _without_meta(manifest: dict) -> dict:
    return {path: entry for path, entry in manifest["files"].items() if path != "meta.json"}


def _unchanged_release(client: Any, bucket: str, previous: tuple[bytes, str] | None, manifest: dict,
                       sleep: Callable) -> dict | None:
    """The current release's manifest when its files other than meta.json equal the new tree's; else None.

    Anything unreadable or inconsistent about the current release means "do not skip": publish normally."""
    if previous is None:
        return None
    try:
        pointer = validate_pointer(decode_json(previous[0]))
        loaded = load_descriptor(client, bucket, pointer["release_id"], sleep)
        if loaded is None or hashlib.sha256(loaded[1]).hexdigest() != pointer["manifest_sha256"]:
            return None
    except (PublishError, ReleaseManifestError):
        return None
    return loaded[0] if _without_meta(loaded[0]) == _without_meta(manifest) else None


def _repair_index(client: Any, bucket: str, current: dict, sleep: Callable, now: Callable) -> None:
    """A no-change run still completes a history entry that an earlier run failed to write (idempotent)."""
    got = get_object(client, bucket, INDEX, sleep)
    release_id = current["release_id"]
    if got is not None:
        try:
            front = validate_index(decode_json(got[0]))["releases"][:1]
        except ReleaseManifestError:
            front = []  # malformed: record_activation fails closed with its own message
        if front and front[0]["release_id"] == release_id:
            return
    meta = current["files"]["meta.json"]
    body = verify_body(get_object(client, bucket, blob_key(meta["sha256"]), sleep), meta, None, IMMUTABLE_CACHE)
    _record_history(client, bucket, release_id, build_time_of(body), sleep, now)


def publish(client: Any, bucket: str, root: Path, *, activate: bool = False,
            sleep: Callable = time.sleep, now: Callable = now_utc) -> dict:
    """Publish a complete immutable release (blobs, then descriptor); archive-only is the safe default."""
    previous = _capture(client, bucket, sleep) if activate else None
    manifest = build_manifest(root)
    validate_manifest(manifest)
    _refuse_withdrawn(client, bucket, manifest["release_id"], sleep)
    unchanged = _unchanged_release(client, bucket, previous, manifest, sleep)
    if unchanged is not None:
        current = unchanged["release_id"]
        print(f"no data change; release {current} stays current")
        _repair_index(client, bucket, unchanged, sleep, now)
        return {"release_id": current, "unchanged": True, "files": len(manifest["files"]), "blobs": 0,
                "new_blobs": 0, "reused_blobs": 0, "new_bytes": 0, "activated": False, "indexed": False}
    groups: dict[str, list[str]] = {}
    for rel, entry in manifest["files"].items():
        groups.setdefault(entry["sha256"], []).append(rel)
    heads = head_blobs(client, bucket, sorted(groups), sleep)
    new_blobs = new_bytes = 0
    for sha in sorted(groups):
        rel = groups[sha][0]
        expected = manifest["files"][rel]
        if heads[sha] is not None:
            check_reused(heads[sha], expected)
            continue
        body = (root / rel).read_bytes()
        if identity(body) != expected:
            raise PublishError("source file changed during archive publication")
        if store_blob(client, bucket, sha, body, content_type(rel), sleep):
            new_blobs += 1
            new_bytes += expected["bytes"]
    _check_tree(root, manifest)
    descriptor = canonical_json(manifest)
    create_once(client, bucket, descriptor_key_of(manifest), descriptor, "application/json", sleep)
    _check_tree(root, manifest)
    if activate:
        build_time = build_time_of((root / "meta.json").read_bytes())
        _activate(client, bucket, manifest, descriptor, previous, sleep, build_time, now)
    return {"release_id": manifest["release_id"], "unchanged": False, "files": len(manifest["files"]),
            "blobs": len(groups), "new_blobs": new_blobs, "reused_blobs": len(groups) - new_blobs,
            "new_bytes": new_bytes, "activated": activate, "indexed": activate}


def descriptor_key_of(manifest: dict) -> str:
    return PREFIX + manifest["release_id"] + "/release.json"


def activate_release(client: Any, bucket: str, release_id: str, *, full: bool = False,
                     sleep: Callable = time.sleep, now: Callable = now_utc) -> dict:
    """Promote or roll back after verifying an existing completed release.

    Every distinct blob must exist with the descriptor's size (HEAD). meta.json is read and hashed in full. With
    full=True every blob is read back and hashed (thousands of GETs; use after a suspected storage problem)."""
    validate_release_id(release_id)
    _refuse_withdrawn(client, bucket, release_id, sleep)
    previous = _capture(client, bucket, sleep)
    loaded = load_descriptor(client, bucket, release_id, sleep)
    if loaded is None:
        raise PublishError("release descriptor is missing")
    manifest, descriptor = loaded
    groups: dict[str, str] = {}
    for rel, entry in manifest["files"].items():
        groups.setdefault(entry["sha256"], rel)
    heads = head_blobs(client, bucket, sorted(groups), sleep)
    for sha, rel in groups.items():
        check_reused(heads[sha], manifest["files"][rel])
    build_time = ""
    meta = manifest["files"]["meta.json"]
    for sha in ([meta["sha256"]] if not full else sorted(groups)):
        body = verify_body(get_object(client, bucket, blob_key(sha), sleep), manifest["files"][groups[sha]], None,
                           IMMUTABLE_CACHE)
        if sha == meta["sha256"]:
            validate_meta(body)
            build_time = build_time_of(body)
    _activate(client, bucket, manifest, descriptor, previous, sleep, build_time, now)
    return {"release_id": release_id, "files": len(manifest["files"]), "blobs": len(groups), "new_blobs": 0,
            "activated": True, "indexed": True, "full_verify": full}


def _print_measure(client: Any, bucket: str, result: dict) -> None:
    count, total = archive_stats(client, bucket)
    print("storage measurement (from this run and one listing of releases/blobs/):")
    print(f"  files in release:        {result['files']}")
    print(f"  distinct blobs:          {result['blobs']}")
    print(f"  blobs new / reused:      {result['new_blobs']} / {result.get('reused_blobs', result['blobs'])}")
    print(f"  new bytes this run:      {result['new_bytes']}")
    print(f"  archive blobs total:     {count}")
    print(f"  archive bytes total:     {total} ({total / 1048576:.1f} MiB)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--dir", type=Path, help="validated data tree to archive")
    source.add_argument("--release", help="existing release ID to verify and activate")
    parser.add_argument("--activate", action="store_true", help="conditionally update the current pointer")
    parser.add_argument("--measure", action="store_true", help="print blobs new/reused, new bytes and total archive size")
    parser.add_argument("--full-verify", action="store_true",
                        help="with --release: read back and hash every blob, not only meta.json")
    args = parser.parse_args(argv)
    if args.release and not args.activate:
        parser.error("--release requires --activate")
    if args.full_verify and not args.release:
        parser.error("--full-verify applies to --release")
    try:
        if args.release:
            validate_release_id(args.release)
        client, bucket = client_from_env(require=True)
        result = (activate_release(client, bucket, args.release, full=args.full_verify) if args.release else
                  publish(client, bucket, args.dir, activate=args.activate))
        print(f"release published: {result}")
        if args.measure:
            _print_measure(client, bucket, {"new_bytes": 0, **result})
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
