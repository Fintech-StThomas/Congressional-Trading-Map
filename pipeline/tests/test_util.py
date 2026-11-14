"""Shared helpers (pipeline/util.py): cached downloads retry and never cache a partial file; overrides need review."""
from __future__ import annotations

import pytest
import requests

from pipeline import util


class FakeResponse:
    def __init__(self, chunks: list[bytes], length: int | None = None, fail: Exception | None = None, status: int = 200):
        self.chunks, self.fail, self.status_code = chunks, fail, status
        self.headers = {"Content-Length": str(length)} if length is not None else {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)

    def iter_content(self, n):
        yield from self.chunks
        if self.fail:
            raise self.fail


def test_fetch_retries_broken_streams_and_short_reads(tmp_path, monkeypatch):
    answers = iter([FakeResponse([b"abc"], fail=requests.exceptions.ChunkedEncodingError("cut")),
                    FakeResponse([b"ab"], length=5), FakeResponse([b"abcde"], length=5)])
    monkeypatch.setattr(util._session, "get", lambda *a, **k: next(answers))
    monkeypatch.setattr(util.time, "sleep", lambda s: None)
    meta = util.fetch("https://example.org/f", tmp_path / "f")
    assert (tmp_path / "f").read_bytes() == b"abcde" and meta["bytes"] == 5
    assert not (tmp_path / "f.part").exists() or (tmp_path / "f.part").read_bytes() != b"abcde"


def test_fetch_gives_up_and_leaves_no_cached_file(tmp_path, monkeypatch):
    monkeypatch.setattr(util._session, "get", lambda *a, **k: FakeResponse([b"x"], length=9))
    monkeypatch.setattr(util.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError):
        util.fetch("https://example.org/g", tmp_path / "g", retries=2)
    assert not (tmp_path / "g").exists()


def test_fetch_raises_404_without_retrying(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(util._session, "get", lambda *a, **k: calls.append(1) or FakeResponse([], status=404))
    with pytest.raises(requests.HTTPError):
        util.fetch("https://example.org/h", tmp_path / "h")
    assert len(calls) == 1


def test_overrides_without_reviewer_are_ignored(tmp_path, monkeypatch):
    (tmp_path / "org_overrides.csv").write_text(
        "source,source_id_or_name,org_id,note,reviewed_by,reviewed_on\n"
        "Ticker,FB,co:1326801,,ab,2026-01-01\nticker,TWTR,co:1418091,,,\nfec,C00000001,co:1,,cd,2026-01-02\n")
    monkeypatch.setattr(util, "CROSSWALK", tmp_path)
    rows, total = util.read_overrides({"ticker"})
    assert total == 3 and [(r["source"], r["source_id_or_name"]) for r in rows] == [("ticker", "FB")]


def test_lda_off_removes_stale_plugin_files(tmp_path, monkeypatch):
    from pipeline import run
    for d in ("edges", "orgs", "sources"):
        (tmp_path / d).mkdir()
    files = [tmp_path / "edges" / "lda.jsonl", tmp_path / "orgs" / "lda.jsonl", tmp_path / "sources" / "lda.json"]
    for f in files:
        f.write_text("{}")
    monkeypatch.setattr(run, "EDGES_DIR", tmp_path / "edges")
    monkeypatch.setattr(run, "ORGS_DIR", tmp_path / "orgs")
    monkeypatch.setattr(run, "SOURCES_DIR", tmp_path / "sources")
    monkeypatch.delenv("PT_ENABLE_LDA", raising=False)
    run.lda()
    assert not any(f.exists() for f in files)
