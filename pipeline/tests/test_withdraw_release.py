"""Release withdrawal with shared blobs: exposure refusal, --also-withdraw, ordering, interruption, isolation."""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from pipeline import publish_release as pr
from pipeline import withdraw_release as wr
from pipeline.release_blobs import blob_key
from pipeline.release_manifest import build_manifest, canonical_json

BUCKET = "paper-trail"
NOW = lambda: datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)  # noqa: E731
FAST = lambda _: None  # noqa: E731


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "data"
    (root / "members").mkdir(parents=True)
    (root / "meta.json").write_text(json.dumps({"build": {"time": "t1"}}))
    (root / "members" / "A1.json").write_text('{"a":1}')
    return root


class Client:
    def __init__(self, client, fail_on=None):
        self.client, self.fail_on, self.calls = client, fail_on, []

    def __getattr__(self, name):
        target = getattr(self.client, name)
        if not callable(target):
            return target

        def call(**kwargs):
            self.calls.append((name, kwargs.get("Key")))
            if self.fail_on and self.fail_on(name, kwargs):
                raise ClientError({"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}}, name)
            return target(**kwargs)
        return call


def keys(client):
    pages = client.get_paginator("list_objects_v2").paginate(Bucket=BUCKET)
    return {e["Key"] for page in pages for e in page.get("Contents", [])}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def blob(text):
    return blob_key(sha(text))


def desc(release):
    return f"releases/{release}/release.json"


def stone(release):
    return f"releases/withdrawn/{release}.json"


def release(s3, tree, member, meta="t1", activate=True):
    (tree / "members" / "A1.json").write_text(member)
    (tree / "meta.json").write_text(json.dumps({"build": {"time": meta}}))
    return pr.publish(s3, BUCKET, tree, activate=activate, sleep=FAST)["release_id"]


def three(s3, tree):
    """r1 and r2 share the t1 meta.json blob; r3 (current) has its own meta and member bytes."""
    r1 = release(s3, tree, '{"a":1}')
    r2 = release(s3, tree, '{"a":2}')
    r3 = release(s3, tree, '{"a":3}', "t3")
    return r1, r2, r3


def withdraw(client, rid, reason="privacy", **kwargs):
    return wr.withdraw(client, BUCKET, rid, reason, sleep=FAST, now=NOW, **kwargs)


def index_ids(s3):
    return [e["release_id"] for e in json.loads(s3.get_object(Bucket=BUCKET, Key=pr.INDEX)["Body"].read())["releases"]]


def test_exposed_path_deletes_only_blobs_no_live_release_references(s3, tree):
    r1, r2, r3 = three(s3, tree)
    s3.put_object(Bucket=BUCKET, Key="data/legacy.json", Body=b"legacy")
    before = keys(s3)
    result = withdraw(s3, r1, exposed_paths=("members/A1.json",))
    assert result["withdrawn"] == [r1] and result["deleted_blobs"] == 1 and result["kept_shared_blobs"] == 1
    after = keys(s3)
    assert before - after == {blob('{"a":1}'), desc(r1)}
    assert after - before == {stone(r1)}
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=stone(r1))["Body"].read()) == {
        "schema_version": 1, "release_id": r1, "withdrawn_at": "2026-03-04T05:06:07Z", "reason": "privacy"}
    assert index_ids(s3) == [r3, r2]
    pr.activate_release(s3, BUCKET, r2, sleep=FAST)  # the sibling that shared the meta blob is still whole


def test_default_exposure_refuses_and_lists_releases_that_share_blobs(s3, tree):
    r1, r2, r3 = three(s3, tree)
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="--also-withdraw") as info:
        withdraw(s3, r1)
    assert r2 in str(info.value) and r3 not in str(info.value)
    assert keys(s3) == before  # refused before any tombstone or deletion


def test_also_withdraw_removes_every_named_release_and_unshared_blobs(s3, tree):
    r1, r2, r3 = three(s3, tree)
    result = withdraw(s3, r1, also=(r2,))
    assert result["withdrawn"] == [r1, r2] and result["deleted_blobs"] == 3 and result["kept_shared_blobs"] == 0
    live = keys(s3)
    assert {stone(r1), stone(r2), desc(r3), pr.CURRENT, pr.INDEX} <= live
    assert not {desc(r1), desc(r2), blob('{"a":1}'), blob('{"a":2}')} & live
    assert blob('{"a":3}') in live and index_ids(s3) == [r3]
    pr.activate_release(s3, BUCKET, r3, sleep=FAST)


