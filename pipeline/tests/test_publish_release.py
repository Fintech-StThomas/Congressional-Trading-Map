"""Content-addressed archive, no-change skip, verification trade-offs and compare-and-swap activation (moto S3)."""
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
from pipeline.release_blobs import blob_key
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


def sha(text):
    return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()


A1 = blob_key(sha('{"a":1}'))
A2 = blob_key(sha('{"a":2}'))


def descriptor(release):
    return f"releases/{release}/release.json"


def publish(client, tree, activate=False):
    return pr.publish(client, BUCKET, tree, activate=activate, sleep=lambda _: None)


def test_stage_then_activate_and_repeat_preserves_exact_bytes_and_headers(s3, tree):
    s3.put_object(Bucket=BUCKET, Key="data/legacy.json", Body=b"legacy")
    client = Client(s3)
    staged = publish(client, tree)
    release_id = staged["release_id"]
    assert (staged["files"], staged["blobs"], staged["new_blobs"], staged["reused_blobs"]) == (2, 2, 2, 0)
    assert staged["new_bytes"] == len(b'{"a":1}') + (tree / "meta.json").stat().st_size
    assert pr.CURRENT not in keys(s3)
    assert client.puts[-1]["Key"] == descriptor(release_id)
    assert all(p["IfNoneMatch"] == "*" for p in client.puts)
    assert keys(s3) == {"data/legacy.json", descriptor(release_id), A1, blob_key(build_manifest(tree)["files"]["meta.json"]["sha256"])}
    assert body(s3, descriptor(release_id)) == canonical_json(build_manifest(tree))
    for rel, entry in build_manifest(tree)["files"].items():
        assert body(s3, blob_key(entry["sha256"])) == (tree / rel).read_bytes()
        head = s3.head_object(Bucket=BUCKET, Key=blob_key(entry["sha256"]))
        assert head["CacheControl"] == pr.IMMUTABLE_CACHE
        assert head["ContentType"] == "application/json"
    activated = publish(client, tree, True)
    assert activated["new_blobs"] == 0 and activated["reused_blobs"] == 2 and activated["activated"]
    pointer = body(s3, pr.CURRENT)
    assert json.loads(pointer) == {"schema_version": 1, "release_id": release_id,
                                  "manifest_sha256": hashlib.sha256(body(s3, descriptor(release_id))).hexdigest()}
    assert client.puts[-1]["CacheControl"] == pr.POINTER_CACHE
    client.puts.clear()
    again = publish(client, tree, True)  # identical tree: a no-change day
    assert again["unchanged"] and again["release_id"] == release_id and client.puts == []
    assert body(s3, pr.CURRENT) == pointer
    assert body(s3, "data/legacy.json") == b"legacy"


@pytest.mark.parametrize("conflict", [False, True])
def test_missing_first_head_then_concurrent_creation_uses_conditional_write(s3, tree, conflict):
    raced_body = b"conflict" if conflict else b'{"a":1}'

    class RacingClient(Client):
        raced = False

        def head_object(self, **kwargs):
            if kwargs["Key"] == A1 and not self.raced:
                self.raced = True
                put(s3, A1, raced_body)
                raise ClientError({"Error": {"Code": "404"}, "ResponseMetadata": {"HTTPStatusCode": 404}}, "HeadObject")
            return self.client.head_object(**kwargs)
    client = RacingClient(s3)
    if conflict:
        with pytest.raises(pr.PublishError, match="conflicting"):
            publish(client, tree, True)
        assert pr.CURRENT not in keys(s3)
    else:
        assert publish(client, tree, True)["new_blobs"] == 1  # only meta.json: the racing writer created A1
    assert body(s3, A1) == raced_body
    assert next(p for p in client.puts if p["Key"] == A1)["IfNoneMatch"] == "*"


def test_new_release_retains_old_and_verified_rollback(s3, tree):
    first = publish(s3, tree, True)
    old_keys = keys(s3) - {pr.CURRENT, pr.INDEX}
    (tree / "members" / "A1.json").write_text('{"a":2}')
    second = publish(s3, tree, True)
    assert first["release_id"] != second["release_id"]
    assert old_keys < keys(s3)
    result = pr.activate_release(s3, BUCKET, first["release_id"], sleep=lambda _: None)
    assert result["activated"]
    assert json.loads(body(s3, pr.CURRENT))["release_id"] == first["release_id"]


@pytest.mark.parametrize("phase", ["blob", "descriptor", "pointer"])
def test_failure_in_each_phase_preserves_pointer_and_resumes(s3, tree, phase):
    publish(s3, tree, True)
    previous = body(s3, pr.CURRENT)
    (tree / "members" / "A1.json").write_text('{"a":2}')
    release = build_manifest(tree)["release_id"]
    target = {"blob": A2, "descriptor": descriptor(release), "pointer": pr.CURRENT}[phase]

    def fail(kwargs):
        if kwargs["Key"] == target:
            raise error()
    client = Client(s3, fail)
    with pytest.raises(pr.PublishError):
        publish(client, tree, True)
    assert body(s3, pr.CURRENT) == previous
    if phase == "blob":
        assert descriptor(release) not in keys(s3) and A2 not in keys(s3)
    retried = publish(s3, tree, True)
    assert retried["new_blobs"] == (1 if phase == "blob" else 0)
    assert json.loads(body(s3, pr.CURRENT))["release_id"] == release


