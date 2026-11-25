"""Withdrawal options: --dry-run changes nothing, --exposed-paths-file, and exposed paths in --also-withdraw releases."""
from __future__ import annotations

import pytest

from pipeline import publish_release as pr
from pipeline import withdraw_release as wr
from pipeline.tests.test_withdraw_release import (  # noqa: F401  (s3 and tree are fixtures)
    BUCKET, blob, desc, keys, release, s3, stone, three, tree, withdraw,
)


def test_dry_run_reports_the_plan_and_changes_nothing(s3, tree):
    r1, r2, r3 = three(s3, tree)
    before = keys(s3)
    result = withdraw(s3, r1, also=(r2,), exposed_paths=("members/A1.json",), dry_run=True)
    assert result == {"dry_run": True, "release_id": r1, "reason": "privacy", "would_withdraw": [r1, r2],
                      "descriptors_found": 2, "exposed_blobs": 2, "would_delete_blobs": 3, "would_keep_shared_blobs": 0,
                      "live_releases": 1}
    assert keys(s3) == before
    assert withdraw(s3, r1, exposed_paths=("members/A1.json",), dry_run=True)["would_keep_shared_blobs"] == 1
    assert withdraw(s3, r1, also=(r2,), dry_run=True)["exposed_blobs"] == "all"
    assert keys(s3) == before


def test_dry_run_still_refuses(s3, tree):
    r1, r2, r3 = three(s3, tree)
    before = keys(s3)
    with pytest.raises(pr.PublishError, match="--also-withdraw"):
        withdraw(s3, r1, dry_run=True)
    with pytest.raises(pr.PublishError, match="current release"):
        withdraw(s3, r3, dry_run=True)
    with pytest.raises(pr.PublishError, match="not a file"):
        withdraw(s3, r1, exposed_paths=("nope.json",), dry_run=True)
    assert keys(s3) == before


def test_refuses_when_the_listing_does_not_show_the_current_release(monkeypatch, s3, tree):
    """An empty or partial bucket listing must never let the current release's blobs look unused."""
    r1, r2, r3 = three(s3, tree)
    before = keys(s3)
    monkeypatch.setattr(wr, "live_references", lambda *args, **kwargs: {})
    for dry in (True, False):
        with pytest.raises(pr.PublishError, match="not among the live releases"):
            withdraw(s3, r1, also=(r2,), exposed_paths=("members/A1.json",), dry_run=dry)
    assert keys(s3) == before


def test_exposed_path_bytes_of_an_also_withdrawn_release_block_when_the_current_release_shares_them(s3, tree):
    r1 = release(s3, tree, '{"a":1}')
    r2 = release(s3, tree, '{"a":2}', "t2")
    r3 = release(s3, tree, '{"a":1}', "t3")
    r4 = release(s3, tree, '{"a":2}', "t4")  # current; its members/A1.json has the bytes r2 exposes
    before = keys(s3)
    assert withdraw(s3, r1, also=(r3,), exposed_paths=("members/A1.json",), dry_run=True)["exposed_blobs"] == 1
    with pytest.raises(pr.PublishError, match="current release shares"):
        withdraw(s3, r1, also=(r2, r3), exposed_paths=("members/A1.json",))
    assert keys(s3) == before
    assert r4 == pr.publish(s3, BUCKET, tree, activate=True, sleep=lambda _: None)["release_id"]


def test_exposed_paths_file(monkeypatch, s3, tree, tmp_path, capsys):
    r1, r2, r3 = three(s3, tree)
    monkeypatch.setattr(wr, "client_from_env", lambda require: (s3, BUCKET))
    listing = tmp_path / "paths.txt"
    listing.write_text("# a record\n\nmembers/A1.json\n  members/A1.json  \n")
    base = ["--release", r1, "--reason", "privacy", "--confirm", r1, "--exposed-paths-file"]
    before = keys(s3)
    assert wr.main(base + [str(listing), "--dry-run"]) == 0
    assert "DRY RUN" in capsys.readouterr().out and keys(s3) == before
    empty = tmp_path / "empty.txt"
    empty.write_text("# nothing\n")
    assert wr.main(base + [str(empty)]) == 1 and wr.main(base + [str(tmp_path / "missing.txt")]) == 1
    assert str(tmp_path) not in capsys.readouterr().err and keys(s3) == before
    assert wr.main(base + [str(listing)]) == 0
    assert before - keys(s3) == {blob('{"a":1}'), desc(r1)} and stone(r1) in keys(s3)
