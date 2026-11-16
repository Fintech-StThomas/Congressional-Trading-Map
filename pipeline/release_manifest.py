"""Create a deterministic, offline identity manifest for a validated data release."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
RESERVED_ROOT_FILES = {"release.json", "_manifest.json"}
CHUNK_SIZE = 1024 * 1024


class ReleaseManifestError(ValueError):
    """An input tree cannot be described safely as a release."""


def canonical_json(value: Any) -> bytes:
    """Encode release identities, completion descriptors, and pointers consistently."""
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def validate_release_id(value: Any) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ReleaseManifestError("release ID/hash must be 64 lowercase hexadecimal characters")
    return value


def validate_path(value: Any) -> str:
    if (not isinstance(value, str) or not value or "\\" in value
            or any(part in ("", ".", "..") for part in value.split("/"))
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or ":" in value or value in RESERVED_ROOT_FILES):
        raise ReleaseManifestError("unsafe or reserved release file path")
    return value


def validate_manifest(value: Any, release_id: str | None = None) -> dict[str, Any]:
    """Validate untrusted descriptors before deriving any remote object keys."""
    if (not isinstance(value, dict) or set(value) != {"schema_version", "release_id", "files"}
            or type(value["schema_version"]) is not int or value["schema_version"] != SCHEMA_VERSION):
        raise ReleaseManifestError("invalid release descriptor schema")
    actual_id = validate_release_id(value["release_id"])
    files = value["files"]
    if not isinstance(files, dict) or "meta.json" not in files:
        raise ReleaseManifestError("release descriptor requires meta.json")
    for path, entry in files.items():
        validate_path(path)
        if not isinstance(entry, dict) or set(entry) != {"sha256", "bytes"}:
            raise ReleaseManifestError("invalid release file descriptor")
        validate_release_id(entry["sha256"])
        if type(entry["bytes"]) is not int or entry["bytes"] < 0:
            raise ReleaseManifestError("release file bytes must be a non-negative integer")
    identity = {"schema_version": SCHEMA_VERSION, "files": files}
    if actual_id != hashlib.sha256(canonical_json(identity)).hexdigest() or (release_id is not None and actual_id != release_id):
        raise ReleaseManifestError("release descriptor identity mismatch")
    return value


def validate_pointer(value: Any) -> dict[str, Any]:
    if (not isinstance(value, dict) or set(value) != {"schema_version", "release_id", "manifest_sha256"}
            or type(value["schema_version"]) is not int or value["schema_version"] != SCHEMA_VERSION):
        raise ReleaseManifestError("invalid current release pointer schema")
    validate_release_id(value["release_id"])
    validate_release_id(value["manifest_sha256"])
    return value


def decode_json(body: bytes) -> Any:
    """Reject duplicate keys rather than silently trusting their last value."""
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result = {}
        for key, value in pairs:
            if key in result:
                raise ReleaseManifestError("duplicate JSON key")
            result[key] = value
        return result
    try:
        return json.loads(body, object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError):
        raise ReleaseManifestError("invalid release JSON") from None


def validate_meta(body: bytes) -> None:
    meta = decode_json(body)
    if not isinstance(meta, dict) or not isinstance(meta.get("build"), dict):
        raise ReleaseManifestError("meta.json must contain a build object")
    if not isinstance(meta["build"].get("time"), str) or not meta["build"]["time"].strip():
        raise ReleaseManifestError("meta.json build.time must be a non-empty string")


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(root: str | Path) -> dict[str, Any]:
    """Return the release descriptor for a tree, without modifying it."""
    root = Path(root)
    try:
        if stat.S_ISLNK(root.lstat().st_mode):
            raise ReleaseManifestError("input directory cannot be a symbolic link")
    except OSError as exc:
        raise ReleaseManifestError(f"cannot access input directory: {exc}") from None
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ReleaseManifestError(f"input is not a directory: {root}")

    def walk_error(exc: OSError) -> None:
        raise ReleaseManifestError(f"cannot enumerate input tree: {exc}") from exc

    files: dict[str, dict[str, Any]] = {}
    for current, dirs, names in os.walk(root, topdown=True, onerror=walk_error, followlinks=False):
        base = Path(current)
        for name in dirs:
            path = base / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
                raise ReleaseManifestError(f"unsupported filesystem entry: {path.relative_to(root).as_posix()}")
        for name in names:
            path = base / name
            rel = path.relative_to(root).as_posix()
            if "/" not in rel and rel in RESERVED_ROOT_FILES:
                raise ReleaseManifestError(f"reserved root file: {rel}")
            validate_path(rel)
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
                raise ReleaseManifestError(f"unsupported filesystem entry: {rel}")
            files[rel] = {"sha256": _hash_file(path), "bytes": path.stat().st_size}

    meta_path = root / "meta.json"
    try:
        validate_meta(meta_path.read_bytes())
    except (OSError, ReleaseManifestError) as exc:
        raise ReleaseManifestError(f"meta.json is missing or invalid JSON: {exc}") from None

    ordered_files = {path: files[path] for path in sorted(files)}
    identity = {"schema_version": SCHEMA_VERSION, "files": ordered_files}
    canonical = canonical_json(identity)
    return {"schema_version": SCHEMA_VERSION, "release_id": hashlib.sha256(canonical).hexdigest(), "files": ordered_files}


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create an offline release manifest for a validated data tree.")
    parser.add_argument("--dir", required=True, help="validated data tree")
    parser.add_argument("--output", required=True, help="output JSON path outside the data tree")
    args = parser.parse_args(argv)
    try:
        root_arg = Path(args.dir)
        if stat.S_ISLNK(root_arg.lstat().st_mode):
            raise ReleaseManifestError("input directory cannot be a symbolic link")
        root = root_arg.resolve(strict=True)
        output = Path(args.output).resolve(strict=False)
        if _inside(output, root):
            raise ReleaseManifestError("output must be outside the input tree")
        manifest = build_manifest(root)
        payload = json.dumps(manifest, ensure_ascii=True, indent=2) + "\n"
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, output)
        except BaseException:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise
    except (OSError, ReleaseManifestError) as exc:
        print(f"release manifest: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {output} ({manifest['release_id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