@pytest.mark.parametrize("conflict", ["size", "cache", "descriptor"])
def test_existing_conflict_is_never_overwritten(s3, tree, conflict):
    staged = publish(s3, tree)
    manifest = build_manifest(tree)
    meta_blob = blob_key(manifest["files"]["meta.json"]["sha256"])
    target = descriptor(manifest["release_id"]) if conflict == "descriptor" else meta_blob
    payload = body(s3, target)
    if conflict in ("size", "descriptor"):
        payload += b"wrong"
    put(s3, target, payload, cache="no-cache" if conflict == "cache" else pr.IMMUTABLE_CACHE)
    with pytest.raises(pr.PublishError, match="conflicting"):
        publish(s3, tree)
    assert body(s3, target) == payload
    assert staged["release_id"] == manifest["release_id"] and pr.CURRENT not in keys(s3)


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


@pytest.mark.parametrize("target", ["blob", "descriptor", "pointer"])
def test_lost_success_response_is_resolved_by_verified_readback(s3, tree, target):
    hit = False

    def timeout(kwargs):
        nonlocal hit
        match = (kwargs["Key"] == pr.CURRENT if target == "pointer" else
                 kwargs["Key"].endswith("release.json") if target == "descriptor" else kwargs["Key"] == A1)
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


@pytest.mark.parametrize("mutation", ["before_read", "during_blob", "new_file", "after_marker"])
def test_local_mutation_prevents_activation(s3, tree, mutation):
    publish(s3, tree, True)
    old = body(s3, pr.CURRENT)
    (tree / "members" / "A1.json").write_text('{"a":2}')
    release = build_manifest(tree)["release_id"]

    def mutate(key):
        if mutation == "before_read":
            (tree / "members" / "A1.json").write_text('{"a":9}')
        elif mutation == "new_file":
            (tree / "new.json").write_text("{}")
        else:
            (tree / "meta.json").write_text(json.dumps({"build": {"time": "mutated"}}))

    class Mutating(Client):
        def head_object(self, **kwargs):
            if mutation == "before_read" and kwargs["Key"] == A2:
                mutate(kwargs["Key"])
            return self.client.head_object(**kwargs)

    def hook(kwargs):
        if mutation in ("during_blob", "new_file") and kwargs["Key"] == A2:
            mutate(kwargs["Key"])
        if mutation == "after_marker" and kwargs["Key"].endswith("release.json"):
            mutate(kwargs["Key"])
    with pytest.raises(pr.PublishError, match="changed"):
        publish(Mutating(s3, hook), tree, True)
    assert body(s3, pr.CURRENT) == old
    if mutation != "after_marker":
        assert descriptor(release) not in keys(s3)


def two_releases(s3, tree):
    first = publish(s3, tree, True)["release_id"]
    (tree / "members" / "A1.json").write_text('{"a":2}')
    publish(s3, tree, True)
    return first, body(s3, pr.CURRENT)


@pytest.mark.parametrize("corruption", ["size", "missing", "headers", "descriptor"])
def test_rollback_verifies_every_blob_by_head_before_pointer_write(s3, tree, corruption):
    first, pointer = two_releases(s3, tree)
    target = descriptor(first) if corruption == "descriptor" else A1
    if corruption == "missing":
        s3.delete_object(Bucket=BUCKET, Key=target)
    else:
        put(s3, target, body(s3, target) if corruption in ("headers", "descriptor") else b"corrupt!!",
            cache="no-cache" if corruption == "headers" else pr.IMMUTABLE_CACHE)
        if corruption == "descriptor":
            put(s3, target, body(s3, target) + b" ")
    with pytest.raises((pr.PublishError, ReleaseManifestError)):
        pr.activate_release(s3, BUCKET, first, sleep=lambda _: None)
    assert body(s3, pr.CURRENT) == pointer


def test_same_size_corruption_of_a_reused_blob_needs_full_verify(s3, tree):
    """The documented trade-off: reuse and rollback check size by HEAD; --full-verify re-hashes every blob."""
    first, pointer = two_releases(s3, tree)
    put(s3, A1, b'{"a":7}')  # same length as the original bytes, different content
    with pytest.raises(pr.PublishError, match="conflicting bytes"):
        pr.activate_release(s3, BUCKET, first, full=True, sleep=lambda _: None)
    assert body(s3, pr.CURRENT) == pointer
    assert pr.activate_release(s3, BUCKET, first, sleep=lambda _: None)["activated"]  # HEAD-level check passes
    assert pr.activate_release(s3, BUCKET, first, full=False, sleep=lambda _: None)["full_verify"] is False


def test_rollback_reads_only_meta_json_in_full(s3, tree):
    first, _ = two_releases(s3, tree)
    client = Client(s3)
    gets = []
    client.get_object = lambda **kw: (gets.append(kw["Key"]), s3.get_object(**kw))[1]
    pr.activate_release(client, BUCKET, first, sleep=lambda _: None)
    meta = blob_key(build_manifest(tree)["files"]["meta.json"]["sha256"])
    assert [k for k in gets if k.startswith("releases/blobs/")] == [meta]


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
    target = descriptor(release)
    put(s3, target, json.dumps(build_manifest(tree), indent=2).encode())
    with pytest.raises(pr.PublishError, match="canonically"):
        pr.activate_release(s3, BUCKET, release, sleep=lambda _: None)
    assert body(s3, pr.CURRENT) == pointer
