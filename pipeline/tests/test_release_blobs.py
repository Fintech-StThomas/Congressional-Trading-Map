"""Blob helpers, release discovery, and validate_path parity with the Cloudflare Worker's shared case table."""
from __future__ import annotations

import json
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws

from pipeline import publish_release as pr
from pipeline import release_blobs as rb
from pipeline import release_refs as rr
from pipeline.release_manifest import ReleaseManifestError, validate_path, validate_release_id

BUCKET = "paper-trail"
CASES = json.loads((Path(__file__).parents[2] / "worker" / "test" / "path-cases.json").read_text(encoding="utf-8"))
FAST = lambda _: None  # noqa: E731


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: repr(c["path"]))
def test_validate_path_matches_the_worker_table(case):
    if case["valid"]:
        assert validate_path(case["path"]) == case["path"]
    else:
        with pytest.raises(ReleaseManifestError):
            validate_path(case["path"])


@pytest.mark.parametrize("case", CASES["ids"], ids=lambda c: repr(c["id"]))
def test_validate_release_id_matches_the_worker_table(case):
    if case["valid"]:
        assert validate_release_id(case["id"]) == case["id"]
    else:
        with pytest.raises(ReleaseManifestError):
            validate_release_id(case["id"])


def test_blob_key_validates_the_hash():
    assert rb.blob_key("a" * 64) == "releases/blobs/" + "a" * 64
    with pytest.raises(ReleaseManifestError):
        rb.blob_key("../x")


def test_archive_stats_sums_distinct_blobs_across_pages(s3):
    for n in range(1003):
        s3.put_object(Bucket=BUCKET, Key=f"releases/blobs/{n:064x}", Body=b"xy")
    s3.put_object(Bucket=BUCKET, Key="releases/current.json", Body=b"not a blob")
    s3.put_object(Bucket=BUCKET, Key="data/x.json", Body=b"not a blob")
    assert rb.archive_stats(s3, BUCKET) == (1003, 2006)


def test_store_blob_refuses_bytes_that_do_not_match_the_hash(s3):
    with pytest.raises(pr.PublishError, match="changed"):
        rb.store_blob(s3, BUCKET, "a" * 64, b"other", "application/json", FAST)
    assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0


def test_check_reused_reports_missing_size_and_headers():
    ok = {"ContentLength": 3, "CacheControl": pr.IMMUTABLE_CACHE, "ContentType": "text/plain"}
    rb.check_reused(ok, {"bytes": 3})
    for head, text in ((None, "missing"), ({**ok, "ContentLength": 4}, "size"), ({**ok, "CacheControl": "x"}, "headers"),
                       ({**ok, "ContentEncoding": "gzip"}, "headers")):
        with pytest.raises(pr.PublishError, match=text):
            rb.check_reused(head, {"bytes": 3})


def test_list_release_ids_skips_blobs_withdrawn_and_lookalikes(s3):
    for key in ("releases/" + "a" * 64 + "/release.json", "releases/" + "b" * 64 + "/release.json",
                "releases/blobs/" + "c" * 64, "releases/withdrawn/" + "d" * 64 + ".json", "releases/current.json",
                "releases/" + "E" * 64 + "/x", "releases/" + "f" * 63 + "/x"):
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
    assert rr.list_release_ids(s3, BUCKET, FAST) == ["a" * 64, "b" * 64]
    assert rr.withdrawn_ids(s3, BUCKET, FAST) == {"d" * 64}


def test_head_blobs_marks_missing_as_none(s3):
    s3.put_object(Bucket=BUCKET, Key="releases/blobs/" + "a" * 64, Body=b"x")
    heads = rb.head_blobs(s3, BUCKET, ["a" * 64, "b" * 64], FAST)
    assert heads["a" * 64]["ContentLength"] == 1 and heads["b" * 64] is None


def test_head_error_other_than_404_is_not_treated_as_missing():
    class Broken:
        def head_object(self, **kwargs):
            raise ClientError({"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}}, "HeadObject")
    with pytest.raises(pr.PublishError):
        rb.head_blobs(Broken(), BUCKET, ["a" * 64], FAST)
