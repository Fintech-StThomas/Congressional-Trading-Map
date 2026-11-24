"""Release history index: validation, ordering, dedupe, cap, concurrency, and failure after the pointer moved."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from pipeline import publish_release as pr
from pipeline import release_history as rh
from pipeline.release_manifest import ReleaseManifestError, canonical_json

BUCKET = "paper-trail"
IDX = pr.INDEX


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


class Clock:
    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        return datetime(2026, 1, 1, 0, 0, self.n, tzinfo=timezone.utc)


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


def index(s3):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=IDX)["Body"].read())


def rid(n):
    return f"{n:064x}"


def record(client, n, **kw):
    return rh.record_activation(client, BUCKET, rid(n), f"t{n}", sleep=lambda _: None, **kw)


def test_first_creation_append_and_headers(s3):
    clock = Clock()
    client = Client(s3)
    assert record(client, 1, now=clock) and record(client, 2, now=clock)
    assert [e["release_id"] for e in index(s3)["releases"]] == [rid(2), rid(1)]
    assert index(s3)["releases"][0] == {"release_id": rid(2), "build_time": "t2", "activated_at": "2026-01-01T00:00:02Z"}
    assert client.puts[0]["IfNoneMatch"] == "*" and "IfMatch" in client.puts[1]
    assert all(p["CacheControl"] == pr.POINTER_CACHE for p in client.puts)
    head = s3.head_object(Bucket=BUCKET, Key=IDX)
    assert head["CacheControl"] == pr.POINTER_CACHE and head["ContentType"] == "application/json"
    rh.validate_index(index(s3))


def test_reactivation_keeps_one_entry_with_latest_time_and_repeat_is_noop(s3):
    clock = Clock()
    for n in (1, 2, 1):
        record(s3, n, now=clock)
    entries = index(s3)["releases"]
    assert [e["release_id"] for e in entries] == [rid(1), rid(2)]
    assert entries[0]["activated_at"] == "2026-01-01T00:00:03Z"
    client = Client(s3)
    assert record(client, 1, now=clock) is False and client.puts == []


def test_index_keeps_more_than_400_and_only_the_safety_cap_drops_oldest(s3):
    clock = Clock()
    body = [{"release_id": rid(n), "build_time": "t", "activated_at": "2026-01-01T00:00:00Z"} for n in range(rh.MAX_ENTRIES, 0, -1)]
    s3.put_object(Bucket=BUCKET, Key=IDX, Body=canonical_json({"schema_version": 1, "releases": body}))
    record(s3, 99999, now=clock)
    entries = index(s3)["releases"]
    assert rh.MAX_ENTRIES >= 10_000 and len(entries) == rh.MAX_ENTRIES
    assert entries[0]["release_id"] == rid(99999) and entries[-1]["release_id"] == rid(2)


def test_401st_activation_keeps_the_oldest_listed(s3):
    for n in range(1, 402):
        record(s3, n, now=lambda: datetime(2026, 1, 1, tzinfo=timezone.utc))
    entries = index(s3)["releases"]
    assert len(entries) == 401 and entries[0]["release_id"] == rid(401) and entries[-1]["release_id"] == rid(1)


def test_next_activation_lists_a_previous_release_whose_index_write_failed(s3, tree):
    def fail(kwargs):
        if kwargs["Key"] == IDX:
            raise ClientError({"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}}, "PutObject")
    with pytest.raises(pr.PublishError, match="pointer WAS activated"):
        pr.publish(Client(s3, fail), BUCKET, tree, activate=True, sleep=lambda _: None)
    first = json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"]
    # The next day the data changed: the new release is indexed and so is the orphaned one.
    (tree / "members" / "A1.json").write_text('{"a":2}')
    (tree / "meta.json").write_text(json.dumps({"build": {"time": "t2"}}))
    second = pr.publish(s3, BUCKET, tree, activate=True, sleep=lambda _: None, now=Clock())
    assert [(e["release_id"], e["build_time"]) for e in index(s3)["releases"]] == [(second["release_id"], "t2"), (first, "t1")]


def test_concurrent_change_is_merged_on_retry(s3):
    record(s3, 1, now=Clock())
    raced = []

    def race(kwargs):
        if kwargs["Key"] == IDX and not raced:
            raced.append(1)
            record(s3, 7, now=Clock())
    client = Client(s3, race)
    assert record(client, 2, now=Clock())
    assert [e["release_id"] for e in index(s3)["releases"]] == [rid(2), rid(7), rid(1)]


def test_persistent_concurrent_change_gives_up(s3):
    record(s3, 1, now=Clock())
    count = []

    def race(kwargs):
        count.append(1)
        s3.put_object(Bucket=BUCKET, Key=IDX, Body=canonical_json(
            {"schema_version": 1, "releases": [{"release_id": rid(50 + len(count)), "build_time": "t",
                                                 "activated_at": "2026-01-01T00:00:00Z"}]}))
    with pytest.raises(pr.PublishError, match="concurrently"):
        record(Client(s3, race), 2, now=Clock())
    assert len(count) == 5


@pytest.mark.parametrize("bad", [
    b"nope", b"{}", b'{"schema_version":1}', b'{"schema_version":true,"releases":[]}',
    b'{"schema_version":1,"releases":[],"x":1}',
    b'{"schema_version":1,"releases":[{"release_id":"x","build_time":"t","activated_at":"2026-01-01T00:00:00Z"}]}',
    json.dumps({"schema_version": 1, "releases": [{"release_id": "a" * 64, "build_time": "t", "activated_at": "yesterday"}]}).encode(),
    json.dumps({"schema_version": 1, "releases": [{"release_id": "a" * 64, "build_time": "t", "activated_at": "2026-02-30T00:00:00Z"}]}).encode(),
    json.dumps({"schema_version": 1, "releases": [{"release_id": "a" * 64, "build_time": "t", "activated_at": "2026-01-01T00:00:00Z", "x": 1}]}).encode(),
    json.dumps({"schema_version": 1, "releases": [{"release_id": "a" * 64, "build_time": "t", "activated_at": "2026-01-01T00:00:00Z"}] * 2}).encode(),
])
def test_malformed_index_fails_closed_and_is_untouched(s3, bad):
    s3.put_object(Bucket=BUCKET, Key=IDX, Body=bad)
    with pytest.raises(pr.PublishError, match="malformed"):
        record(s3, 1, now=Clock())
    assert s3.get_object(Bucket=BUCKET, Key=IDX)["Body"].read() == bad
    with pytest.raises(pr.PublishError, match="malformed"):
        rh.remove_release(s3, BUCKET, rid(1), sleep=lambda _: None)


def test_validator_rejects_oversize_and_bad_build_time():
    entry = {"release_id": rid(1), "build_time": "t", "activated_at": "2026-01-01T00:00:00Z"}
    with pytest.raises(ReleaseManifestError):
        rh.validate_index({"schema_version": 1, "releases": [dict(entry, release_id=rid(n)) for n in range(rh.MAX_ENTRIES + 1)]})
    with pytest.raises(ReleaseManifestError):
        rh.validate_index({"schema_version": 1, "releases": [dict(entry, build_time=" ")]})


def test_remove_release(s3):
    assert rh.remove_release(s3, BUCKET, rid(1), sleep=lambda _: None) is False and IDX not in {
        e["Key"] for e in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])}
    record(s3, 1, now=Clock())
    record(s3, 2, now=Clock())
    assert rh.remove_release(s3, BUCKET, rid(1), sleep=lambda _: None)
    assert [e["release_id"] for e in index(s3)["releases"]] == [rid(2)]
    assert rh.remove_release(s3, BUCKET, rid(1), sleep=lambda _: None) is False


def test_publish_activation_records_index_with_meta_build_time(s3, tree):
    result = pr.publish(s3, BUCKET, tree, activate=True, sleep=lambda _: None, now=Clock())
    assert result["indexed"]
    assert index(s3)["releases"] == [{"release_id": result["release_id"], "build_time": "t1",
                                      "activated_at": "2026-01-01T00:00:01Z"}]
    # archive-only never touches the index
    (tree / "members" / "A1.json").write_text('{"a":2}')
    pr.publish(s3, BUCKET, tree, sleep=lambda _: None)
    assert len(index(s3)["releases"]) == 1
    # rollback verification path uses meta.json from the archive
    (tree / "meta.json").write_text(json.dumps({"build": {"time": "t2"}}))
    second = pr.publish(s3, BUCKET, tree, activate=True, sleep=lambda _: None, now=Clock())
    pr.activate_release(s3, BUCKET, result["release_id"], sleep=lambda _: None, now=Clock())
    assert [(e["release_id"], e["build_time"]) for e in index(s3)["releases"]] == [
        (result["release_id"], "t1"), (second["release_id"], "t2")]


def test_index_failure_after_pointer_moved_is_loud_and_repairable(s3, tree):
    def fail(kwargs):
        if kwargs["Key"] == IDX:
            raise ClientError({"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}}, "PutObject")
    with pytest.raises(pr.PublishError, match="pointer WAS activated") as info:
        pr.publish(Client(s3, fail), BUCKET, tree, activate=True, sleep=lambda _: None)
    assert "re-run" in str(info.value)
    release = json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"]
    assert release in str(info.value)
    with pytest.raises(s3.exceptions.NoSuchKey):
        s3.get_object(Bucket=BUCKET, Key=IDX)
    repaired = pr.publish(s3, BUCKET, tree, activate=True, sleep=lambda _: None)
    assert repaired["new_blobs"] == 0 and index(s3)["releases"][0]["release_id"] == release
    again = Client(s3)
    pr.publish(again, BUCKET, tree, activate=True, sleep=lambda _: None)
    assert again.puts == []  # a repeat is a no-change day: nothing is written


def test_cli_reports_index_failure_nonzero(monkeypatch, s3, tree, capsys):
    s3.put_object(Bucket=BUCKET, Key=IDX, Body=b"broken")
    monkeypatch.setattr(pr, "client_from_env", lambda require: (s3, BUCKET))
    assert pr.main(["--dir", str(tree), "--activate"]) == 1
    err = capsys.readouterr().err
    assert "WAS activated" in err and "malformed" in err
    assert json.loads(s3.get_object(Bucket=BUCKET, Key=pr.CURRENT)["Body"].read())["release_id"]
