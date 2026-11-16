"""Release withdrawal: refusals, ordering, interruption at each stage, prefix isolation, and publish refusal."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from pipeline import publish_release as pr
from pipeline import withdraw_release as wr
from pipeline.release_manifest import canonical_json

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
    return {e["Key"] for e in client.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


def two_releases(s3, tree):
    first = pr.publish(s3, BUCKET, tree, activate=True, sleep=FAST)["release_id"]
    (tree / "members" / "A1.json").write_text('{"a":2}')
    second = pr.publish(s3, BUCKET, tree, activate=True, sleep=FAST)["release_id"]
    return first, second


def withdraw(client, release, reason="privacy"):
    return wr.withdraw(client, BUCKET, release, reason, sleep=FAST, now=NOW)


def test_withdraw_tombstone_deletes_prefix_and_index_entry_only(s3, tree):
    first, second = two_releases(s3, tree)
    s3.put_object(Bucket=BUCKET, Key="data/legacy.json", Body=b"legacy")
    before = keys(s3)
    result = withdraw(s3, first)
    assert result["reason"] == "privacy" and result["deleted_objects"] == 3
    after = keys(s3)
    assert not [k for k in after if k.startswith(f"releases/{first}/")]
    assert {k for k in before - after} == {k for k in before if k.startswith(f"releases/{first}/")}
    assert after - before == {f"releases/withdrawn/{first}.json"}
    stone = s3.get_object(Bucket=BUCKET, Key=f"releases/withdrawn/{first}.json")
    assert json.loads(stone["Body"].read()) == {"schema_version": 1, "release_id": first,
                                                 "withdrawn_at": "2026-03-04T05:06:07Z", "reason": "privacy"}
    assert stone["CacheControl"] == pr.POINTER_CACHE
    assert [e["release_id"] for e in json.loads(s3.get_object(Bucket=BUCKET, Key=pr.INDEX)["Body"].read())["releases"]] == [second]
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"] == second
    assert pr.activate_release  # sibling still verifiable
    pr.activate_release(s3, BUCKET, second, sleep=FAST)


def test_refuses_current_release_and_changes_nothing(s3, tree):
    _, second = two_releases(s3, tree)
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(s3, second)
    assert keys(s3) == before


def test_order_is_tombstone_then_deletes_then_index(s3, tree):
    first, _ = two_releases(s3, tree)
    client = Client(s3)
    withdraw(client, first)
    names = [(n, k) for n, k in client.calls if n in ("put_object", "delete_object")]
    ops = [n for n, _ in names]
    assert names[0] == ("put_object", f"releases/withdrawn/{first}.json")
    assert ops.index("put_object") < ops.index("delete_object")
    assert names[-1] == ("put_object", pr.INDEX)
    assert all(k.startswith(f"releases/{first}/") for n, k in names if n == "delete_object")


@pytest.mark.parametrize("stage", ["tombstone", "delete", "index"])
def test_interruption_then_rerun_completes(s3, tree, stage):
    first, second = two_releases(s3, tree)
    target = {"tombstone": lambda n, kw: n == "put_object" and kw["Key"].startswith("releases/withdrawn/"),
              "delete": lambda n, kw: n == "delete_object" and kw["Key"].endswith("A1.json"),
              "index": lambda n, kw: n == "put_object" and kw["Key"] == pr.INDEX}[stage]
    with pytest.raises(pr.PublishError):
        withdraw(Client(s3, target), first)
    stone = f"releases/withdrawn/{first}.json" in keys(s3)
    assert stone == (stage != "tombstone")
    if stage == "tombstone":
        assert any(k.startswith(f"releases/{first}/") for k in keys(s3))
    result = withdraw(s3, first, "legal")
    after = keys(s3)
    assert not [k for k in after if k.startswith(f"releases/{first}/")]
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=f"releases/withdrawn/{first}.json")["Body"].read())["reason"] == (
        "privacy" if stage != "tombstone" else "legal")
    assert result["reason"] in ("privacy", "legal")
    assert [e["release_id"] for e in json.loads(s3.get_object(Bucket=BUCKET, Key=pr.INDEX)["Body"].read())["releases"]] == [second]
    withdraw(s3, first)  # fully idempotent once done


def test_prefix_isolation_with_lookalike_keys(s3, tree):
    first, second = two_releases(s3, tree)
    # Keys that merely share a leading string with the withdrawn id must survive.
    extras = {f"releases/{first}x/a.json", f"releases/{first[:-1]}/a.json", f"releases/{first}", "data/x.json",
              f"releases/withdrawn/{second}.json"}
    for key in extras:
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
    sibling = {k for k in keys(s3) if k.startswith(f"releases/{second}/")}
    withdraw(s3, first)
    assert extras <= keys(s3) and sibling <= keys(s3)


def test_pagination_deletes_everything(s3, tree):
    first, _ = two_releases(s3, tree)
    for n in range(1105):
        s3.put_object(Bucket=BUCKET, Key=f"releases/{first}/extra/{n}.json", Body=b"x")
    assert withdraw(s3, first)["deleted_objects"] == 1108
    assert not [k for k in keys(s3) if k.startswith(f"releases/{first}/")]


def test_pointer_moving_to_release_after_tombstone_aborts_before_delete(s3, tree):
    first, second = two_releases(s3, tree)

    def move(name, kwargs):
        if name == "put_object" and kwargs["Key"].startswith("releases/withdrawn/"):
            s3.put_object(Bucket=BUCKET, Key=pr.CURRENT, Body=canonical_json(
                {"schema_version": 1, "release_id": first, "manifest_sha256": "a" * 64}))
        return False
    before = {k for k in keys(s3) if k.startswith(f"releases/{first}/")}
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(Client(s3, move), first)
    assert before <= keys(s3)


def test_publish_and_activate_refuse_withdrawn_release(s3, tree):
    first, second = two_releases(s3, tree)
    withdraw(s3, first)
    (tree / "members" / "A1.json").write_text('{"a":1}')  # same bytes as the withdrawn release
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.publish(s3, BUCKET, tree, activate=True, sleep=FAST)
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.activate_release(s3, BUCKET, first, sleep=FAST)
    assert keys(s3) == before
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"] == second


def test_withdrawal_before_any_upload_blocks_creation(s3, tree):
    from pipeline.release_manifest import build_manifest
    release = build_manifest(tree)["release_id"]
    result = withdraw(s3, release, "other")
    assert result["deleted_objects"] == 0
    with pytest.raises(pr.PublishError, match="withdrawn"):
        pr.publish(s3, BUCKET, tree, sleep=FAST)
    assert keys(s3) == {f"releases/withdrawn/{release}.json"}


@pytest.mark.parametrize("bad", [{"schema_version": 1}, {"schema_version": 1, "release_id": "a" * 64,
                                                         "withdrawn_at": "2026-03-04T05:06:07Z", "reason": "because"}])
def test_tombstone_validator(bad):
    with pytest.raises(Exception):
        wr.validate_tombstone(bad)


def test_cli_rules(monkeypatch, s3, tree, capsys):
    first, second = two_releases(s3, tree)
    monkeypatch.setattr(wr, "client_from_env", lambda require: (s3, BUCKET))
    base = ["--release", first, "--reason", "privacy"]
    assert wr.main(base + ["--confirm", second]) == 1
    assert wr.main(["--release", "https://evil", "--reason", "privacy", "--confirm", "https://evil"]) == 1
    assert "https://evil" not in capsys.readouterr().err
    assert wr.main(["--release", second, "--reason", "legal", "--confirm", second]) == 1
    assert "current release" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        wr.main(["--release", first, "--reason", "free text", "--confirm", first])
    assert wr.main(base + ["--confirm", first]) == 0
    assert f"releases/withdrawn/{first}.json" in keys(s3)


def test_cli_missing_config(monkeypatch, capsys):
    from pipeline import publish_r2
    for name in publish_r2.REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    assert wr.main(["--release", "a" * 64, "--reason", "other", "--confirm", "a" * 64]) == 2
    assert "R2_BUCKET" in capsys.readouterr().err
