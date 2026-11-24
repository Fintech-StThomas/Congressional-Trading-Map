"""Test isolation for the OpenFEC modules: no key, no shared cache, no network, a fresh client per test."""
import pytest

from pipeline.fec import api, download


@pytest.fixture(autouse=True)
def _isolate_openfec(tmp_path_factory, monkeypatch):
    monkeypatch.delenv("FEC_API_KEY", raising=False)
    monkeypatch.setattr(download, "CACHE", tmp_path_factory.mktemp("feccache"))
    monkeypatch.setattr(api, "_DEFAULT", None)
