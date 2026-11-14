"""The R2 uploader (pipeline/publish_r2.py) against a fake S3 (moto): changed-only uploads, meta.json and the
manifest last, deletions only after success, and a failed run leaving the old manifest."""
from __future__ import annotations

import json
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

from pipeline import publish_r2 as pr

BUCKET = "paper-trail"


def build(root: Path, files: dict[str, str], time: str) -> None:
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)
    (root / "meta.json").write_text(json.dumps({"build": {"time": time}}))


class Recorder:
    """Wraps the client: records put order and can fail chosen keys."""

    def __init__(self, client, fail: set[str] = frozenset()) -> None:
        self.client, self.fail, self.puts = client, set(fail), []

    def put_object(self, **kw):
        if kw["Key"] in self.fail:
            from botocore.exceptions import ClientError
            raise ClientError({"Error": {"Code": "InternalError"}, "ResponseMetadata": {"HTTPStatusCode": 500}}, "PutObject")
        self.puts.append(kw["Key"])
        return self.client.put_object(**kw)

    def __getattr__(self, name):
        return getattr(self.client, name)


@pytest.fixture
def s3():
    with mock_aws():
        c = boto3.client("s3", region_name="us-east-1")
        c.create_bucket(Bucket=BUCKET)
        yield c


def manifest(s3) -> dict:
    return json.loads(s3.get_object(Bucket=BUCKET, Key="data/_manifest.json")["Body"].read())


def test_first_upload_sends_everything_with_headers_and_meta_then_manifest_last(s3, tmp_path) -> None:
    build(tmp_path, {"members.json": "[1]", "orgs/aa.json": "{}", "members/A1.json": "{}"}, "t1")
    rec = Recorder(s3)
    out = pr.publish(rec, BUCKET, tmp_path, sleep=lambda s: None, workers=1)
    assert out["uploaded"] == 4 and out["deleted"] == 0
    assert rec.puts[-2:] == ["data/meta.json", "data/_manifest.json"]
    head = s3.head_object(Bucket=BUCKET, Key="data/orgs/aa.json")
    assert head["ContentType"] == "application/json" and head["CacheControl"] == pr.CACHE_CONTROL
    m = manifest(s3)
    assert m["build_time"] == "t1" and set(m["files"]) == {"members.json", "orgs/aa.json", "members/A1.json", "meta.json"}


def test_second_upload_sends_only_changed_files_and_deletes_removed_ones_after(s3, tmp_path) -> None:
    build(tmp_path, {"members.json": "[1]", "orgs/aa.json": "{}", "old.json": "{}"}, "t1")
    pr.publish(s3, BUCKET, tmp_path, sleep=lambda s: None)
    (tmp_path / "old.json").unlink()
    build(tmp_path, {"members.json": "[1, 2]"}, "t2")
    rec = Recorder(s3)
    out = pr.publish(rec, BUCKET, tmp_path, sleep=lambda s: None, workers=1)
    assert rec.puts == ["data/members.json", "data/meta.json", "data/_manifest.json"]
    assert out["deleted"] == 1
    keys = {o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET, Prefix="data/")["Contents"]}
    assert keys == {"data/members.json", "data/orgs/aa.json", "data/meta.json", "data/_manifest.json"}
    assert manifest(s3)["build_time"] == "t2"


def test_failed_upload_keeps_old_manifest_meta_and_stale_objects(s3, tmp_path) -> None:
    build(tmp_path, {"a.json": "1", "b.json": "1", "gone.json": "1"}, "t1")
    pr.publish(s3, BUCKET, tmp_path, sleep=lambda s: None)
    old = manifest(s3)
    (tmp_path / "gone.json").unlink()
    build(tmp_path, {"a.json": "2", "b.json": "2"}, "t2")
    rec = Recorder(s3, fail={"data/b.json"})
    with pytest.raises(pr.PublishError):
        pr.publish(rec, BUCKET, tmp_path, sleep=lambda s: None, workers=1)
    assert "data/meta.json" not in rec.puts and "data/_manifest.json" not in rec.puts
    assert manifest(s3) == old                                              # still the t1 manifest
    assert json.loads(s3.get_object(Bucket=BUCKET, Key="data/meta.json")["Body"].read())["build"]["time"] == "t1"
    assert s3.get_object(Bucket=BUCKET, Key="data/gone.json")                 # not deleted
    # the next good run re-uploads a.json too (the old manifest still lists its old hash)
    rec = Recorder(s3)
    pr.publish(rec, BUCKET, tmp_path, sleep=lambda s: None, workers=1)
    assert set(rec.puts) == {"data/a.json", "data/b.json", "data/meta.json", "data/_manifest.json"}


def test_transient_failures_are_retried(s3, tmp_path) -> None:
    build(tmp_path, {"a.json": "1"}, "t1")
    rec = Recorder(s3, fail={"data/a.json"})
    calls = []

    def sleep(s):
        calls.append(s)
        rec.fail.clear()                                                    # succeeds on the second attempt
    pr.publish(rec, BUCKET, tmp_path, sleep=sleep, workers=1)
    assert calls == [1] and "data/a.json" in rec.puts


def test_missing_env_skips_and_refuses_incomplete_build(monkeypatch, tmp_path, capsys) -> None:
    for k in pr.REQUIRED_ENV:
        monkeypatch.delenv(k, raising=False)
    assert pr.main(["--dir", str(tmp_path)]) == 0
    assert "R2 upload skipped" in capsys.readouterr().out
    with pytest.raises(pr.PublishError):
        pr.publish(None, BUCKET, tmp_path)                                  # no meta.json
