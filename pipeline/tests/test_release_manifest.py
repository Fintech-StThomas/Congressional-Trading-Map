"""Behavioral tests for deterministic offline release manifests."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from pipeline import release_manifest
from pipeline.release_manifest import ReleaseManifestError, build_manifest, main


def make_tree(root: Path, *, build_time: str = "2026-11-16T00:00:00Z") -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "meta.json").write_text(json.dumps({"build": {"time": build_time}}), encoding="utf-8")
    (root / "members").mkdir(exist_ok=True)
    (root / "members" / "A000001.json").write_bytes(b'{"member":1}')


def test_manifest_creation_order_and_mtime_do_not_change_identity(tmp_path: Path) -> None:
    first_root = tmp_path / "first"
    make_tree(first_root)
    (first_root / "a.json").write_bytes(b"first")
    (first_root / "z.json").write_bytes(b"last")

    second_root = tmp_path / "second"
    second_root.mkdir()
    (second_root / "z.json").write_bytes(b"last")
    (second_root / "members").mkdir()
    (second_root / "members" / "A000001.json").write_bytes(b'{"member":1}')
    (second_root / "a.json").write_bytes(b"first")
    (second_root / "meta.json").write_text(
        json.dumps({"build": {"time": "2026-11-16T00:00:00Z"}}), encoding="utf-8"
    )

    first = build_manifest(first_root)
    os.utime(first_root / "members" / "A000001.json", (1, 1))
    os.utime(first_root / "meta.json", (1, 1))
    second = build_manifest(second_root)
    assert first == second
    assert list(first["files"]) == sorted(first["files"])
    canonical = json.dumps(
        {"schema_version": 1, "files": first["files"]},
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")
    assert first["release_id"] == hashlib.sha256(canonical).hexdigest()


@pytest.mark.parametrize("change", ["content", "path", "size", "metadata"])
def test_file_content_path_size_and_metadata_change_identity(tmp_path: Path, change: str) -> None:
    root = tmp_path / "data"
    make_tree(root)
    before = build_manifest(root)["release_id"]
    if change == "content":
        (root / "members" / "A000001.json").write_bytes(b'{"member":2}')
    elif change == "path":
        (root / "members" / "A000001.json").rename(root / "members" / "A000002.json")
    elif change == "size":
        (root / "members" / "A000001.json").write_bytes(b"short")
    else:
        (root / "meta.json").write_text(json.dumps({"build": {"time": "2026-11-17T00:00:00Z"}}), encoding="utf-8")
    assert build_manifest(root)["release_id"] != before


def test_rejects_symlink_and_reserved_root_files(tmp_path: Path) -> None:
    root = tmp_path / "data"
    make_tree(root)
    (root / "link").symlink_to(root / "meta.json")
    with pytest.raises(ReleaseManifestError, match="unsupported filesystem entry"):
        build_manifest(root)
    (root / "link").unlink()
    (root / "release.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ReleaseManifestError, match="reserved root file"):
        build_manifest(root)


def test_rejects_root_symlink(tmp_path: Path) -> None:
    root = tmp_path / "data"
    make_tree(root)
    alias = tmp_path / "data-alias"
    alias.symlink_to(root, target_is_directory=True)
    with pytest.raises(ReleaseManifestError, match="input directory cannot be a symbolic link"):
        build_manifest(alias)


def test_rejects_special_files_when_fifo_is_supported(tmp_path: Path) -> None:
    if not hasattr(os, "mkfifo"):
        pytest.skip("FIFO creation is unavailable on this platform")
    root = tmp_path / "data"
    make_tree(root)
    try:
        os.mkfifo(root / "pipe")
    except (NotImplementedError, OSError) as exc:
        pytest.skip(f"FIFO creation is unavailable: {exc}")
    with pytest.raises(ReleaseManifestError, match="unsupported filesystem entry: pipe"):
        build_manifest(root)


@pytest.mark.parametrize("meta", [
    {},
    {"build": {}},
    {"build": {"time": ""}},
    {"build": {"time": "   "}},
    {"build": {"time": 123}},
])
def test_rejects_missing_or_malformed_build_time(tmp_path: Path, meta: dict) -> None:
    root = tmp_path / "data"
    make_tree(root)
    (root / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    with pytest.raises(ReleaseManifestError, match="build"):
        build_manifest(root)


def test_directory_enumeration_error_fails_instead_of_omitting_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "data"
    make_tree(root)

    def failed_walk(path, *, onerror, **kwargs):
        onerror(PermissionError("cannot read nested directory"))
        return iter(())

    monkeypatch.setattr(release_manifest.os, "walk", failed_walk)
    with pytest.raises(ReleaseManifestError, match="cannot enumerate input tree"):
        build_manifest(root)


def test_rejects_output_inside_tree_after_symlink_resolution(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tmp_path / "data"
    make_tree(root)
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    alias = outside / "alias"
    alias.symlink_to(root, target_is_directory=True)
    assert main(["--dir", str(root), "--output", str(alias / "release.json")]) == 2
    assert "outside the input tree" in capsys.readouterr().err
    assert not (root / "release.json").exists()


def test_invalid_input_does_not_overwrite_existing_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tmp_path / "data"
    make_tree(root)
    output = tmp_path / "release.json"
    output.write_text("prior release", encoding="utf-8")
    (root / "meta.json").write_text("not json", encoding="utf-8")
    assert main(["--dir", str(root), "--output", str(output)]) == 2
    assert output.read_text(encoding="utf-8") == "prior release"
    assert "meta.json" in capsys.readouterr().err


def test_failed_atomic_replace_preserves_output_and_cleans_temporary_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    root = tmp_path / "data"
    make_tree(root)
    output = tmp_path / "release.json"
    output.write_text("prior release", encoding="utf-8")

    def fail_replace(source: str, destination: Path) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(release_manifest.os, "replace", fail_replace)
    assert main(["--dir", str(root), "--output", str(output)]) == 2
    assert output.read_text(encoding="utf-8") == "prior release"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["data", "release.json"]
    assert "replace failed" in capsys.readouterr().err


def test_cli_writes_valid_manifest_atomically(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tmp_path / "data"
    make_tree(root)
    output = tmp_path / "release.json"
    assert main(["--dir", str(root), "--output", str(output)]) == 0
    assert json.loads(output.read_text(encoding="utf-8")) == build_manifest(root)
    assert str(output) in capsys.readouterr().out
    assert sorted(path.name for path in tmp_path.iterdir()) == ["data", "release.json"]


@pytest.mark.parametrize("mutation", ["schema", "boolean_schema", "extra", "missing_meta", "bad_hash",
                                     "boolean_size", "negative_size", "wrong_identity", "wrong_id", "extra_entry"])
def test_untrusted_descriptor_validation(tmp_path: Path, mutation: str) -> None:
    root = tmp_path / "data"
    make_tree(root)
    manifest = build_manifest(root)
    if mutation == "schema":
        manifest["schema_version"] = 2
    elif mutation == "boolean_schema":
        manifest["schema_version"] = True
    elif mutation == "extra":
        manifest["url"] = "https://example.com"
    elif mutation == "missing_meta":
        del manifest["files"]["meta.json"]
    elif mutation == "bad_hash":
        manifest["files"]["meta.json"]["sha256"] = "A" * 64
    elif mutation == "boolean_size":
        manifest["files"]["meta.json"]["bytes"] = True
    elif mutation == "negative_size":
        manifest["files"]["meta.json"]["bytes"] = -1
    elif mutation == "wrong_identity":
        manifest["files"]["meta.json"]["bytes"] += 1
    elif mutation == "wrong_id":
        manifest["release_id"] = "a" * 64
    else:
        manifest["files"]["meta.json"]["url"] = "https://example.com"
    with pytest.raises(ReleaseManifestError):
        release_manifest.validate_manifest(manifest)


def test_canonical_descriptor_and_exact_requested_identity(tmp_path: Path) -> None:
    root = tmp_path / "data"
    make_tree(root)
    manifest = build_manifest(root)
    encoded = release_manifest.canonical_json(manifest)
    assert b"\n" not in encoded
    assert release_manifest.validate_manifest(release_manifest.decode_json(encoded), manifest["release_id"]) == manifest
    with pytest.raises(ReleaseManifestError, match="identity"):
        release_manifest.validate_manifest(manifest, "a" * 64)


@pytest.mark.parametrize("body", [b'{"a":1,"a":2}', b'{"nested":{"a":1,"a":2}}', b"\xff"])
def test_untrusted_json_does_not_silently_accept_ambiguity(body: bytes) -> None:
    with pytest.raises(ReleaseManifestError):
        release_manifest.decode_json(body)


@pytest.mark.parametrize("path", ["a\\b.json", "https:bad.json", "control\n.json"])
def test_local_tree_rejects_names_unsafe_for_remote_verification(tmp_path: Path, path: str) -> None:
    root = tmp_path / "data"
    make_tree(root)
    (root / path).write_text("{}")
    with pytest.raises(ReleaseManifestError, match="path"):
        build_manifest(root)
