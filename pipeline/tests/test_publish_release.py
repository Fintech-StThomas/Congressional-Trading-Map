"""Immutable archive and compare-and-swap activation behavior against moto's local S3."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from pipeline import publish_release as pr
from pipeline import publish_r2
from pipeline.release_manifest import build_manifest, canonical_json, ReleaseManifestError

BUCKET = "paper-trail"


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    (root / "meta.json").write_text(json.dumps({"build": {"time": "t1"}}))
    (root / "members").mkdir()
    (root / "members" / "A1.json").write_text('{"a":1}')
    return root


def body(client, key):
    return client.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def keys(client):
    return {entry["Key"] for entry in client.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


def put(client, key, payload, *, cache=pr.IMMUTABLE_CACHE, ctype="application/json"):
    client.put_object(Bucket=BUCKET, Key=key, Body=payload, ContentType=ctype, CacheControl=cache)


def error(status=500):
    return ClientError({"Error": {"Code": "InternalError" if status == 500 else "AccessDenied"},
                        "ResponseMetadata": {"HTTPStatusCode": status}}, "PutObject")


class Client:
    def __init__(self, client, hook=None):
        self.client, self.hook, self.puts = client, hook, []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        if self.hook:
            self.hook(kwargs)
        return self.client.put_object(**kwargs)

    def __getattr__(self, name):
        return getattr(self.client, name)


def publish(client, tree, activate=False):
    return pr.publish(client, BUCKET, tree, activate=activate, sleep=lambda _: None)


def test_stage_then_activate_and_repeat_preserves_exact_bytes_and_headers(s3, tree):
    s3.put_object(Bucket=BUCKET, Key="data/legacy.json", Body=b"legacy")
    client = Client(s3)
    staged = publish(client, tree)
    release_id = staged["release_id"]
    prefix = f"releases/{release_id}/"
    assert pr.CURRENT not in keys(s3)
    assert client.puts[-1]["Key"] == prefix + "release.json"
    assert all(p["IfNoneMatch"] == "*" for p in client.puts)
    assert body(s3, prefix + "release.json") == canonical_json(build_manifest(tree))
    for rel in build_manifest(tree)["files"]:
        assert body(s3, prefix + rel) == (tree / rel).read_bytes()
        head = s3.head_object(Bucket=BUCKET, Key=prefix + rel)
        assert head["CacheControl"] == pr.IMMUTABLE_CACHE
        assert head["ContentType"] == publish_r2.content_type(rel)
    activated = publish(client, tree, True)
    assert activated["uploaded"] == 0
    pointer = body(s3, pr.CURRENT)
    assert json.loads(pointer) == {"schema_version": 1, "release_id": release_id,
                                  "manifest_sha256": hashlib.sha256(body(s3, prefix + "release.json")).hexdigest()}
    assert client.puts[-1]["CacheControl"] == pr.POINTER_CACHE
    client.puts.clear()
    assert publish(client, tree, True)["uploaded"] == 0
    assert [p["Key"] for p in client.puts] == [pr.CURRENT]
    assert body(s3, pr.CURRENT) == pointer
    assert body(s3, "data/legacy.json") == b"legacy"


@pytest.mark.parametrize("conflict", [False, True])
def test_missing_first_get_then_concurrent_creation_uses_conditional_write(s3, tree, conflict):
    manifest = build_manifest(tree)
    target = f"releases/{manifest['release_id']}/members/A1.json"
    raced_body = b"conflict" if conflict else (tree / "members" / "A1.json").read_bytes()

    class RacingClient(Client):
        raced = False

        def get_object(self, **kwargs):
            if kwargs["Key"] == target and not self.raced:
                self.raced = True
                put(s3, target, raced_body)
                raise ClientError({"Error": {"Code": "NoSuchKey"},
                                   "ResponseMetadata": {"HTTPStatusCode": 404}}, "GetObject")
            return self.client.get_object(**kwargs)
    client = RacingClient(s3)
    if conflict:
        with pytest.raises(pr.PublishError, match="conflicting"):
            publish(client, tree, True)
        assert pr.CURRENT not in keys(s3)
    else:
        assert publish(client, tree, True)["uploaded"] == 1
    assert body(s3, target) == raced_body
    assert next(p for p in client.puts if p["Key"] == target)["IfNoneMatch"] == "*"


def test_new_release_retains_old_and_verified_rollback(s3, tree):
    first = publish(s3, tree, True)
    old_keys = keys(s3) - {pr.CURRENT}
    (tree / "members" / "A1.json").write_text('{"a":2}')
    second = publish(s3, tree, True)
    assert first["release_id"] != second["release_id"]
    assert old_keys < keys(s3)
    result = pr.activate_release(s3, BUCKET, first["release_id"], sleep=lambda _: None)
    assert result["activated"]
    assert json.loads(body(s3, pr.CURRENT))["release_id"] == first["release_id"]


@pytest.mark.parametrize("phase", ["file", "descriptor", "pointer"])
def test_failure_in_each_phase_preserves_pointer_and_resumes(s3, tree, phase):
    publish(s3, tree, True)
    previous = body(s3, pr.CURRENT)
    (tree / "members" / "A1.json").write_text('{"a":2}')
    release = build_manifest(tree)["release_id"]
    prefix = f"releases/{release}/"
    target = {"file": prefix + "meta.json", "descriptor": prefix + "release.json", "pointer": pr.CURRENT}[phase]

    def fail(kwargs):
        if kwargs["Key"] == target:
            raise error()
    client = Client(s3, fail)
    with pytest.raises(pr.PublishError):
        publish(client, tree, True)
    assert body(s3, pr.CURRENT) == previous
    if phase == "file":
        assert prefix + "release.json" not in keys(s3)
    retried = publish(s3, tree, True)
    assert retried["uploaded"] < retried["files"]
    assert json.loads(body(s3, pr.CURRENT))["release_id"] == release


@pytest.mark.parametrize("conflict", ["bytes", "cache", "type", "descriptor"])
def test_existing_conflict_is_never_overwritten(s3, tree, conflict):
    publish(s3, tree, True)
    pointer = body(s3, pr.CURRENT)
    manifest = build_manifest(tree)
    prefix = f"releases/{manifest['release_id']}/"
    target = prefix + ("release.json" if conflict == "descriptor" else "meta.json")
    payload = body(s3, target)
    if conflict in ("bytes", "descriptor"):
        payload += b"wrong"
    put(s3, target, payload, cache="no-cache" if conflict == "cache" else pr.IMMUTABLE_CACHE,
        ctype="text/plain" if conflict == "type" else "application/json")
    with pytest.raises(pr.PublishError, match="conflicting"):
        publish(s3, tree, True)
    assert body(s3, target) == payload
    assert body(s3, pr.CURRENT) == pointer


@pytest.mark.parametrize("initial", [True, False])
def test_concurrent_pointer_creation_or_change_fails_closed(s3, tree, initial):
    if initial:
        publish(s3, tree, True)
        (tree / "members" / "A1.json").write_text('{"a":2}')
    competitor = canonical_json({"schema_version": 1, "release_id": "a" * 64, "manifest_sha256": "b" * 64})

    def race(kwargs):
        if kwargs["Key"] == pr.CURRENT:
            put(s3, pr.CURRENT, competitor, cache=pr.POINTER_CACHE)
    with pytest.raises(pr.PublishError, match="concurrently"):
        publish(Client(s3, race), tree, True)
    assert body(s3, pr.CURRENT) == competitor


@pytest.mark.parametrize("target", ["file", "descriptor", "pointer"])
def test_lost_success_response_is_resolved_by_verified_readback(s3, tree, target):
    hit = False

    def timeout(kwargs):
        nonlocal hit
        match = (kwargs["Key"] == pr.CURRENT if target == "pointer" else
                 kwargs["Key"].endswith("release.json" if target == "descriptor" else "A1.json"))
        if not hit and match:
            hit = True
            s3.put_object(**kwargs)
            raise TimeoutError("secret endpoint must never be rendered")
    assert publish(Client(s3, timeout), tree, True)["activated"]
    assert hit


def test_ambiguous_pointer_failure_does_not_accept_different_readback(s3, tree):
    publish(s3, tree, True)
    old = body(s3, pr.CURRENT)
    (tree / "members" / "A1.json").write_text('{"a":2}')

    def timeout(kwargs):
        if kwargs["Key"] == pr.CURRENT:
            raise TimeoutError("not stored")
    with pytest.raises(pr.PublishError):
        publish(Client(s3, timeout), tree, True)
    assert body(s3, pr.CURRENT) == old


@pytest.mark.parametrize("mutation", ["before_read", "after_read", "new_file", "after_marker"])
def test_local_mutation_prevents_activation(s3, tree, mutation):
    publish(s3, tree, True)
    old = body(s3, pr.CURRENT)
    (tree / "members" / "A1.json").write_text('{"a":2}')
    release = build_manifest(tree)["release_id"]

    def mutate(kwargs):
        suffix = {"before_read": "A1.json", "after_read": "meta.json", "new_file": "meta.json",
                  "after_marker": "release.json"}[mutation]
        if kwargs["Key"].endswith(suffix):
            if mutation == "new_file":
                (tree / "new.json").write_text("{}")
            else:
                (tree / "meta.json").write_text(json.dumps({"build": {"time": "mutated"}}))
    with pytest.raises(pr.PublishError, match="changed"):
        publish(Client(s3, mutate), tree, True)
    assert body(s3, pr.CURRENT) == old
    if mutation != "after_marker":
        assert f"releases/{release}/release.json" not in keys(s3)


@pytest.mark.parametrize("corruption", ["file", "missing", "headers", "descriptor"])
def test_rollback_fully_verifies_before_pointer_write(s3, tree, corruption):
    first = publish(s3, tree, True)["release_id"]
    (tree / "members" / "A1.json").write_text('{"a":2}')
    publish(s3, tree, True)
    pointer = body(s3, pr.CURRENT)
    target = f"releases/{first}/" + ("release.json" if corruption == "descriptor" else "members/A1.json")
    if corruption == "missing":
        s3.delete_object(Bucket=BUCKET, Key=target)
    else:
        put(s3, target, body(s3, target) if corruption == "headers" else b"corrupt",
            cache="no-cache" if corruption == "headers" else pr.IMMUTABLE_CACHE)
    with pytest.raises((pr.PublishError, ReleaseManifestError)):
        pr.activate_release(s3, BUCKET, first, sleep=lambda _: None)
    assert body(s3, pr.CURRENT) == pointer


@pytest.mark.parametrize("path", ["../outside", "/outside", "a//b", "a/./b", "a/../b", "a\\b",
                                  "release.json", "_manifest.json", "https://example.com/x"])
def test_remote_descriptor_rejects_unsafe_paths_before_fetching_files(s3, tree, path):
    manifest = build_manifest(tree)
    manifest["files"][path] = {"sha256": "a" * 64, "bytes": 1}
    manifest["release_id"] = hashlib.sha256(canonical_json({"schema_version": 1, "files": manifest["files"]})).hexdigest()
    target = f"releases/{manifest['release_id']}/release.json"
    put(s3, target, canonical_json(manifest))
    with pytest.raises(ReleaseManifestError, match="path"):
        pr.activate_release(s3, BUCKET, manifest["release_id"], sleep=lambda _: None)
    assert keys(s3) == {target}


@pytest.mark.parametrize("pointer", [b"{}", b"invalid", b'{"schema_version":true}', b'{"release_id":"https://evil"}'])
def test_malformed_pointer_blocks_all_work(s3, tree, pointer):
    put(s3, pr.CURRENT, pointer, cache=pr.POINTER_CACHE)
    with pytest.raises(ReleaseManifestError):
        publish(s3, tree, True)
    assert keys(s3) == {pr.CURRENT}


def test_cli_requires_credentials_and_does_not_print_transport_secrets(monkeypatch, tree, capsys):
    for name in publish_r2.REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    assert pr.main(["--dir", str(tree)]) == 2
    assert "R2_BUCKET" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        pr.main(["--release", "a" * 64])
    assert pr.main(["--release", "https://evil", "--activate"]) == 1
    assert "https://evil" not in capsys.readouterr().err


def test_cli_sanitizes_client_initialization_failure(monkeypatch, tree, capsys):
    def fail(**kwargs):
        raise ValueError("https://secret-account.r2.example.com secret-key")
    monkeypatch.setattr(pr, "client_from_env", fail)
    assert pr.main(["--dir", str(tree)]) == 1
    err = capsys.readouterr().err
    assert "ValueError" in err and "secret" not in err and "https" not in err


def test_rollback_rejects_noncanonical_descriptor_even_when_identity_is_valid(s3, tree):
    release = publish(s3, tree, True)["release_id"]
    pointer = body(s3, pr.CURRENT)
    target = f"releases/{release}/release.json"
    put(s3, target, json.dumps(build_manifest(tree), indent=2).encode())
    with pytest.raises(pr.PublishError, match="canonically"):
        pr.activate_release(s3, BUCKET, release, sleep=lambda _: None)
    assert body(s3, pr.CURRENT) == pointer