def test_named_set_must_cover_all_sharing_releases(s3, tree):
    r1, r2, r3 = three(s3, tree)
    r4 = release(s3, tree, '{"a":4}', "t1", activate=False)  # also shares the t1 meta blob
    with pytest.raises(pr.PublishError) as info:
        withdraw(s3, r1, also=(r2,))
    assert r4 in str(info.value)
    assert stone(r1) not in keys(s3)


def test_current_release_that_shares_exposed_bytes_blocks_withdrawal(s3, tree):
    r1 = release(s3, tree, '{"a":1}')
    r2 = release(s3, tree, '{"a":2}')  # current; shares meta.json with r1
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="current release shares"):
        withdraw(s3, r1)
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(s3, r1, also=(r2,))
    assert keys(s3) == before


def test_refuses_current_release_and_changes_nothing(s3, tree):
    _, _, r3 = three(s3, tree)
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(s3, r3)
    assert keys(s3) == before


def test_exposed_path_must_exist_in_the_release(s3, tree):
    r1, _, _ = three(s3, tree)
    with pytest.raises(pr.PublishError, match="not a file"):
        withdraw(s3, r1, exposed_paths=("nope.json",))
    assert stone(r1) not in keys(s3)


def test_order_is_tombstones_then_blob_deletes_then_descriptors_then_index(s3, tree):
    r1, r2, _ = three(s3, tree)
    client = Client(s3)
    withdraw(client, r1, also=(r2,))
    ops = [(n, k) for n, k in client.calls if n in ("put_object", "delete_object")]
    kinds = ["stone" if k.startswith("releases/withdrawn/") else "blob" if k.startswith("releases/blobs/")
             else "desc" if k.endswith("release.json") else "index" for _, k in ops]
    assert kinds == ["stone"] * 2 + ["blob"] * 3 + ["desc"] * 2 + ["index"]
    assert all(n == "delete_object" for n, k in ops if k.startswith("releases/blobs/") or k.endswith("release.json"))


@pytest.mark.parametrize("stage", ["tombstone", "blob", "descriptor", "index"])
def test_interruption_then_rerun_completes(s3, tree, stage):
    r1, r2, r3 = three(s3, tree)
    target = {"tombstone": lambda n, kw: n == "put_object" and kw["Key"].startswith("releases/withdrawn/"),
              "blob": lambda n, kw: n == "delete_object" and kw["Key"] == blob('{"a":1}'),
              "descriptor": lambda n, kw: n == "delete_object" and kw["Key"] == desc(r1),
              "index": lambda n, kw: n == "put_object" and kw["Key"] == pr.INDEX}[stage]
    with pytest.raises(pr.PublishError):
        withdraw(Client(s3, target), r1, also=(r2,))
    assert (stone(r1) in keys(s3)) == (stage != "tombstone")
    result = withdraw(s3, r1, "legal", also=(r2,))
    after = keys(s3)
    assert not {desc(r1), desc(r2), blob('{"a":1}'), blob('{"a":2}')} & after
    assert {stone(r1), stone(r2), desc(r3), blob('{"a":3}')} <= after
    assert result["reason"] in ("privacy", "legal") and index_ids(s3) == [r3]
    withdraw(s3, r1, also=(r2,))  # fully idempotent once done


def test_rerun_needs_no_also_withdraw_for_releases_that_already_have_tombstones(s3, tree):
    r1, r2, r3 = three(s3, tree)
    with pytest.raises(pr.PublishError):
        withdraw(Client(s3, lambda n, kw: n == "delete_object" and kw["Key"] == blob('{"a":2}')), r1, also=(r2,))
    withdraw(s3, r1)  # r2 already has its tombstone, so it is no longer "live" and does not block r1
    withdraw(s3, r2)
    assert not {desc(r1), desc(r2), blob('{"a":1}'), blob('{"a":2}')} & keys(s3)


def test_lookalike_keys_survive(s3, tree):
    r1, r2, r3 = three(s3, tree)
    victim = sha('{"a":1}')
    extras = {f"releases/blobs/{victim}x", f"releases/blobs/{victim[:-1]}", f"releases/{r1}x/a.json", f"releases/{r1}",
              "data/x.json", f"releases/withdrawn/{r2}.json"}
    for key in extras:
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
    withdraw(s3, r1, exposed_paths=("members/A1.json",))
    assert extras <= keys(s3)


