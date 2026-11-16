"""No-change days, changed-files-only storage, shared blobs and --measure for the content-addressed publisher."""
from __future__ import annotations

import json

import pytest  # noqa: F401 - fixtures come from the sibling module

from pipeline import publish_release as pr
from pipeline.release_blobs import blob_key
from pipeline.release_manifest import build_manifest
from .test_publish_release import A1, A2, BUCKET, Client, body, descriptor, keys, publish, put, s3, tree  # noqa: F401


def test_no_change_day_ignores_meta_json_and_logs(s3, tree, capsys):
    first = publish(s3, tree, True)
    pointer, index = body(s3, pr.CURRENT), body(s3, pr.INDEX)
    before = keys(s3)
    (tree / "meta.json").write_text(json.dumps({"build": {"time": "t2"}}))  # only the build time moved
    result = publish(Client(s3), tree, True)
    assert result["unchanged"] and result["release_id"] == first["release_id"] and not result["activated"]
    assert f"no data change; release {first['release_id']} stays current" in capsys.readouterr().out
    assert keys(s3) == before and body(s3, pr.CURRENT) == pointer and body(s3, pr.INDEX) == index


def test_data_change_creates_release_storing_only_changed_blobs(s3, tree):
    first = publish(s3, tree, True)
    before = keys(s3)
    (tree / "members" / "A1.json").write_text('{"a":2}')
    second = publish(s3, tree, True)
    assert not second["unchanged"] and second["release_id"] != first["release_id"]
    assert (second["blobs"], second["new_blobs"], second["reused_blobs"], second["new_bytes"]) == (2, 1, 1, 7)
    assert keys(s3) - before == {A2, descriptor(second["release_id"])}


def test_skip_is_not_taken_when_the_current_descriptor_is_unusable(s3, tree):
    first = publish(s3, tree, True)
    s3.delete_object(Bucket=BUCKET, Key=descriptor(first["release_id"]))
    again = publish(s3, tree, True)
    assert not again["unchanged"] and descriptor(first["release_id"]) in keys(s3)


def test_unchanged_check_does_not_apply_without_activate(s3, tree):
    publish(s3, tree, True)
    assert not publish(s3, tree)["unchanged"]


def test_identical_bytes_at_two_paths_are_one_blob_keeping_the_first_type(s3, tree):
    (tree / "notes.txt").write_text('{"a":1}')  # same bytes as members/A1.json
    result = publish(s3, tree)
    assert (result["files"], result["blobs"], result["new_blobs"]) == (3, 2, 2)
    assert s3.head_object(Bucket=BUCKET, Key=A1)["ContentType"] == "application/json"  # members/A1.json sorts first
    # A later release that stores the same bytes only under a .txt path reuses the blob without changing its type.
    (tree / "members" / "A1.json").write_text('{"a":3}')
    (tree / "meta.json").write_text(json.dumps({"build": {"time": "t9"}}))
    assert publish(s3, tree)["reused_blobs"] == 1
    assert s3.head_object(Bucket=BUCKET, Key=A1)["ContentType"] == "application/json"


def test_reuse_accepts_a_blob_stored_with_another_content_type(s3, tree):
    meta = blob_key(build_manifest(tree)["files"]["meta.json"]["sha256"])
    put(s3, meta, (tree / "meta.json").read_bytes(), ctype="text/plain")
    assert publish(s3, tree)["reused_blobs"] == 1
    assert s3.head_object(Bucket=BUCKET, Key=meta)["ContentType"] == "text/plain"


def test_measure_reports_new_reused_and_total_archive_size(monkeypatch, s3, tree, capsys):
    monkeypatch.setattr(pr, "client_from_env", lambda require: (s3, BUCKET))
    assert pr.main(["--dir", str(tree), "--activate", "--measure"]) == 0
    (tree / "members" / "A1.json").write_text('{"a":22}')
    capsys.readouterr()
    assert pr.main(["--dir", str(tree), "--activate", "--measure"]) == 0
    out = capsys.readouterr().out
    meta_size = (tree / "meta.json").stat().st_size
    assert "files in release:        2" in out and "blobs new / reused:      1 / 1" in out
    assert "new bytes this run:      8" in out
    assert f"archive blobs total:     3" in out
    assert f"archive bytes total:     {meta_size + 7 + 8} " in out
    assert pr.main(["--dir", str(tree), "--activate", "--measure"]) == 0  # no-change run still prints the total
    assert "archive bytes total" in capsys.readouterr().out
