"""Provider check: passes on a provider that enforces conditions, fails on ones that do not, cleans up exactly."""
from __future__ import annotations

import boto3
import pytest
from moto import mock_aws

from pipeline import publish_r2, release_provider_check as rpc

BUCKET = "paper-trail"


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        client.put_object(Bucket=BUCKET, Key="releases/current.json", Body=b"keep")
        client.put_object(Bucket=BUCKET, Key="release-provider-check/other/x", Body=b"keep")
        yield client


class Lax:
    """A provider that silently ignores (or mangles) what the archive publisher depends on."""
    def __init__(self, client, drop=("IfNoneMatch", "IfMatch")):
        self.client, self.drop = client, drop

    def put_object(self, **kwargs):
        return self.client.put_object(**{k: v for k, v in kwargs.items() if k not in self.drop})

    def __getattr__(self, name):
        return getattr(self.client, name)


def keys(client):
    return {e["Key"] for e in client.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


def test_enforcing_provider_passes_and_cleans_up_only_its_keys(s3):
    before = keys(s3)
    results, cleaned = rpc.run_checks(s3, BUCKET, "run1")
    assert cleaned and len(results) == 9 and all(ok for _, ok, _ in results)
    assert keys(s3) == before


@pytest.mark.parametrize("drop,failing", [
    (("IfNoneMatch", "IfMatch"), {"second-create-rejected", "if-match-stale-rejected"}),
    (("IfNoneMatch",), {"second-create-rejected"}),
    (("IfMatch",), {"if-match-stale-rejected"}),
    (("CacheControl",), {"headers-round-trip", "if-match-current-succeeds"}),
])
def test_non_enforcing_provider_fails(s3, drop, failing):
    results, cleaned = rpc.run_checks(Lax(s3, drop), BUCKET, "run2")
    assert {name for name, ok, _ in results if not ok} >= failing
    assert cleaned
    assert not [k for k in keys(s3) if k.startswith("release-provider-check/run2/")]


def test_cli_exit_codes_and_no_secrets(monkeypatch, s3, capsys):
    for name in publish_r2.REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    assert rpc.main([]) == 2
    assert "R2_BUCKET" in capsys.readouterr().err
    monkeypatch.setattr(rpc, "client_from_env", lambda require: (s3, BUCKET))
    assert rpc.main([]) == 0
    out = capsys.readouterr().out
    assert out.count("PASS") >= 10 and "FAIL" not in out
    monkeypatch.setattr(rpc, "client_from_env", lambda require: (Lax(s3), BUCKET))
    assert rpc.main([]) == 1
    assert "FAIL  second-create-rejected" in capsys.readouterr().out


def test_unexpected_error_is_sanitized(monkeypatch, capsys):
    def boom(require):
        raise ValueError("https://secret-account.r2.example.com key")
    monkeypatch.setattr(rpc, "client_from_env", boom)
    assert rpc.main([]) == 1
    err = capsys.readouterr().err
    assert "ValueError" in err and "secret" not in err