def test_pagination_of_release_listing(s3, tree):
    r1, r2, r3 = three(s3, tree)
    for n in range(1105):  # junk keys that are not releases must not break or slow release discovery
        s3.put_object(Bucket=BUCKET, Key=f"releases/blobs/{n:064x}", Body=b"x")
    assert withdraw(s3, r1, exposed_paths=("members/A1.json",))["deleted_blobs"] == 1
    assert len([k for k in keys(s3) if k.startswith("releases/blobs/")]) == 1105 + 4


def test_pointer_moving_to_release_after_tombstone_aborts_before_delete(s3, tree):
    r1, r2, r3 = three(s3, tree)

    def move(name, kwargs):
        if name == "put_object" and kwargs["Key"].startswith("releases/withdrawn/"):
            s3.put_object(Bucket=BUCKET, Key=pr.CURRENT, Body=canonical_json(
                {"schema_version": 1, "release_id": r1, "manifest_sha256": "a" * 64}))
        return False
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(Client(s3, move), r1, exposed_paths=("members/A1.json",))
    assert {desc(r1), blob('{"a":1}')} <= keys(s3)


def test_release_created_after_planning_that_shares_exposed_bytes_stops_deletion(s3, tree):
    r1, r2, r3 = three(s3, tree)
    other = tree.parent / "other"
    shutil.copytree(tree, other)
    (other / "members" / "A1.json").write_text('{"a":1}')  # a concurrent publish reuses the exposed bytes
    (other / "meta.json").write_text(json.dumps({"build": {"time": "t7"}}))
    fired = []

    def publish_concurrently(name, kwargs):
        if name == "put_object" and kwargs["Key"].startswith("releases/withdrawn/") and not fired:
            fired.append(1)
            pr.publish(s3, BUCKET, other, sleep=FAST)
        return False
    with pytest.raises(pr.PublishError, match="share the exposed bytes"):
        withdraw(Client(s3, publish_concurrently), r1, exposed_paths=("members/A1.json",))
    assert blob('{"a":1}') in keys(s3)  # never deleted while a live release references it


def test_publish_and_activate_refuse_withdrawn_release(s3, tree):
    r1, r2, r3 = three(s3, tree)
    withdraw(s3, r1, exposed_paths=("members/A1.json",))
    (tree / "members" / "A1.json").write_text('{"a":1}')  # same bytes as the withdrawn release
    (tree / "meta.json").write_text(json.dumps({"build": {"time": "t1"}}))
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.publish(s3, BUCKET, tree, activate=True, sleep=FAST)
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.activate_release(s3, BUCKET, r1, sleep=FAST)
    assert keys(s3) == before
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"] == r3


def test_withdrawal_before_any_upload_blocks_creation(s3, tree):
    rid = build_manifest(tree)["release_id"]
    result = withdraw(s3, rid, "other")
    assert result["deleted_blobs"] == 0
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.publish(s3, BUCKET, tree, sleep=FAST)
    assert keys(s3) == {stone(rid)}


@pytest.mark.parametrize("bad", [{"schema_version": 1}, {"schema_version": 1, "release_id": "a" * 64,
                                                         "withdrawn_at": "2026-03-04T05:06:07Z", "reason": "because"}])
def test_tombstone_validator(bad):
    with pytest.raises(Exception):
        wr.validate_tombstone(bad)


def test_cli_rules(monkeypatch, s3, tree, capsys):
    r1, r2, r3 = three(s3, tree)
    monkeypatch.setattr(wr, "client_from_env", lambda require: (s3, BUCKET))
    base = ["--release", r1, "--reason", "privacy"]
    assert wr.main(base + ["--confirm", r2]) == 1
    assert wr.main(["--release", "https://evil", "--reason", "privacy", "--confirm", "https://evil"]) == 1
    assert "https://evil" not in capsys.readouterr().err
    assert wr.main(["--release", r3, "--reason", "legal", "--confirm", r3]) == 1
    assert "current release" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        wr.main(["--release", r1, "--reason", "free text", "--confirm", r1])
    assert wr.main(base + ["--confirm", r1]) == 1  # shares bytes with r2
    assert r2 in capsys.readouterr().err
    assert wr.main(base + ["--confirm", r1, "--also-withdraw", "not-an-id"]) == 1
    assert wr.main(base + ["--confirm", r1, "--also-withdraw", r2]) == 0
    assert {stone(r1), stone(r2)} <= keys(s3)


def test_cli_missing_config(monkeypatch, capsys):
    from pipeline import publish_r2
    for name in publish_r2.REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    assert wr.main(["--release", "a" * 64, "--reason", "other", "--confirm", "a" * 64]) == 2
    assert "R2_BUCKET" in capsys.readouterr().err
